"""Root Cause Analysis: turn failures / findings into (symptom -> origin -> cause -> impact -> fix design -> verification)."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, List, Optional

from .discovery import ProjectModel, impact_of
from .models import Finding

HINTS = [
    (r"AssertionError: (.+)", "An assertion about the result failed: the computed value differs from the expected one. Inspect the arithmetic/comparison in the function under test."),
    (r"NameError: name '(\w+)' is not defined", "A name is used before/without being defined or imported."),
    (r"ImportError|ModuleNotFoundError", "An import failed: wrong name/path, or a missing dependency."),
    (r"TypeError: (\w+)\(\) (takes|missing)", "A function was called with the wrong number of arguments."),
    (r"TypeError", "An operation received a value of an unexpected type."),
    (r"KeyError: (.+)", "A dictionary key is read that does not exist; the producer of the data and the consumer disagree."),
    (r"IndexError", "A sequence is indexed past its end (off-by-one or empty input)."),
    (r"ZeroDivisionError", "A division by zero; the divisor is not validated."),
    (r"AttributeError: (.+)", "An attribute/method does not exist on the object (typo, wrong type or None)."),
    (r"ValueError", "A value has the right type but an invalid content."),
    (r"RecursionError", "Unbounded recursion - missing base case."),
    (r"TimeoutError|timeout", "The operation did not finish in time (hang or infinite loop)."),
]


def explain(message: str) -> str:
    for rx, text in HINTS:
        if re.search(rx, message):
            return text
    return "The code raised an unexpected error; see the traceback for the origin."


def origin_frame(frames: List[dict], root: Path, m: Optional[ProjectModel]) -> Optional[dict]:
    """Innermost frame that is inside the project; prefer non-test code (the bug is rarely in the test)."""
    root = str(Path(root).resolve())
    inside = []
    for fr in frames:
        rel = fr.get("rel")
        if rel is None:
            try:
                rel = Path(fr["file"]).resolve().relative_to(root).as_posix()
            except (ValueError, OSError):
                continue
        inside.append(dict(fr, rel=rel))
    non_test = [fr for fr in inside if not (m and m.is_test(fr["rel"]))]
    pool = non_test or inside
    return pool[-1] if pool else None


def infer_under_test(frames: List[dict], root: Path, m: ProjectModel) -> Optional[dict]:
    """An AssertionError traceback ends inside the test. Find which project function that failing line calls
    (e.g. `calc.average(...)` -> app/calc.py::average) - that is where the bug lives."""
    import ast as _ast
    from .discovery import resolve_import
    root_s = str(Path(root).resolve())
    test_frame = None
    for fr in frames:
        rel = fr.get("rel")
        if rel is None:
            try:
                rel = Path(fr["file"]).resolve().relative_to(root_s).as_posix()
            except (ValueError, OSError):
                continue
        if m.is_test(rel) and rel in m.trees:
            test_frame = dict(fr, rel=rel)
    if not test_frame:
        return None
    rel, line = test_frame["rel"], test_frame["line"]
    alias: dict = {}
    for imp in m.imports.get(rel, []):
        if imp["level"] == -1:
            continue
        if imp["names"]:
            for n in imp["names"]:
                sub = resolve_import(m, rel, (imp["module"] + "." if imp["module"] else "") + n, imp["level"])
                if sub:
                    alias[n] = ("module", sub, "")
                elif imp.get("resolved"):
                    alias[n] = ("name", imp["resolved"], n)
        elif imp.get("resolved"):
            alias[(imp.get("asname") or imp["module"].split(".")[0])] = ("module", imp["resolved"], "")
    for node in _ast.walk(m.trees[rel]):
        if isinstance(node, _ast.Call) and node.lineno <= line <= getattr(node, "end_lineno", node.lineno):
            target = None
            if isinstance(node.func, _ast.Attribute) and isinstance(node.func.value, _ast.Name) and alias.get(node.func.value.id, ("",))[0] == "module":
                target = (alias[node.func.value.id][1], node.func.attr)
            elif isinstance(node.func, _ast.Name) and alias.get(node.func.id, ("",))[0] == "name":
                target = (alias[node.func.id][1], alias[node.func.id][2])
            if target and target[0] in m.trees:
                for fn in _ast.walk(m.trees[target[0]]):
                    if isinstance(fn, (_ast.FunctionDef, _ast.AsyncFunctionDef)) and fn.name == target[1]:
                        return {"rel": target[0], "line": fn.body[0].lineno, "func": fn.name, "code": "", "inferred": True, "file": target[0]}
    return None


def analyze_failure(failure: dict, root: Path, m: ProjectModel) -> dict:
    """Root-cause record for ONE failing test (reproduced, therefore 'confirmed')."""
    o = origin_frame(failure.get("frames", []), root, m)
    inferred = False
    if o is None or m.is_test(o["rel"]):
        guess = infer_under_test(failure.get("frames", []), root, m)
        if guess:
            o, inferred = guess, True
    rec = {
        "symptom": f"test {failure['id']} {failure['kind'].lower()}ed: {failure['message']}",
        "classification": "confirmed", "confidence": (0.65 if inferred else 0.9) if o else 0.6, "severity": "high",
        "origin": {"file": o["rel"], "line": o["line"], "function": o["func"], "code": o["code"], "inferred": inferred} if o else None,
        "root_cause": explain(failure["message"]) + (f" Origin: {o['rel']}:{o['line']} in {o['func']}()" + (" (inferred: the failing test line calls this function)." if inferred else ".") if o else ""),
        "trace": [f"{fr['file']}:{fr['line']} in {fr['func']}" for fr in failure.get("frames", [])][-6:],
        "affected": [], "fix_design": "", "verification": f"re-run {failure['id']} and the complete suite; all previously passing tests must still pass",
    }
    if o:
        imp = impact_of(m, [o["rel"]])
        rec["affected"] = imp["dependents"][:15]
        rec["impact_risk"] = imp["risk"]
        rec["fix_design"] = "minimal targeted change inside " + (o["func"] + "()" if o["func"] else o["rel"])
    return rec


def enrich_finding(f: Finding, m: ProjectModel) -> Finding:
    """Attach impact (dependents) to a static finding."""
    if f.file in m.sources and not f.affected:
        imp = impact_of(m, [f.file])
        f.affected = imp["dependents"][:12]
        f.extra.setdefault("impact_risk", imp["risk"])
        f.extra.setdefault("affected_tests", imp["tests"][:10])
    if not f.fix_plan:
        f.fix_plan = "see root cause"
    return f
