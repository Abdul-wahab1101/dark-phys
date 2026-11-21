"""The Doctor orchestrator: wires every engine together (scan -> diagnose -> repair -> verify -> remember)."""
from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, List, Optional

from . import agents_diag, analysis, performance, rootcause, security
from .backup import BackupManager
from .config import MODES, SEV_RANK, VERSION, Settings, data_dir_for
from .discovery import ProjectModel, architecture, discover
from .knowledge import Knowledge
from .models import Finding, TestRun
from .recovery import CircuitBreaker, GuardedEngine
from .repair import RepairEngine
from .safety import PermissionController, verify_integrity
from .testing import Shadow, find_python, run_tests, runtime_import_check

SEV_W = {"critical": 15, "high": 8, "medium": 3, "low": 1, "info": 0}
CLS_W = {"confirmed": 1.0, "suspected": 0.4, "recommendation": 0.1}


class Doctor:
    def __init__(self, project: str, data_dir: Optional[str] = None, mode: Optional[str] = None):
        self.root = Path(project).resolve()
        if not self.root.is_dir():
            raise FileNotFoundError(f"project directory not found: {project}")
        self.data_dir = data_dir_for(self.root, data_dir)
        self.settings = Settings(self.data_dir)
        if mode:
            self.settings.set("mode", mode)
        self.perm = PermissionController(self.root, lambda: self.settings.get("mode"))
        self.backup = BackupManager(self.root, self.data_dir)
        self.kb = Knowledge(self.data_dir)
        self.python = find_python(self.root)
        self.model: ProjectModel = discover(self.root, int(self.settings.get("max_files")))
        self.findings: List[Finding] = []
        self.last_tests: Optional[TestRun] = None
        self.last_scan: Optional[dict] = None
        self.agents_info: dict = {}
        self.arch: dict = {}
        self.repair = RepairEngine(self)
        self.engines = {n: GuardedEngine(n, fn, CircuitBreaker(3, 60)) for n, fn in (
            ("analysis", analysis.analyze), ("security", security.scan_security), ("performance", performance.scan_performance),
            ("agents", agents_diag.analyze_agents), ("architecture", architecture))}

    # ---- state ------------------------------------------------------------------------------------------ #
    def refresh(self) -> None:
        self.model = discover(self.root, int(self.settings.get("max_files")))

    @property
    def mode(self) -> str:
        return self.perm.mode

    def set_mode(self, mode: str) -> None:
        if mode not in MODES:
            raise ValueError(f"mode must be one of {MODES}")
        self.settings.set("mode", mode)
        self.kb.event("mode", f"operating mode changed to {mode}")

    # ---- scan ---------------------------------------------------------------------------------------------- #
    def scan(self, run_tests_flag: bool = True, runtime_checks: bool = True) -> dict:
        t0 = time.time()
        self.refresh()
        m = self.model
        out: List[Finding] = []
        notes: List[str] = list(m.notes)
        out += self.engines["analysis"](m, default=[])
        out += self.engines["security"](m, default=[])
        out += self.engines["performance"](m, default=[])
        info, afind = self.engines["agents"](m, default=({}, []))
        self.agents_info = info
        out += afind
        self.arch = self.engines["architecture"](m, default={})
        tests = TestRun(framework="none", note="not run")
        if run_tests_flag or runtime_checks:
            sh = Shadow(self.root, self.data_dir)
            try:
                if run_tests_flag:
                    tests = run_tests(sh.path, m, self.python, timeout=float(self.settings.get("test_timeout")))
                if runtime_checks:
                    targets = [r for r in m.py_files if not m.is_test(r) and r in m.trees and r in {a for a in info.get("agents", {})} | set(m.entry_points)][:15]
                    out += runtime_import_check(sh.path, targets, self.python)
                    out += performance.import_timing(m, sh.path, targets[:5], self.python)
            finally:
                sh.cleanup()
        self.last_tests = tests
        for fail in tests.failures:
            rc = rootcause.analyze_failure(fail, self.root, m)
            o = rc["origin"] or {"file": "", "line": 0}
            out.append(Finding(rule="test-failure", category="test", severity="high", classification="confirmed", file=o["file"] or fail["id"],
                               line=o["line"], message=f"test {fail['id']} {fail['kind'].lower()}: {fail['message'][:140]}", confidence=rc["confidence"],
                               evidence=fail["traceback"][-300:], root_cause=rc["root_cause"], fix_plan=rc["fix_design"] or "investigate the failing test",
                               affected=rc["affected"], extra={"test": fail["id"], "trace": rc["trace"]}))
        for f in out:
            if f.rule != "test-failure":
                rootcause.enrich_finding(f, m)
        # unique + stable order + remembered status
        seen, uniq = set(), []
        for f in out:
            if f.id not in seen:
                seen.add(f.id)
                uniq.append(f)
        states = {r["id"]: r["status"] for r in self.kb.db.execute("SELECT id, status FROM finding_state")}
        for f in uniq:
            if states.get(f.id) in ("NEEDS APPROVAL", "ROLLED BACK"):
                f.status = states[f.id]
        uniq.sort(key=lambda f: (SEV_RANK[f.severity], {"confirmed": 0, "suspected": 1, "recommendation": 2}[f.classification], f.file, f.line))
        self.findings = uniq
        health = self.health_score()
        summary = {"duration_s": round(time.time() - t0, 2), "files": len(m.files), "findings": len(uniq), "health": health["score"],
                   "label": health["label"], "tests": tests.to_dict() if tests else None, "mode": self.mode, "notes": notes,
                   "technologies": m.summary(), "version": VERSION}
        self.last_scan = summary
        self.kb.record_scan({k: v for k, v in summary.items() if k != "tests"} | {"tests_summary": {"ran": tests.ran, "total": tests.total, "failed": tests.failed, "errors": tests.errors}},
                            [f.to_dict() for f in uniq])
        self.kb.event("scan", f"scan finished: {len(uniq)} findings, health {health['score']} ({health['label']})")
        return summary

    # ---- scoring ------------------------------------------------------------------------------------------------- #
    def health_score(self) -> dict:
        """Transparent formula: 100 - weighted findings (confirmed x1, suspected x0.4, recommendation x0.1; critical 15, high 8,
        medium 3, low 1; static part capped at 70) - failing tests (10 + 2 each, capped 30)."""
        fs = [f for f in self.findings if f.status not in ("FIXED", "VERIFIED")]
        static = sum(SEV_W[f.severity] * CLS_W[f.classification] for f in fs if f.rule != "test-failure")
        static_pen = min(70.0, static)
        t = self.last_tests
        test_pen = 0.0
        if t and t.ran and (t.failed or t.errors):
            test_pen = min(30.0, 10 + 2 * (t.failed + t.errors))
        score = max(0, round(100 - static_pen - test_pen))
        crit = any(f.severity == "critical" and f.classification == "confirmed" for f in fs)
        label = "CRITICAL" if (crit or score < 60) else ("WARNING" if score < 85 else "HEALTHY")
        return {"score": score, "label": label, "static_penalty": round(static_pen, 1), "test_penalty": test_pen,
                "formula": "100 - min(70, sum(sev_weight x class_weight)) - min(30, 10 + 2 x failing_tests)"}

    def components(self) -> dict:
        by_file: Dict[str, List[Finding]] = defaultdict(list)
        for f in self.findings:
            if f.status not in ("FIXED", "VERIFIED"):
                by_file[f.file].append(f)
        comps = [x["rel"] for x in self.model.files if x["lang"] or x["ext"] in (".json", ".toml", ".yml", ".yaml")]
        out = {"total": len(comps), "healthy": 0, "warning": 0, "failed": 0, "items": []}
        for c in comps:
            fs = by_file.get(c, [])
            if any(f.classification == "confirmed" and f.severity in ("critical", "high") for f in fs):
                st = "failed"
            elif any(SEV_RANK[f.severity] <= 2 and f.classification != "recommendation" for f in fs):
                st = "warning"
            else:
                st = "healthy"
            out[st] += 1
            if st != "healthy":
                out["items"].append({"file": c, "status": st, "findings": len(fs)})
        return out

    def predict_risks(self, top: int = 10) -> List[dict]:
        """PREDICTED risks (not bugs): complexity, findings, fan-in, external imports, recent churn."""
        m = self.model
        cx: Dict[str, int] = defaultdict(int)
        cnt: Dict[str, int] = defaultdict(int)
        for f in self.findings:
            cnt[f.file] += 1
            if f.rule == "complex-function":
                cx[f.file] = max(cx[f.file], f.extra.get("complexity", 0))
        churn: Dict[str, int] = {}
        if (self.root / ".git").exists():
            try:
                log = subprocess.run(["git", "-C", str(self.root), "log", "--since=90.days", "--name-only", "--pretty=format:"], capture_output=True, text=True, timeout=30).stdout
                for line in log.splitlines():
                    if line.strip():
                        churn[line.strip()] = churn.get(line.strip(), 0) + 1
            except (OSError, subprocess.SubprocessError):
                pass
        now = time.time()
        out = []
        for rel in m.py_files:
            if m.is_test(rel):
                continue
            ext = sum(1 for i in m.imports.get(rel, []) if i["level"] == 0 and not i.get("resolved") and i["module"].split(".")[0] not in analysis.STDLIB)
            fan_in = len(m.reverse.get(rel, ()))
            recent = 1 if (now - (self.root / rel).stat().st_mtime) < 7 * 86400 else 0
            score = cx.get(rel, 0) * 0.3 + cnt.get(rel, 0) * 0.5 + fan_in * 0.6 + ext * 0.3 + churn.get(rel, 0) * 0.4 + recent
            if score > 0:
                out.append({"file": rel, "risk_score": round(score, 1), "reasons": {"complexity": cx.get(rel, 0), "findings": cnt.get(rel, 0),
                                                                                    "dependents": fan_in, "external_imports": ext, "recent_commits": churn.get(rel, 0),
                                                                                    "modified_last_7_days": bool(recent)}})
        return sorted(out, key=lambda r: -r["risk_score"])[:top]

    # ---- repair orchestration ------------------------------------------------------------------------------------------ #
    def repair_all(self, rules: Optional[List[str]] = None, approved: bool = False, include_tests: bool = True, limit: int = 100) -> List[dict]:
        results: List[dict] = []
        if not self.findings:
            self.scan()
        order = ["syntax-error", "missing-import", "mutable-default", "bare-except", "none-comparison", "is-literal-comparison", "insecure-deserialization",
                 "missing-timeout", "import-typo", "broken-import-name"]
        todo = [f for f in self.findings if f.rule in order and f.status not in ("FIXED", "VERIFIED") and (not rules or f.rule in rules)]
        todo.sort(key=lambda f: (order.index(f.rule), f.file, -f.line))        # bottom-up inside a file keeps line numbers valid
        done_files: Dict[str, int] = {}
        for f in todo[:limit]:
            if done_files.get(f.file):                     # re-analyse the file after a change: positions moved
                self.refresh()
                again = [x for x in analysis.analyze_python(self.model, f.file, self.model.sources[f.file]) if x.rule == f.rule and x.message == f.message] \
                    if f.file in self.model.sources and f.file.endswith(".py") else []
                if not again:
                    continue
                f = again[0]
            res = self.repair.repair_finding(f, approved=approved)
            results.append(res)
            if res.get("status") in ("FIXED", "VERIFIED"):
                done_files[f.file] = done_files.get(f.file, 0) + 1
                self.refresh()
                self.repair.baseline = None
        if include_tests and self.last_tests and self.last_tests.failures:
            self.repair.baseline = None
            results += self.repair.repair_failing_tests(approved=approved)
        return results

    # ---- self health --------------------------------------------------------------------------------------------------- #
    def self_health(self) -> dict:
        from .backup import sha256_bytes
        h: Dict[str, dict] = {}

        def check(name, fn):
            try:
                ok, detail = fn()
            except Exception as e:                           # noqa
                ok, detail = False, f"{type(e).__name__}: {e}"
            h[name] = {"ok": bool(ok), "detail": detail}
        tmp = Path(tempfile.mkdtemp(prefix="doctor_self_"))
        (tmp / "a.py").write_text("import os\n\ndef f(x=[]):\n    return x\n", encoding="utf-8")
        mm = discover(tmp)
        check("discovery", lambda: (len(mm.py_files) == 1, f"{len(mm.py_files)} file(s) discovered"))
        check("analysis", lambda: (any(f.rule == "mutable-default" for f in analysis.analyze(mm)), "detects a seeded mutable default"))
        check("security", lambda: (security.scan_security(mm) == [], "runs"))
        check("agents", lambda: (isinstance(agents_diag.analyze_agents(mm)[0], dict), "runs"))
        bm = BackupManager(tmp, tmp / "bk")
        def bk():
            bid = bm.create(["a.py"], "selftest")
            before = (tmp / "a.py").read_bytes()
            (tmp / "a.py").write_text("x = 1\n")
            r = bm.restore(bid)
            return r["ok"] and (tmp / "a.py").read_bytes() == before, "backup -> modify -> restore is byte-identical"
        check("backup_rollback", bk)
        check("knowledge", lambda: (self.kb.kv_get("__probe__", 0) == 0 and (self.kb.kv_set("__probe__", 1) or True) and self.kb.kv_get("__probe__") == 1, "sqlite read/write"))
        def sf():
            from .safety import SafetyError
            try:
                self.perm.resolve_in_scope(self.root.parent / "outside.txt")
                return False, "path outside project was NOT blocked"
            except SafetyError:
                return True, "writes outside the project are blocked"
        check("safety_controller", sf)
        bad = verify_integrity()
        check("integrity", lambda: (not bad, "safety modules unchanged" if not bad else f"MODIFIED/UNKNOWN: {bad}"))
        check("test_runner", lambda: (run_tests(tmp, mm, self.python).framework == "none", "runs (no tests in probe project)"))
        for name, e in self.engines.items():
            h["engine:" + name] = {"ok": e.healthy, "detail": e.history[-1]["error"] if e.history else "no failures recorded"}
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)
        return {"ok": all(v["ok"] for v in h.values()), "checks": h}

    # ---- full state for dashboard / reports --------------------------------------------------------------------------------- #
    def state(self, max_findings: int = 300) -> dict:
        from .monitor import monitor_status
        fs = [f for f in self.findings]
        open_ = [f for f in fs if f.status not in ("FIXED", "VERIFIED")]
        confirmed = [f for f in open_ if f.classification == "confirmed" and f.category != "security" or (f.category == "security" and f.classification == "confirmed")]
        reps = self.kb.repairs(100)
        t = self.last_tests
        return {
            "version": VERSION, "project": str(self.root), "mode": self.mode, "data_dir": str(self.data_dir), "last_scan": self.last_scan,
            "health": self.health_score(), "components": self.components(),
            "counts": {"confirmed_bugs": sum(1 for f in open_ if f.classification == "confirmed" and f.category not in ("security", "performance")),
                       "suspected": sum(1 for f in open_ if f.classification == "suspected"),
                       "recommendations": sum(1 for f in open_ if f.classification == "recommendation"),
                       "critical_vulnerabilities": sum(1 for f in open_ if f.category == "security" and f.severity in ("critical", "high")),
                       "performance_issues": sum(1 for f in open_ if f.category == "performance"),
                       "repaired": sum(1 for r in reps if r["status"] in ("FIXED", "VERIFIED", "APPROVED")),
                       "verified": sum(1 for r in reps if r["status"] == "VERIFIED" or (r["status"] == "APPROVED")),
                       "rolled_back": sum(1 for r in reps if r["status"] == "ROLLED BACK"),
                       "needs_approval": sum(1 for r in reps if r["status"] == "NEEDS APPROVAL"),
                       "unresolved": len(open_)},
            "tests": t.to_dict() if t else None,
            "findings": [f.to_dict() for f in fs[:max_findings]], "repairs": reps[:30], "events": self.kb.events(25),
            "monitoring": monitor_status(self.data_dir), "risks": self.predict_risks(), "architecture": {k: v for k, v in self.arch.items() if k != "entry_reach"},
            "agents": self.agents_info, "technologies": self.model.summary(), "integrity": verify_integrity(),
            "engines": {n: {"healthy": e.healthy, "state": e.breaker.state, "failures": len(e.history)} for n, e in self.engines.items()},
            "scans": self.kb.scans(10),
        }
