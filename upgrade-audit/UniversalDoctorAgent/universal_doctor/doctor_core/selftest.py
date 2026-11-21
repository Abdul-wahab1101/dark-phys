"""Doctor self-test: builds a sample project with SEEDED bugs and proves - with real runs - that the Doctor detects,
explains, repairs, verifies, rolls back, remembers and stays inside its safety limits."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable, Dict, List, Tuple

from . import analysis, discovery, security
from .backup import read_text_preserving
from .engine import Doctor
from .models import Finding, Patch
from .monitor import Monitor, monitor_status
from .recovery import CircuitBreaker, CircuitOpen, GuardedEngine, ServiceRestarter, retry
from .safety import NeedsApproval, SafetyError, verify_integrity, write_integrity_manifest

FAKE_KEY = "AKIAABCDEFGHIJKLMNOP"            # fake, pattern-shaped credential used to prove masking

SAMPLE: Dict[str, str] = {
    "app/__init__.py": "",
    "app/calc.py": '"""Calculator helpers."""\n\n\ndef average(values):\n    """Mean of a list."""\n    return sum(values) / (len(values) + 1)\n\n\n'
                   'def is_adult(age):\n    return age > 18\n\n\ndef clamp(x, lo, hi):\n    return max(lo, min(x, hi))\n',
    "app/store.py": '"""Tiny in-memory store."""\n\n\ndef add_item(item, bucket=[]):\n    bucket.append(item)\n    return bucket\n\n\n'
                    'def load(path):\n    try:\n        with open(path) as fh:\n            return fh.read()\n    except:\n        return None\n\n\n'
                    'def is_empty(value):\n    if value == None:\n        return True\n    return False\n',
    "app/report.py": 'def report_path(name):\n    return os.path.join("reports", name)\n',
    "app/legacy.py": "def oops(x)\n    return x + 1\n",
    "app/qc.py": 'def quality_check(path):\n    size = len(path)\n    report = {"size": size, "status": "PASS"}\n    return report\n',
    "app/net.py": 'import requests\nimport yaml\n\n\ndef fetch(url):\n    r = requests.get(url)\n    return r.text\n\n\ndef parse(text):\n    return yaml.load(text)\n',
    "app/loop.py": "def spin():\n    n = 0\n    while True:\n        n += 1\n",
    "app/db.py": f'import sqlite3\n\nAWS_KEY = "{FAKE_KEY}"\n\n\ndef find_user(conn, name):\n    cur = conn.cursor()\n'
                 "    cur.execute(f\"SELECT * FROM users WHERE name = '{name}'\")\n    return cur.fetchall()\n",
    "app/x.py": "from app import y\n\n\ndef fx():\n    return y.fy()\n",
    "app/y.py": "from app import x\n\n\ndef fy():\n    return 1\n",
    "app/arity.py": "def add(a, b):\n    return a + b\n\n\ndef use():\n    return add(1, 2, 3)\n\n\ndef dup():\n    return 1\n\n\ndef dup():\n    return 2\n\n\n"
                    'def check(x):\n    assert (x > 0, "x must be positive")\n',
    "app/imports_bad.py": "import colections\nfrom app.calc import avrage\n",
    "app/perf.py": 'def build(lines):\n    out = ""\n    for line in lines:\n        out += f"{line}\\n"\n        with open("log.txt", "a") as fh:\n            fh.write(line)\n    return out\n',
    "app/clean.py": '"""A clean module."""\nimport math\n\n\ndef area(r):\n    """Circle area."""\n    return math.pi * r * r\n',
    "app/agents/__init__.py": "",
    "app/agents/agent_a.py": 'import json\n\n\ndef run_agent():\n    data = {"items": [1, 2, 3]}\n    with open("output/a.json", "w") as fh:\n        json.dump(data, fh)\n    return {"status": "ok"}\n',
    "app/agents/agent_b.py": 'import json\n\n\ndef run_agent():\n    try:\n        with open("output/missing.json") as fh:\n            data = json.load(fh)\n'
                             '        return {"status": "ok", "count": len(data)}\n    except Exception:\n        return {"status": "success"}\n',
    "app/agents/agent_loop.py": "def chat_loop(client):\n    while True:\n        reply = client.chat.completions.create(messages=[])\n        print(reply)\n",
    "app/agents/orchestrator.py": "from app.agents import agent_a, agent_b\n\n\ndef main():\n    agent_a.run_agent()\n    agent_b.run_agent()\n    agent_b.run_agent()\n",
    "config.json": '{"a": 1,}\n',
    "requirements.txt": "requests\nflask>=2\npyyaml==6.0\n",
    "tests/test_calc.py": "import unittest\nfrom app import calc\n\n\nclass CalcTests(unittest.TestCase):\n    def test_average(self):\n        self.assertEqual(calc.average([2, 4, 6]), 4)\n\n"
                          "    def test_adult_boundary(self):\n        self.assertTrue(calc.is_adult(18))\n\n    def test_adult_clear(self):\n        self.assertTrue(calc.is_adult(30))\n"
                          "        self.assertFalse(calc.is_adult(5))\n\n    def test_clamp(self):\n        self.assertEqual(calc.clamp(10, 0, 5), 5)\n",
    "tests/test_store.py": "import unittest\nfrom app import store, report\n\n\nclass StoreTests(unittest.TestCase):\n    def test_isolated_buckets(self):\n        store.add_item(1)\n"
                           "        b = store.add_item(2)\n        self.assertEqual(b, [2])\n\n    def test_is_empty(self):\n        self.assertTrue(store.is_empty(None))\n"
                           "        self.assertFalse(store.is_empty(0))\n\n    def test_report_path(self):\n        self.assertTrue(report.report_path('x').endswith('x'))\n",
}
EXPECTED_RULES = {"syntax-error", "mutable-default", "bare-except", "none-comparison", "missing-import", "hardcoded-success-status", "missing-timeout",
                  "insecure-deserialization", "infinite-loop", "sql-injection", "hardcoded-secret", "import-typo", "broken-import-name", "circular-import",
                  "invalid-json", "unpinned-dependency", "agent-silent-failure", "agent-missing-handoff", "agent-unbounded-loop", "agent-duplicate-execution",
                  "call-arity-mismatch", "redefined-function", "assert-tuple", "string-concat-in-loop", "io-in-loop", "test-failure"}


def build_sample(dst: Path) -> Path:
    for rel, text in SAMPLE.items():
        p = dst / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    return dst


def tree_hash(root: Path) -> Dict[str, str]:
    out = {}
    for p in sorted(Path(root).rglob("*")):
        if p.is_file():
            out[p.relative_to(root).as_posix()] = hashlib.sha256(p.read_bytes()).hexdigest()
    return out


class Report:
    def __init__(self):
        self.rows: List[Tuple[str, bool, str]] = []

    def check(self, name: str, cond: bool, detail: str = "") -> bool:
        self.rows.append((name, bool(cond), detail))
        return bool(cond)

    def scenario(self, title: str, fn: Callable) -> None:
        t0 = time.time()
        try:
            fn(self)
        except Exception as e:                                                  # noqa
            self.rows.append((f"{title}: scenario crashed", False, f"{type(e).__name__}: {e}\n{traceback.format_exc()[-600:]}"))
        print(f"  ... {title} ({time.time() - t0:.1f}s)", flush=True)


def fresh(mode: str):
    base = Path(tempfile.mkdtemp(prefix="doctor_sample_"))
    proj = build_sample(base / "proj")
    d = Doctor(str(proj), data_dir=str(base / "data"), mode=mode)
    return base, proj, d


# --------------------------------------------------------------------------------------------- #
def s_discovery_detection(r: Report):
    base, proj, d = fresh("diagnostic")
    s = d.scan()
    rules = {f.rule for f in d.findings}
    tech = d.model.summary()
    r.check("S1 discovery: languages/tests/entry/graph", "Python" in tech["languages"] and tech["tests"] >= 2 and d.model.graph and d.arch["cycles"],
            f"langs={tech['languages']} tests={tech['tests']} cycles={len(d.arch['cycles'])}")
    missing = EXPECTED_RULES - rules
    r.check("S2 detection recall: every seeded bug class found", not missing, f"missing={sorted(missing)} found={len(rules)} classes / {len(d.findings)} findings")
    clean = [f for f in d.findings if f.file == "app/clean.py"]
    r.check("S2 precision: clean module has zero findings (no false positives)", not clean, str([f.rule for f in clean]))
    fp = [f for f in d.findings if f.rule in ("undefined-name", "syntax-error") and f.file not in ("app/legacy.py", "app/report.py")]
    r.check("S2 precision: no bogus undefined-name/syntax findings elsewhere", not fp, str([(f.file, f.message) for f in fp][:3]))
    t = d.last_tests
    r.check("S3 test engine: baseline = 3 FAIL + 1 ERROR of 7 (unittest)", t.ran and t.framework == "unittest" and t.total == 7 and t.failed == 3 and t.errors == 1,
            f"{t.framework} total={t.total} failed={t.failed} errors={t.errors}")
    tf = [f for f in d.findings if f.rule == "test-failure" and "test_average" in f.message]
    r.check("S3 root cause: failing test traced to app/calc.py::average", bool(tf) and tf[0].file == "app/calc.py", str([(f.file, f.line) for f in tf]))
    sec = [f for f in d.findings if f.rule == "hardcoded-secret"]
    r.check("S11 secrets are masked in findings", sec and FAKE_KEY not in json.dumps([f.to_dict() for f in d.findings]), sec[0].message if sec else "no secret finding")
    r.check("S16 performance: static smells + measured scan/test durations", s["duration_s"] > 0 and t.duration > 0, f"scan {s['duration_s']}s tests {t.duration}s")
    info = d.agents_info
    orch = info.get("orchestrators", {}).get("app/agents/orchestrator.py", [])
    r.check("S17 multi-agent: agents + orchestrator call order discovered", len(info.get("agents", {})) >= 4 and len(orch) == 3, f"agents={list(info.get('agents', {}))} order={orch}")
    h = d.health_score()
    r.check("health score is explainable and CRITICAL for the buggy sample", h["label"] == "CRITICAL" and "formula" in h, f"{h['score']} {h['label']}")
    shutil.rmtree(base, ignore_errors=True)


def s_diagnostic_readonly(r: Report):
    base, proj, d = fresh("diagnostic")
    before = tree_hash(proj)
    d.scan()
    res = d.repair_all()
    after = tree_hash(proj)
    st = {x.get("status") for x in res}
    r.check("S4 diagnostic mode: target project is byte-identical after scan + repair attempt", before == after, f"changed={[k for k in set(before) | set(after) if before.get(k) != after.get(k)][:4]}")
    r.check("S4 diagnostic mode: only PROPOSED / MANUAL / NO FIX FOUND - never an applied change", st <= {"PROPOSED", "MANUAL", "SKIPPED", "NO FIX FOUND"} and "PROPOSED" in st, str(st))
    try:
        d.perm.guard_write("app/calc.py", approved=True, auto_ok=True)
        r.check("S4 diagnostic mode blocks writes even when 'approved'", False, "write was allowed")
    except SafetyError:
        r.check("S4 diagnostic mode blocks writes even when 'approved'", True)
    shutil.rmtree(base, ignore_errors=True)


def s_supervised(r: Report):
    base, proj, d = fresh("supervised")
    before = tree_hash(proj)
    d.scan()
    res = d.repair_all(include_tests=False)
    r.check("S5 supervised: nothing changes without approval", tree_hash(proj) == before and any(x["status"] == "NEEDS APPROVAL" for x in res),
            str({x["status"] for x in res}))
    prop = next((x for x in res if x.get("rule") == "mutable-default"), None)
    out = d.repair.approve(prop["repair_id"])
    new = (proj / "app/store.py").read_text()
    r.check("S5 supervised: approved patch applied, backed up and VERIFIED by tests", out["status"] == "VERIFIED" and "if bucket is None:" in new and out.get("backup_id"), str(out.get("status")) + " " + str(out.get("reason", "")))
    r.check("S5 only the approved file changed", [k for k, v in tree_hash(proj).items() if before.get(k) != v] == ["app/store.py"], "")
    r.check("S18 existing tests still pass after repair (isolated-bucket test now passes)", out["status"] == "VERIFIED" and out["tests_before"], out.get("tests_before", ""))
    bk = d.backup.verify(out["backup_id"])
    r.check("backup integrity verified (SHA-256)", bk, "")
    rb = d.repair.rollback(out["repair_id"])
    r.check("S8 manual rollback restores the original bytes", rb["status"] == "ROLLED BACK" and tree_hash(proj) == before, str(rb))
    shutil.rmtree(base, ignore_errors=True)


def s_autonomous(r: Report):
    base, proj, d = fresh("autonomous")
    before = tree_hash(proj)
    base_run = d.scan()
    baseline_pass = set(d.last_tests.passed_ids)
    res = d.repair_all(include_tests=True)
    by = {}
    for x in res:
        by.setdefault(x.get("rule", "test-failure"), []).append(x["status"])
    low_ok = all(any(s in ("VERIFIED", "FIXED") for s in by.get(rule, [])) for rule in ("syntax-error", "missing-import", "mutable-default", "bare-except", "none-comparison", "insecure-deserialization"))
    r.check("S6 autonomous: all low-risk fixes applied automatically with verification", low_ok, str(by))
    r.check("S6 autonomous: medium-risk fixes (timeout/typo/import name) wait for approval", all("NEEDS APPROVAL" in by.get(x, []) for x in ("missing-timeout", "import-typo", "broken-import-name")), str({k: by.get(k) for k in ("missing-timeout", "import-typo", "broken-import-name")}))
    r.check("S6 autonomous: hardcoded-success and secrets are NOT auto-edited (manual)", "MANUAL" in by.get("hardcoded-success-status", ["MANUAL"]) or "hardcoded-success-status" not in by, str(by.get("hardcoded-success-status")))
    r.check("S6 logic bugs (failing tests) need approval in autonomous mode", all(s in ("NEEDS APPROVAL",) for s in by.get("test-failure", ["NEEDS APPROVAL"])), str(by.get("test-failure")))
    secrets_untouched = FAKE_KEY in (proj / "app/db.py").read_text()
    r.check("S6 credentials file not modified by the Doctor", secrets_untouched, "")
    # now the human approves the logic fixes
    d.refresh()
    d.last_tests = None
    d.scan()
    approved = d.repair.repair_failing_tests(approved=True)
    st = [x["status"] for x in approved]
    r.check("S6 mutation repair (test-guided) fixes both logic bugs after approval", st.count("VERIFIED") + st.count("FIXED") == 2, f"{st} {[x.get('mutation') for x in approved]}")
    calc = (proj / "app/calc.py").read_text()
    r.check("S6 the fixes are minimal single edits", "(len(values) + 0)" in calc or "len(values)" in calc and "+ 1" not in calc, calc.splitlines()[5] if len(calc.splitlines()) > 5 else "")
    d.scan()
    t = d.last_tests
    r.check("S18 after all repairs: every test passes and nothing that passed before regressed", t.ok and baseline_pass <= set(t.passed_ids), f"{t.passed}/{t.total} pass")
    reg = d.repair.run_regression_guards()
    r.check("S9 regression guards generated and passing", reg.ran and reg.total >= 6 and reg.ok, f"{reg.passed}/{reg.total}")
    # reintroduce a fixed bug -> guard must fail
    p = proj / "app/store.py"
    text = p.read_text()
    p.write_text(text.replace("def add_item(item, bucket=None):", "def add_item(item, bucket=[]):"))
    reg2 = d.repair.run_regression_guards()
    r.check("S9 reintroduced bug is caught by a regression guard", reg2.failed + reg2.errors >= 1, f"failed={reg2.failed}")
    p.write_text(text)
    # persistence + memory
    d2 = Doctor(str(proj), data_dir=str(base / "data"), mode="autonomous")
    reps = d2.kb.repairs(200)
    r.check("S10 knowledge persists across Doctor instances", len(reps) >= 8 and d2.kb.latest_scan() is not None, f"{len(reps)} repair records")
    blob = b"".join(p.read_bytes() for p in (base / "data").rglob("*") if p.is_file())
    r.check("S11 raw secret never written to knowledge base / reports / proposals", FAKE_KEY.encode() not in blob, "")
    from .report import write_reports
    paths = write_reports(d)
    r.check("reports written (json/md/html)", all(Path(v).exists() for v in paths.values()), str(paths["md"]))
    shutil.rmtree(base, ignore_errors=True)


def s_rollback_and_memory(r: Report):
    base, proj, d = fresh("autonomous")
    d.scan()
    orig = tree_hash(proj)
    f = next(x for x in d.findings if x.rule == "mutable-default")
    d.repair.extra_post_check = lambda root: (False, "injected post-write verification failure")
    res = d.repair.repair_finding(f)
    r.check("S7 failed verification => automatic ROLLBACK, bytes restored", res["status"] == "ROLLED BACK" and res["restore_ok"] and tree_hash(proj) == orig, str(res.get("reason")))
    d.repair.extra_post_check = None
    again = d.repair.repair_finding(f)
    r.check("S7 the exact failed strategy is not repeated blindly", again["status"] == "SKIPPED", str(again))
    # a harmful patch is rejected before it touches the project (shadow verification)
    calc = (proj / "app/calc.py").read_text()
    bad = Finding(rule="manual-test", category="code", severity="low", classification="confirmed", file="app/calc.py", line=11, message="synthetic harmful patch")
    patch = Patch(finding_id=bad.id, rule="manual-test", strategy="synthetic:break-clamp", description="breaks clamp", risk="low", changed_lines=1,
                  files={"app/calc.py": [calc, calc.replace("return max(lo, min(x, hi))", "return lo")]})
    res = d.repair.repair_finding(bad, approved=True, patch=patch)
    r.check("S7 shadow verification rejects a patch that breaks a passing test (project untouched)", res["status"] == "REJECTED BY TESTS" and tree_hash(proj) == orig, str(res))
    # same harmful patch without shadow: applied, tests fail, rolled back
    d.settings.set("use_shadow", False)
    d.repair.baseline = None
    bad2 = Finding(rule="manual-test2", category="code", severity="low", classification="confirmed", file="app/calc.py", line=11, message="synthetic harmful patch 2")
    patch2 = Patch(finding_id=bad2.id, rule="manual-test2", strategy="synthetic:break-clamp2", description="breaks clamp", risk="low", changed_lines=1,
                   files={"app/calc.py": [calc, calc.replace("return max(lo, min(x, hi))", "return lo")]})
    res2 = d.repair.repair_finding(bad2, approved=True, patch=patch2)
    r.check("S7 apply-then-verify path: regression detected => ROLLED BACK, bytes restored", res2["status"] == "ROLLED BACK" and tree_hash(proj) == orig, str(res2.get("reason"))[:200])
    shutil.rmtree(base, ignore_errors=True)


def s_safety(r: Report):
    base, proj, d = fresh("autonomous")
    try:
        d.perm.guard_write("../outside.txt", approved=True)
        r.check("S12 path traversal outside the project is blocked", False, "allowed")
    except SafetyError:
        r.check("S12 path traversal outside the project is blocked", True)
    (proj / ".env").write_text("TOKEN=abc\n")
    try:
        d.perm.guard_write(".env", auto_ok=True)
        r.check("S12 credential files need explicit approval", False, "allowed")
    except NeedsApproval:
        r.check("S12 credential files need explicit approval", True)
    blocked = 0
    for op in ("delete_file", "drop_database", "deploy_production", "publish_external", "install_package", "paid_service", "escalate_permissions"):
        try:
            d.perm.require_approval(op)
        except NeedsApproval:
            blocked += 1
    r.check("S12 destructive / external / paid operations always need approval", blocked == 7, f"{blocked}/7")
    d.set_mode("diagnostic")
    try:
        d.perm.guard_write("app/calc.py", auto_ok=True)
        r.check("S12 mode switch takes effect immediately", False, "")
    except SafetyError:
        r.check("S12 mode switch takes effect immediately", True)
    bad = verify_integrity()
    r.check("S12 self-protection: safety modules match the integrity manifest", bad == [], str(bad))
    from .safety import PACKAGE_DIR
    mf = PACKAGE_DIR / "integrity.json"
    saved = mf.read_text()
    tampered = json.loads(saved)
    tampered["safety.py"] = "0" * 64
    mf.write_text(json.dumps(tampered))
    detected = verify_integrity()
    mf.write_text(saved)
    r.check("S12 tampering with a safety module is detected", detected == ["safety.py"], str(detected))
    try:
        d.perm.resolve_in_scope(PACKAGE_DIR / "safety.py") if False else None
        d2 = Doctor(str(PACKAGE_DIR.parent), data_dir=str(base / "d2"), mode="autonomous")
        d2.perm.guard_write("doctor_core/safety.py", approved=True)
        r.check("S12 Doctor refuses to edit its own files", False, "allowed")
    except SafetyError:
        r.check("S12 Doctor refuses to edit its own files", True)
    shutil.rmtree(base, ignore_errors=True)


def s_recovery(r: Report):
    clock = [0.0]
    cb = CircuitBreaker(2, 10, clock=lambda: clock[0])
    def boom():
        raise RuntimeError("x")
    for _ in range(2):
        try:
            cb.call(boom)
        except RuntimeError:
            pass
    opened = cb.state == "open"
    try:
        cb.call(lambda: 1)
        blocked = False
    except CircuitOpen:
        blocked = True
    clock[0] = 11
    half = cb.state == "half-open"
    cb.call(lambda: 1)
    r.check("S13 circuit breaker: opens, blocks, half-opens, closes", opened and blocked and half and cb.state == "closed", cb.state)
    calls = []
    def flaky():
        calls.append(1)
        if len(calls) < 3:
            raise ValueError("no")
        return "ok"
    res, n = retry(flaky, attempts=3, base_delay=0.01, sleep=lambda s: None)
    try:
        retry(lambda: (_ for _ in ()).throw(ValueError("always")), attempts=2, base_delay=0.01, sleep=lambda s: None)
        bounded = False
    except RuntimeError:
        bounded = True
    r.check("S13 bounded retries (succeeds on 3rd try; gives up instead of looping forever)", res == "ok" and n == 3 and bounded, "")
    g = GuardedEngine("probe", boom)
    out = g(default="fallback")
    r.check("S13 a failing engine degrades gracefully and the failure is recorded", out == "fallback" and g.history and g.history[0]["degraded"], "")
    rs = ServiceRestarter([sys.executable, "-c", "pass"], max_restarts=2, window=100)
    started = [rs.start(), rs.start(), rs.start()]
    rs.stop()
    r.check("S13 controlled restarts: at most N per window", started == [True, True, False], str(started))


def s_monitor_dashboard(r: Report):
    base, proj, d = fresh("diagnostic")
    d.scan()
    mon = Monitor(d, interval=0.4, schedule_minutes=1000)
    box = {}
    th = threading.Thread(target=lambda: box.setdefault("res", mon.run(max_cycles=4)))
    th.start()
    time.sleep(0.8)
    active_during = monitor_status(d.data_dir)["active"]
    (proj / "app/clean.py").write_text((proj / "app/clean.py").read_text() + "\n\ndef perimeter(r):\n    return 2 * math.pi * r\n")
    th.join(timeout=120)
    after = monitor_status(d.data_dir)
    events = [e["message"] for e in d.kb.events(30)]
    r.check("S14 monitor: heartbeat shows ACTIVE only while running, honest afterwards", active_during and not after["active"] and after.get("reason") == "monitor was stopped", str(after.get("reason")))
    r.check("S14 monitor: file change triggers a scan", mon.scans >= 1 and any("file(s) changed" in e for e in events), f"scans={mon.scans}")
    r.check("S14 monitor: never started => reported as not active", monitor_status(Path(tempfile.mkdtemp()))["active"] is False, "")
    # dashboard
    from .dashboard import DashboardServer
    srv = DashboardServer(d, port=0, token="testtoken").start(background=True)
    base_url = f"http://127.0.0.1:{srv.port}"

    def call(path, data=None, token=None, host=None):
        req = urllib.request.Request(base_url + path, data=json.dumps(data).encode() if data is not None else None, method="POST" if data is not None else "GET")
        if token:
            req.add_header("X-Doctor-Token", token)
        if host:
            req.add_header("Host", host)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read().decode()
                return resp.status, (json.loads(body) if resp.headers.get("Content-Type", "").startswith("application/json") else body)
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode()
    code, page = call("/")
    r.check("S15 dashboard serves the page with status labels and controls", code == 200 and "Universal Doctor Agent" in page and "NEEDS" in page and "VERIFIED" in page, "")
    code, st = call("/api/state")
    r.check("S15 dashboard state: health, counts, components, tests, monitoring", code == 200 and all(k in st for k in ("health", "counts", "components", "tests", "monitoring", "repairs", "findings")), "")
    code, _ = call("/api/mode", {"mode": "supervised"})
    r.check("S15 mutating call without session token is refused (403)", code == 403 and d.mode == "diagnostic", str(code))
    code, _ = call("/api/state", host="evil.example.com")
    r.check("S15 foreign Host header refused (DNS-rebinding guard)", code == 403, str(code))
    code, res = call("/api/mode", {"mode": "supervised"}, token="testtoken")
    r.check("S15 mode switch from the dashboard works with the token", code == 200 and d.mode == "supervised", str(res))
    code, res = call("/api/mode", {"mode": "root"}, token="testtoken")
    r.check("S15 invalid mode rejected", code == 400, str(code))
    code, res = call("/api/scan", {}, token="testtoken")
    for _ in range(120):
        time.sleep(0.5)
        if not srv.job["running"]:
            break
    r.check("S15 scan from the dashboard runs as a background job", code == 200 and not srv.job["running"] and srv.job["result"] and "health" in srv.job["result"], str(srv.job["result"])[:80])
    srv.stop()
    shutil.rmtree(base, ignore_errors=True)


def s_other_stacks_and_dogfood(r: Report):
    tmp = Path(tempfile.mkdtemp(prefix="doctor_js_"))
    (tmp / "index.js").write_text("function f( {\n  return eval(userInput);\n}\n", encoding="utf-8")
    (tmp / "package.json").write_text('{"name":"x","dependencies":{"express":"^4"},"scripts":{"test":"echo ok"}}', encoding="utf-8")
    (tmp / "Main.java").write_text("class Main { public static void main(String[] a) {} }\n", encoding="utf-8")
    d = Doctor(str(tmp), data_dir=str(tmp / "_data"), mode="diagnostic")
    s = d.scan(run_tests_flag=False, runtime_checks=False)
    langs = s["technologies"]["languages"]
    r.check("S19 non-Python project: detected (JavaScript/Java, Express) and analysed without crashing", "JavaScript" in langs and "Java" in langs and "Express" in s["technologies"]["frameworks"], str(langs))
    r.check("S19 JS: syntax problem + eval flagged", any(f.rule in ("js-syntax-error", "unsafe-eval") for f in d.findings), str([f.rule for f in d.findings]))
    shutil.rmtree(tmp, ignore_errors=True)
    # dogfooding: the Doctor scans its own source (read-only)
    from .safety import PACKAGE_DIR
    base = Path(tempfile.mkdtemp())
    dd = Doctor(str(PACKAGE_DIR.parent), data_dir=str(base), mode="diagnostic")
    dd.scan(run_tests_flag=False, runtime_checks=False)
    bad = [f for f in dd.findings if f.classification == "confirmed" and f.severity in ("critical", "high") and f.category != "security"
           and not f.file.startswith(("tests/", "doctor_core/selftest.py"))]
    r.check("S20 dogfooding: Doctor scanning itself finds no confirmed critical/high bugs", not bad, str([(f.rule, f.file, f.line) for f in bad][:4]))
    shutil.rmtree(base, ignore_errors=True)


def s_health(r: Report):
    base, proj, d = fresh("diagnostic")
    h = d.self_health()
    r.check("S21 Doctor self-health: all engines + safety + backup + knowledge OK", h["ok"], str([k for k, v in h["checks"].items() if not v["ok"]]))
    shutil.rmtree(base, ignore_errors=True)


def run() -> int:
    write_integrity_manifest() if verify_integrity() == ["integrity.json missing (run: python doctor.py init)"] else None
    print("Universal Doctor Agent self-test (controlled scenarios, real execution)")
    rep = Report()
    for title, fn in (("discovery + detection", s_discovery_detection), ("diagnostic mode read-only", s_diagnostic_readonly),
                      ("supervised mode", s_supervised), ("autonomous safe repair", s_autonomous), ("rollback + memory", s_rollback_and_memory),
                      ("safety controller", s_safety), ("recovery engines", s_recovery), ("monitor + dashboard", s_monitor_dashboard),
                      ("other stacks + dogfooding", s_other_stacks_and_dogfood), ("self health", s_health)):
        rep.scenario(title, fn)
    print()
    for name, ok, detail in rep.rows:
        print(("PASS  " if ok else "FAIL  ") + name + ("" if ok or not detail else f"\n        -> {detail}"))
    failed = [r for r in rep.rows if not r[1]]
    print(f"\n{len(rep.rows) - len(failed)}/{len(rep.rows)} checks passed")
    return 1 if failed else 0
