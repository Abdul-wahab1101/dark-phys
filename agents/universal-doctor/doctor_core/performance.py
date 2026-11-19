"""Performance Optimization Engine: static smells with evidence + measured runtime facts."""
from __future__ import annotations

import ast
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

from .discovery import ProjectModel
from .models import Finding

try:
    import resource
except ImportError:                                  # Windows
    resource = None


def scan_performance(m: ProjectModel) -> List[Finding]:
    out: List[Finding] = []
    for rel, tree in m.trees.items():
        if m.is_test(rel):
            continue
        lines = m.sources[rel].split("\n")

        def add(rule, node, sev, msg, why, fix, conf=0.6):
            out.append(Finding(rule, "performance", sev, "suspected", rel, node.lineno, msg, conf, evidence=lines[node.lineno - 1].strip()[:140],
                               root_cause=why, fix_plan=fix))
        loops = [n for n in ast.walk(tree) if isinstance(n, (ast.For, ast.While, ast.AsyncFor))]
        for lp in loops:
            depth = 0
            for sub in ast.walk(lp):
                if isinstance(sub, (ast.For, ast.While)) and sub is not lp:
                    depth = max(depth, 1)
            inner = [n for n in ast.walk(lp)]
            for n in inner:
                if isinstance(n, ast.AugAssign) and isinstance(n.op, ast.Add) and isinstance(n.target, ast.Name) and \
                        (isinstance(n.value, ast.JoinedStr) or (isinstance(n.value, ast.Constant) and isinstance(n.value.value, str))):
                    add("string-concat-in-loop", n, "low", "string built with += inside a loop", "Each += copies the whole string (quadratic).", "Collect parts in a list and ''.join().", 0.6)
                if isinstance(n, ast.Call):
                    f = ast.unparse(n.func)
                    if f == "open":
                        add("io-in-loop", n, "medium", "file opened inside a loop", "Repeated open/close multiplies I/O cost.", "Open once outside the loop / cache the content.", 0.55)
                    elif re.search(r"\.execute$|\.query$", f):
                        add("n-plus-one-query", n, "medium", "database call inside a loop", "One query per iteration (N+1 problem).", "Batch the query (IN clause / join / executemany).", 0.6)
                    elif re.match(r"re\.(match|search|sub|findall|fullmatch|split)$", f) and n.args and isinstance(n.args[0], ast.Constant):
                        add("regex-in-loop", n, "low", "regular expression with a literal pattern used inside a loop", "Pattern lookup/compile overhead per iteration.", "Pre-compile with re.compile outside the loop.", 0.4)
                    elif re.search(r"(requests|httpx)\.(get|post|put|delete)$", f):
                        add("network-in-loop", n, "medium", "HTTP request inside a loop", "Sequential network latency adds up.", "Use a session, batching or concurrency.", 0.6)
        for n in ast.walk(tree):
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                span = (getattr(n, "end_lineno", n.lineno) - n.lineno)
                if span > 250:
                    add("very-long-function", n, "low", f"{n.name}() is {span} lines long", "Large functions hide repeated work and are hard to profile.", "Split into smaller functions.", 0.5)
            if isinstance(n, ast.For) and isinstance(n.iter, ast.Call) and ast.unparse(n.iter.func) == "range" and n.iter.args and \
                    isinstance(n.iter.args[0], ast.Call) and ast.unparse(n.iter.args[0].func) == "len":
                add("range-len-loop", n, "info", "for i in range(len(x))", "Indexing is slower and less clear than iterating directly.", "Use enumerate()/direct iteration.", 0.5)
    return out


def run_measured(cmd: List[str], cwd: Path, timeout: float = 60, env: Optional[dict] = None) -> Dict:
    """Run a command and report wall time and peak child memory (where the OS supports it)."""
    e = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    e.update(env or {})
    t0 = time.perf_counter()
    base = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss if resource else 0
    try:
        p = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True, timeout=timeout, env=e, errors="replace")
        rc, out, err, to = p.returncode, p.stdout, p.stderr, False
    except subprocess.TimeoutExpired as ex:
        rc, out, err, to = -9, (ex.stdout or b"").decode(errors="replace") if isinstance(ex.stdout, bytes) else (ex.stdout or ""), "timeout", True
    dur = time.perf_counter() - t0
    peak = None
    if resource:
        after = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
        peak = round((after if sys.platform != "darwin" else after / 1024) / 1024, 1) if after >= base else None
    return {"returncode": rc, "seconds": round(dur, 3), "peak_mb": peak, "timeout": to, "stdout": out[-2000:], "stderr": err[-2000:]}


def import_timing(m: ProjectModel, cwd: Path, modules: List[str], python: str, threshold: float = 2.0) -> List[Finding]:
    """Measure how long importing each entry module takes (in a throw-away copy)."""
    out: List[Finding] = []
    for rel in modules[:12]:
        mod = rel[:-3].replace("/", ".")
        r = run_measured([python, "-c", f"import sys; sys.path.insert(0, r'{cwd}'); sys.path.insert(0, r'{cwd / rel.rsplit('/', 1)[0] if '/' in rel else cwd}'); import {rel.rsplit('/', 1)[-1][:-3]}"],
                         cwd, timeout=30)
        if r["seconds"] > threshold and not r["timeout"]:
            out.append(Finding("slow-import", "performance", "low", "confirmed", rel, 1, f"importing {mod} takes {r['seconds']} s", 0.85,
                               root_cause="Heavy work (model loading, network, big imports) happens at import time.",
                               fix_plan="Defer expensive initialisation (lazy import / lazy init).", extra=r))
    return out
