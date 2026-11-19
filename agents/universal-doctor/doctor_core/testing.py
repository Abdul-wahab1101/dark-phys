"""Testing & Verification engine: throw-away shadow workspace, test runner (unittest / pytest / npm), runtime import checks."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Optional

from .config import IGNORED_DIRS
from .discovery import ProjectModel
from .models import Finding, TestRun

TB_FRAME = re.compile(r'File "(?P<file>[^"]+)", line (?P<line>\d+), in (?P<func>[\w<>]+)(?:\n\s+(?P<code>[^\n]+))?')
PT_FRAME = re.compile(r"^(?P<file>[^\s:]+\.py):(?P<line>\d+): in (?P<func>[\w<>]+)\n\s+(?P<code>[^\n]*)", re.M)


def find_python(root: Path) -> str:
    for cand in (".venv/Scripts/python.exe", "venv/Scripts/python.exe", ".venv/bin/python", "venv/bin/python"):
        p = Path(root) / cand
        if p.exists():
            return str(p)
    return sys.executable


class Shadow:
    """A private copy of the project: repairs are verified here BEFORE the real project is touched."""

    def __init__(self, root: Path, data_dir: Optional[Path] = None):
        self.src = Path(root).resolve()
        self.path = Path(tempfile.mkdtemp(prefix="doctor_shadow_")) / "project"
        skip = set(IGNORED_DIRS)
        data = Path(data_dir).resolve() if data_dir else None

        def ignore(d, names):
            out = []
            for n in names:
                p = Path(d) / n
                if n in skip or n.endswith(".doctor-tmp") or (data and p.resolve() == data):
                    out.append(n)
                else:
                    try:
                        if p.is_file() and p.stat().st_size > 25_000_000:
                            out.append(n)
                    except OSError:
                        pass
            return out
        shutil.copytree(self.src, self.path, ignore=ignore, symlinks=False)

    def write(self, rel: str, text_lf: str, newline: str = "\n") -> None:
        p = self.path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(text_lf.replace("\n", newline).encode("utf-8"))

    def cleanup(self) -> None:
        shutil.rmtree(self.path.parent, ignore_errors=True)


def _env() -> dict:
    return dict(os.environ, PYTHONDONTWRITEBYTECODE="1", PYTHONIOENCODING="utf-8", DOCTOR_RUNTIME_CHECK="1")


def pytest_available(python: str) -> bool:
    try:
        return subprocess.run([python, "-m", "pytest", "--version"], capture_output=True, timeout=30).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def detect_framework(m: ProjectModel, python: str) -> str:
    py_tests = [t for t in m.tests if t.endswith(".py")]
    if py_tests:
        uses_pytest = any(re.search(r"\bimport pytest\b|\bpytest\.", m.sources.get(t, "")) for t in py_tests) or \
            any(f["rel"].rsplit("/", 1)[-1] in ("pytest.ini", "conftest.py") for f in m.files)
        uses_unittest = any("unittest" in m.sources.get(t, "") for t in py_tests)
        if uses_pytest and pytest_available(python):
            return "pytest"
        if uses_unittest or not uses_pytest:
            return "unittest"
        return "unittest"
    for rel, text in m.sources.items():
        if rel.endswith("package.json") and '"test"' in text and shutil.which("npm"):
            return "npm"
    return "none"


def _parse_unittest(out: str, run: TestRun) -> None:
    m = re.search(r"^Ran (\d+) tests? in ([\d.]+)s", out, re.M)
    if m:
        run.total, run.duration = int(m.group(1)), float(m.group(2))
    run.ran = bool(m) or "Ran 0 tests" in out
    sk = re.search(r"skipped=(\d+)", out)
    run.skipped = int(sk.group(1)) if sk else 0
    for line in out.splitlines():
        mm = re.match(r"^(?P<name>.+?) \.\.\. ok$", line)
        if mm:
            idm = re.search(r"\(([\w\.]+)\)", mm.group("name"))
            if idm:
                run.passed_ids.append(idm.group(1))
    for sec in re.split(r"^={60,}\n", out, flags=re.M)[1:]:
        head = sec.split("\n", 1)[0]
        mm = re.match(r"(FAIL|ERROR): (.+?) \(([\w\.<>]+)\)", head)
        if not mm:
            mm2 = re.match(r"(FAIL|ERROR): ([\w\.<>]+)", head)
            if not mm2:
                continue
            kind, tid = mm2.group(1), mm2.group(2)
        else:
            kind, tid = mm.group(1), mm.group(3)
        tb = sec.split("-" * 70 + "\n", 1)[-1]
        tb = re.split(r"\n-{70}\nRan ", tb)[0]
        last = [ln for ln in tb.strip().splitlines() if ln.strip()][-1] if tb.strip() else ""
        frames = [{"file": f.group("file"), "line": int(f.group("line")), "func": f.group("func"), "code": (f.group("code") or "").strip()}
                  for f in TB_FRAME.finditer(tb)]
        run.failures.append({"id": tid, "kind": kind, "message": last[:300], "traceback": tb[-3000:], "frames": frames})
        if kind == "FAIL":
            run.failed += 1
        else:
            run.errors += 1
    if run.total:
        run.passed = max(0, run.total - run.failed - run.errors - run.skipped)
    if not run.failures and re.search(r"^(FAILED|ERROR)", out, re.M) is None and run.ran:
        pass
    # import errors of test modules show up as ERROR: unittest.loader._FailedTest.xxx
    # (handled by the generic ERROR section above)


def _parse_pytest_xml(path: Path, run: TestRun) -> None:
    root = ET.parse(path).getroot()
    suite = root if root.tag == "testsuite" else root.find("testsuite")
    run.ran = True
    run.total = int(suite.get("tests", 0))
    run.skipped = int(suite.get("skipped", 0))
    run.duration = float(suite.get("time", 0))
    for tc in suite.iter("testcase"):
        tid = f"{tc.get('classname')}.{tc.get('name')}"
        bad = tc.find("failure")
        kind = "FAIL"
        if bad is None:
            bad = tc.find("error")
            kind = "ERROR"
        if bad is None:
            if tc.find("skipped") is None:
                run.passed_ids.append(tid)
            continue
        text = bad.text or ""
        frames = [{"file": f.group("file"), "line": int(f.group("line")), "func": f.group("func"), "code": f.group("code").strip()} for f in PT_FRAME.finditer(text)]
        run.failures.append({"id": tid, "kind": kind, "message": (bad.get("message") or "")[:300], "traceback": text[-3000:], "frames": frames})
        if kind == "FAIL":
            run.failed += 1
        else:
            run.errors += 1
    run.passed = max(0, run.total - run.failed - run.errors - run.skipped)


def _annotate_frames(run: TestRun, root: Path) -> None:
    """Add fr['rel'] = path relative to the directory the tests ran in (the shadow copy), so a traceback from a
    throw-away copy can be mapped back onto the real project."""
    try:
        base = Path(root).resolve()
    except OSError:
        return
    for failure in run.failures:
        for fr in failure.get("frames", []):
            try:
                fr["rel"] = Path(fr["file"]).resolve().relative_to(base).as_posix()
            except (ValueError, OSError):
                pass


def run_tests(root: Path, m: ProjectModel, python: Optional[str] = None, targets: Optional[List[str]] = None,
              timeout: float = 300, framework: Optional[str] = None) -> TestRun:
    run = _run_tests(root, m, python, targets, timeout, framework)
    _annotate_frames(run, Path(root))
    return run


def _run_tests(root: Path, m: ProjectModel, python: Optional[str] = None, targets: Optional[List[str]] = None,
               timeout: float = 300, framework: Optional[str] = None) -> TestRun:
    root = Path(root)
    python = python or find_python(root)
    fw = framework or detect_framework(m, python)
    run = TestRun(framework=fw)
    t0 = time.time()
    if fw == "none":
        run.note = "no test suite detected (no test_*.py / *_test.py / package.json test script)"
        return run
    try:
        if fw == "unittest":
            mods = targets or sorted({t[:-3].replace("/", ".") for t in m.tests if t.endswith(".py") and t.rsplit("/", 1)[-1] != "conftest.py"
                                      and re.fullmatch(r"[\w/]+\.py", t)})
            if not mods:
                run.note = "no importable unittest modules found"
                return run
            p = subprocess.run([python, "-m", "unittest", "-v", *mods], cwd=str(root), capture_output=True, text=True, timeout=timeout,
                               env=_env(), errors="replace")
            out = (p.stdout or "") + "\n" + (p.stderr or "")
            _parse_unittest(out, run)
            run.raw_tail = out[-1500:]
            if not run.ran:
                run.note = "unittest produced no result summary (see raw_tail)"
        elif fw == "pytest":
            xml = Path(tempfile.mkdtemp(prefix="doctor_pt_")) / "r.xml"
            args = [python, "-m", "pytest", "-q", "-x" if False else "-q", f"--junitxml={xml}", "--tb=short", "-p", "no:cacheprovider"]
            args += targets or []
            p = subprocess.run(args, cwd=str(root), capture_output=True, text=True, timeout=timeout, env=_env(), errors="replace")
            run.raw_tail = ((p.stdout or "") + (p.stderr or ""))[-1500:]
            if xml.exists():
                _parse_pytest_xml(xml, run)
            else:
                run.note = "pytest produced no report (collection error?)"
            shutil.rmtree(xml.parent, ignore_errors=True)
        elif fw == "npm":
            p = subprocess.run(["npm", "test", "--silent"], cwd=str(root), capture_output=True, text=True, timeout=timeout, errors="replace")
            run.ran, run.total = True, 1
            run.raw_tail = ((p.stdout or "") + (p.stderr or ""))[-1500:]
            if p.returncode == 0:
                run.passed = 1
            else:
                run.failed = 1
                run.failures.append({"id": "npm test", "kind": "FAIL", "message": run.raw_tail[-200:], "traceback": run.raw_tail, "frames": []})
    except subprocess.TimeoutExpired:
        run.ran, run.errors = True, 1
        run.failures.append({"id": "<timeout>", "kind": "ERROR", "message": f"test run exceeded {timeout}s (possible hang / infinite loop)", "traceback": "", "frames": []})
        run.note = "timeout"
    except OSError as e:
        run.note = f"could not start test runner: {e}"
    run.duration = run.duration or round(time.time() - t0, 3)
    return run


def runtime_import_check(root: Path, rels: List[str], python: Optional[str] = None, timeout: float = 25) -> List[Finding]:
    """Import every module (as a module, __main__ guard NOT triggered) in a subprocess and report crashes."""
    root = Path(root)
    python = python or find_python(root)
    out: List[Finding] = []
    for rel in rels:
        d = str((root / rel).parent)
        code = ("import importlib.util, sys\n"
                f"sys.path.insert(0, r'{root}'); sys.path.insert(0, r'{d}')\n"
                f"spec = importlib.util.spec_from_file_location('doctor_probe_module', r'{root / rel}')\n"
                "mod = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(mod)\n")
        try:
            p = subprocess.run([python, "-c", code], cwd=str(root), capture_output=True, text=True, timeout=timeout, env=_env(), errors="replace")
        except subprocess.TimeoutExpired:
            out.append(Finding("runtime-import-timeout", "runtime", "low", "suspected", rel, 1,
                               f"importing the module did not finish in {timeout}s (starts a server/long job at import time?)", 0.5,
                               root_cause="Code runs at import time instead of behind an if __name__ == '__main__' guard.",
                               fix_plan="Move side effects into functions / a main guard."))
            continue
        if p.returncode != 0:
            err = (p.stderr or "").strip()
            frames = [{"file": f.group("file"), "line": int(f.group("line")), "func": f.group("func"), "code": (f.group("code") or "").strip()}
                      for f in TB_FRAME.finditer(err)]
            last = err.splitlines()[-1] if err else "unknown error"
            line = 1
            for fr in reversed(frames):
                if fr["file"].endswith(rel.rsplit("/", 1)[-1]) or "doctor_probe" in fr["file"]:
                    line = fr["line"]
                    break
            out.append(Finding("runtime-import-failure", "runtime", "high", "confirmed", rel, line, f"importing the module fails: {last[:200]}", 0.95,
                               evidence=err[-400:], root_cause="The module raises an exception while it is being imported - reproduced in a throw-away copy.",
                               fix_plan="Fix the error shown in the traceback.", extra={"frames": frames, "error": last[:300]}))
    return out
