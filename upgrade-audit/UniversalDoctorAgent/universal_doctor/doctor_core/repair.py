"""Autonomous / supervised Repair Engine: minimal targeted patches, verified in a shadow copy first,
backups before every write, rollback on regression, repair history to avoid repeating failed fixes."""
from __future__ import annotations

import ast
import difflib
import json
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

from .backup import BackupManager, atomic_write_text, read_text_preserving, sha256_bytes
from .config import DOCTOR_ROOT
from .discovery import ProjectModel, discover
from .models import Finding, Patch, TestRun
from .safety import NeedsApproval, PermissionController, SafetyError
from .testing import Shadow, find_python, run_tests


# --------------------------------------------------------------------------- #
# text helpers
# --------------------------------------------------------------------------- #
def byte_col_to_idx(line: str, col: int) -> int:
    return len(line.encode("utf-8")[:col].decode("utf-8", errors="ignore"))


def abs_index(lines: List[str], lineno: int, col: int) -> int:
    """Index in '\\n'.join(lines) of an AST (lineno, utf-8 byte col) position."""
    return sum(len(l) + 1 for l in lines[:lineno - 1]) + byte_col_to_idx(lines[lineno - 1], col)


def count_changed(old: str, new: str) -> int:
    return sum(1 for l in difflib.unified_diff(old.split("\n"), new.split("\n"), lineterm="", n=0)
               if (l.startswith("+") or l.startswith("-")) and not l.startswith(("+++", "---")))


# --------------------------------------------------------------------------- #
# fixers: (finding, text_lf) -> new_text | None
# --------------------------------------------------------------------------- #
def _replace_span(text: str, line: int, col: int, end_col: int, expect: Optional[str], new: str) -> Optional[str]:
    lines = text.split("\n")
    if not (0 < line <= len(lines)):
        return None
    start, end = byte_col_to_idx(lines[line - 1], col), byte_col_to_idx(lines[line - 1], end_col)
    if expect is not None and lines[line - 1][start:end] != expect:
        return None
    lines[line - 1] = lines[line - 1][:start] + new + lines[line - 1][end:]
    return "\n".join(lines)


def fix_mutable_default(f: Finding, text: str) -> Optional[str]:
    x = f.extra
    new = _replace_span(text, x["line"], x["col"], x["end_col"], x["src"], "None")
    if new is None:
        return None
    try:
        tree = ast.parse(new)
    except SyntaxError:
        return None
    fn = next((n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.lineno == x["func_line"] and n.name == x["func"]), None)
    if fn is None:
        return None
    first = fn.body[0]
    after = first.end_lineno if (isinstance(first, ast.Expr) and isinstance(getattr(first, "value", None), ast.Constant)
                                 and isinstance(first.value.value, str) and len(fn.body) > 1) else first.lineno - 1
    lines = new.split("\n")
    indent = " " * first.col_offset if "\t" not in lines[first.lineno - 1][:first.col_offset] else "\t" * first.col_offset
    if first.lineno == fn.lineno:
        return None
    guard = [f"{indent}if {x['arg']} is None:", f"{indent}{indent[:4] if indent.startswith(' ') else chr(9)}{x['arg']} = {x['src']}"]
    if indent.startswith(" "):
        guard[1] = f"{indent}    {x['arg']} = {x['src']}"
    lines[after:after] = guard
    return "\n".join(lines)


def fix_bare_except(f: Finding, text: str) -> Optional[str]:
    lines = text.split("\n")
    L = lines[f.line - 1]
    new = re.sub(r"except\s*:", "except Exception:", L, count=1)
    if new == L:
        return None
    lines[f.line - 1] = new
    return "\n".join(lines)


def fix_none_comparison(f: Finding, text: str) -> Optional[str]:
    x = f.extra
    seg = x.get("src") or ""
    new_seg = re.sub(r"\s*!=\s*None\b", " is not None", seg, count=1) if x.get("neg") else re.sub(r"\s*==\s*None\b", " is None", seg, count=1)
    if new_seg == seg:
        return None
    return _replace_span(text, x["line"], x["col"], x["end_col"], seg, new_seg)


def fix_is_literal(f: Finding, text: str) -> Optional[str]:
    x = f.extra
    seg = x.get("src") or ""
    new_seg = re.sub(r"\s+is\s+not\s+", " != ", seg, count=1) if x.get("neg") else re.sub(r"\s+is\s+", " == ", seg, count=1)
    if new_seg == seg:
        return None
    return _replace_span(text, x["line"], x["col"], x["end_col"], seg, new_seg)


def fix_yaml_load(f: Finding, text: str) -> Optional[str]:
    x = f.extra
    return _replace_span(text, x["line"], x["col"], x["end_col"], "yaml.load", "yaml.safe_load")


def fix_missing_import(f: Finding, text: str) -> Optional[str]:
    mod = f.extra["module"]
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return None
    lines = text.split("\n")
    idx = None
    for st in tree.body:
        if isinstance(st, (ast.Import, ast.ImportFrom)) and not (isinstance(st, ast.ImportFrom) and st.module == "__future__"):
            idx = st.lineno - 1
            break
    if idx is None:
        idx = 0
        for st in tree.body:
            if (isinstance(st, ast.Expr) and isinstance(getattr(st, "value", None), ast.Constant) and isinstance(st.value.value, str)) or \
                    (isinstance(st, ast.ImportFrom) and st.module == "__future__"):
                idx = st.end_lineno
            else:
                break
    lines.insert(idx, f"import {mod}")
    return "\n".join(lines)


def fix_syntax_colon(f: Finding, text: str) -> Optional[str]:
    lines = text.split("\n")
    L = lines[f.line - 1]
    if L.rstrip().endswith(":"):
        return None
    code, sep, comment = L.partition("  #") if "  #" in L else (L, "", "")
    lines[f.line - 1] = code.rstrip() + ":" + (("  #" + comment) if sep else "")
    new = "\n".join(lines)
    try:
        ast.parse(new)
        return new
    except SyntaxError as e:
        return new if (e.lineno or 0) != f.line else None


def fix_missing_timeout(f: Finding, text: str) -> Optional[str]:
    x = f.extra
    lines = text.split("\n")
    L = lines[f.line - 1]
    close = byte_col_to_idx(L, x["end_col"]) - 1
    if close < 0 or L[close] != ")":
        return None
    ins = ", timeout=30" if x.get("has_args") else "timeout=30"
    lines[f.line - 1] = L[:close] + ins + L[close:]
    return "\n".join(lines)


def fix_import_typo(f: Finding, text: str) -> Optional[str]:
    sug, line = f.extra.get("suggestion"), f.line
    top = re.search(r"import '(\w+)'", f.message)
    if not sug or not top:
        return None
    lines = text.split("\n")
    new = re.sub(rf"\b{re.escape(top.group(1))}\b", sug, lines[line - 1], count=1)
    if new == lines[line - 1]:
        return None
    lines[line - 1] = new
    return "\n".join(lines)


def fix_broken_import_name(f: Finding, text: str) -> Optional[str]:
    sug, name = f.extra.get("suggestion"), f.extra.get("name")
    if not sug or not name:
        return None
    lines = text.split("\n")
    new = re.sub(rf"\b{re.escape(name)}\b", sug, lines[f.line - 1], count=1)
    if new == lines[f.line - 1]:
        return None
    lines[f.line - 1] = new
    return "\n".join(lines)


FIXERS: Dict[str, Callable[[Finding, str], Optional[str]]] = {
    "mutable-default": fix_mutable_default, "bare-except": fix_bare_except, "none-comparison": fix_none_comparison,
    "is-literal-comparison": fix_is_literal, "insecure-deserialization": fix_yaml_load, "missing-import": fix_missing_import,
    "syntax-error": fix_syntax_colon, "missing-timeout": fix_missing_timeout, "import-typo": fix_import_typo,
    "broken-import-name": fix_broken_import_name,
}
# risk of each fix when applied automatically
FIX_RISK = {"import-typo": "medium", "broken-import-name": "medium", "missing-timeout": "medium"}


def make_patch(f: Finding, text: str) -> Optional[Patch]:
    fixer = FIXERS.get(f.rule)
    if not fixer or f.file.rsplit(".", 1)[-1] not in ("py",):
        return None
    if f.rule == "insecure-deserialization" and "line" not in f.extra:
        return None
    try:
        new = fixer(f, text)
    except (KeyError, IndexError, ValueError):
        return None
    if not new or new == text:
        return None
    if f.rule != "syntax-error":
        try:
            ast.parse(new)
        except SyntaxError:
            return None
    return Patch(finding_id=f.id, rule=f.rule, strategy=f"fixer:{f.rule}", description=f.fix_plan or f.message,
                 files={f.file: [text, new]}, risk=FIX_RISK.get(f.rule, f.risk if f.risk in ("low", "medium", "high") else "low"),
                 changed_lines=count_changed(text, new))


# --------------------------------------------------------------------------- #
# test-guided mutation repair (logic bugs)
# --------------------------------------------------------------------------- #
_CMP = {ast.Eq: ("==", [("!=", "==→!=")]), ast.NotEq: ("!=", [("==", "!=→==")]),
        ast.Lt: ("<(?!=)", [("<=", "<→<="), (">", "<→>")]), ast.LtE: ("<=", [("<", "<=→<"), (">=", "<=→>=")]),
        ast.Gt: (">(?!=)", [(">=", ">→>="), ("<", ">→<")]), ast.GtE: (">=", [(">", ">=→>"), ("<=", ">=→<=")]),
        ast.Is: (r"\bis\b(?!\s+not)", [("is not", "is→is not")]), ast.In: (r"\bin\b", [("not in", "in→not in")])}
_BIN = {ast.Add: (r"\+", [("-", "+→-")]), ast.Sub: (r"-", [("+", "-→+")]), ast.Mult: (r"\*(?!\*)", [("/", "*→/"), ("+", "*→+")]),
        ast.Div: (r"/(?!/)", [("*", "/→*")]), ast.FloorDiv: (r"//", [("/", "//→/")]), ast.Mod: (r"%", [("//", "%→//")])}


def mutation_candidates(text: str, fail_line: int, limit: int = 80) -> List[Tuple[str, str, int]]:
    """Single-edit mutants of the function that contains `fail_line`: (description, new_text, line)."""
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return []
    funcs = [n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.lineno <= fail_line <= n.end_lineno]
    if not funcs:
        return []
    fn = min(funcs, key=lambda n: n.end_lineno - n.lineno)
    lines = text.split("\n")
    out: List[Tuple[int, str, str, int]] = []

    def span(a_end, b_start):
        i, j = abs_index(lines, a_end[0], a_end[1]), abs_index(lines, b_start[0], b_start[1])
        return i, j

    def add(prio_line, desc, i, j, rx, repl):
        seg = text[i:j]
        m = re.search(rx, seg)
        if m:
            out.append((abs(prio_line - fail_line), desc, text[:i + m.start()] + repl + text[i + m.end():], prio_line))
    for n in ast.walk(fn):
        if isinstance(n, ast.Compare):
            ops, operands = n.ops, [n.left] + n.comparators
            for k, op in enumerate(ops):
                if type(op) in _CMP and not isinstance(op, ast.NotIn) :
                    rx, alts = _CMP[type(op)]
                    i, j = span((operands[k].end_lineno, operands[k].end_col_offset), (operands[k + 1].lineno, operands[k + 1].col_offset))
                    for repl, d in alts:
                        add(n.lineno, f"comparison {d} (line {n.lineno})", i, j, rx, repl)
        elif isinstance(n, ast.BinOp) and type(n.op) in _BIN:
            rx, alts = _BIN[type(n.op)]
            i, j = span((n.left.end_lineno, n.left.end_col_offset), (n.right.lineno, n.right.col_offset))
            for repl, d in alts:
                add(n.lineno, f"operator {d} (line {n.lineno})", i, j, rx, repl)
        elif isinstance(n, ast.BoolOp) and len(n.values) >= 2:
            tok, alt = ("and", "or") if isinstance(n.op, ast.And) else ("or", "and")
            i, j = span((n.values[0].end_lineno, n.values[0].end_col_offset), (n.values[1].lineno, n.values[1].col_offset))
            add(n.lineno, f"boolean {tok}→{alt} (line {n.lineno})", i, j, rf"\b{tok}\b", alt)
        elif isinstance(n, ast.Constant) and isinstance(n.value, int) and not isinstance(n.value, bool) and n.end_lineno == n.lineno and abs(n.value) < 1000:
            i, j = abs_index(lines, n.lineno, n.col_offset), abs_index(lines, n.end_lineno, n.end_col_offset)
            for delta in (-1, 1):
                out.append((abs(n.lineno - fail_line) + 1, f"constant {n.value}→{n.value + delta} (line {n.lineno})", text[:i] + str(n.value + delta) + text[j:], n.lineno))
    out.sort(key=lambda t: (t[0], t[1]))
    seen, res = set(), []
    for _, d, new, ln in out:
        if new not in seen and new != text:
            try:
                ast.parse(new)
            except SyntaxError:
                continue
            seen.add(new)
            res.append((d, new, ln))
        if len(res) >= limit:
            break
    return res


# --------------------------------------------------------------------------- #
class RepairEngine:
    def __init__(self, doctor):
        self.d = doctor                       # the orchestrator: root, settings, perm, backup, kb, model, python
        self.baseline: Optional[TestRun] = None
        self.extra_post_check: Optional[Callable[[Path], Tuple[bool, str]]] = None   # hook for controlled failure tests

    # ---- helpers --------------------------------------------------------------------------- #
    def _tests(self, root: Path, targets: Optional[List[str]] = None, m: Optional[ProjectModel] = None) -> TestRun:
        m = m or discover(root, self.d.settings.get("max_files"))
        return run_tests(root, m, self.d.python, targets=targets, timeout=self.d.settings.get("test_timeout"))

    def baseline_run(self) -> TestRun:
        if self.baseline is None:
            sh = Shadow(self.d.root, self.d.data_dir)
            try:
                self.baseline = self._tests(sh.path)
            finally:
                sh.cleanup()
        return self.baseline

    @staticmethod
    def regressions(before: TestRun, after: TestRun) -> List[str]:
        """Tests that PASSED before and fail now."""
        failing = {f["id"] for f in after.failures}
        return sorted(failing & set(before.passed_ids))

    def _reanalyze(self, rel: str, new_text: str) -> List[Finding]:
        from . import analysis, security
        out = analysis.analyze_python(self.d.model, rel, new_text)
        return out

    # ---- proposal persistence ------------------------------------------------------------------ #
    def _save_proposal(self, rid: int, f: Finding, patch: Patch, newline: str, enc: str) -> None:
        pdir = self.d.data_dir / "proposals"
        pdir.mkdir(exist_ok=True)
        (pdir / f"{rid}.json").write_text(json.dumps({"finding": f.to_dict(), "patch": {"files": patch.files, "strategy": patch.strategy,
                                                       "risk": patch.risk, "description": patch.description, "changed_lines": patch.changed_lines},
                                                       "newline": newline, "encoding": enc}), encoding="utf-8")

    @staticmethod
    def diff_text(patch: Patch) -> str:
        out = []
        for rel, (old, new) in patch.files.items():
            out += list(difflib.unified_diff(old.split("\n"), new.split("\n"), f"a/{rel}", f"b/{rel}", lineterm=""))
        return "\n".join(out)

    # ---- main entry: repair one finding ------------------------------------------------------------ #
    def repair_finding(self, f: Finding, approved: bool = False, patch: Optional[Patch] = None) -> dict:
        d, kb = self.d, self.d.kb
        mode = d.perm.mode
        path = d.root / f.file
        if not path.exists():
            return {"finding": f.id, "status": "SKIPPED", "reason": "file no longer exists"}
        text, newline, enc = read_text_preserving(path)
        before_sha = sha256_bytes(path.read_bytes())
        patch = patch or make_patch(f, text)
        if patch is None:
            kb.event("repair", f"no automatic fix for {f.rule} at {f.file}:{f.line}", {"finding": f.id})
            return {"finding": f.id, "rule": f.rule, "status": "MANUAL", "reason": "no safe automatic fix exists; see fix_plan", "fix_plan": f.fix_plan}
        if kb.failed_before(f.rule, f.file, before_sha, patch.strategy):
            return {"finding": f.id, "rule": f.rule, "status": "SKIPPED", "reason": "this strategy already failed on this exact file content"}
        diff = self.diff_text(patch)
        limit = int(d.settings.get("auto_max_changed_lines"))
        auto_ok = mode == "autonomous" and f.auto_fixable and patch.risk == "low" and patch.changed_lines <= limit
        rec = dict(finding_id=f.id, rule=f.rule, strategy=patch.strategy, file=f.file, risk=patch.risk, diff=diff, before_sha=before_sha)
        if mode == "diagnostic":
            rid = kb.record_repair(status="PROPOSED", notes="diagnostic mode: nothing was changed", **rec)
            self._save_proposal(rid, f, patch, newline, enc)
            return {"finding": f.id, "rule": f.rule, "status": "PROPOSED", "repair_id": rid, "diff": diff}
        if not approved and not auto_ok:
            why = ("supervised mode" if mode == "supervised" else f"risk={patch.risk}, auto_fixable={f.auto_fixable}, changed_lines={patch.changed_lines}")
            rid = kb.record_repair(status="NEEDS APPROVAL", notes=f"approval required ({why})", **rec)
            self._save_proposal(rid, f, patch, newline, enc)
            kb.set_finding_status(f.id, "NEEDS APPROVAL")
            return {"finding": f.id, "rule": f.rule, "status": "NEEDS APPROVAL", "repair_id": rid, "diff": diff, "reason": why}
        try:
            d.perm.guard_write(f.file, approved=approved, auto_ok=auto_ok)
        except NeedsApproval as e:
            rid = kb.record_repair(status="NEEDS APPROVAL", notes=str(e), **rec)
            self._save_proposal(rid, f, patch, newline, enc)
            return {"finding": f.id, "status": "NEEDS APPROVAL", "repair_id": rid, "reason": str(e)}
        return self._apply_verified(f, patch, newline, enc, before_sha, rec, approved, auto_ok)

    # ---- apply with verification + rollback ------------------------------------------------------------ #
    def _apply_verified(self, f, patch: Patch, newline, enc, before_sha, rec, approved, auto_ok) -> dict:
        d, kb = self.d, self.d.kb
        kb.set_finding_status(f.id, "REPAIRING")
        base = self.baseline_run()
        use_shadow = bool(d.settings.get("use_shadow"))
        new_texts = {rel: new for rel, (_, new) in patch.files.items()}
        tests_info: Dict[str, dict] = {"baseline": base.to_dict()}
        # 1) verify in a throw-away copy BEFORE touching the project
        if use_shadow:
            sh = Shadow(d.root, d.data_dir)
            try:
                for rel, new in new_texts.items():
                    sh.write(rel, new, newline)
                after = self._tests(sh.path)
            finally:
                sh.cleanup()
            tests_info["shadow_after"] = after.to_dict()
            bad = self.regressions(base, after)
            if bad or (after.ran and after.failed + after.errors > base.failed + base.errors and base.ran and not base.errors == 0 and False):
                rid = kb.record_repair(status="REJECTED BY TESTS", tests=tests_info, notes=f"would break previously passing tests: {bad}", **rec)
                kb.set_finding_status(f.id, "OPEN")
                return {"finding": f.id, "rule": f.rule, "status": "REJECTED BY TESTS", "repair_id": rid, "regressions": bad}
        # 2) back up, then write atomically
        rels = list(new_texts)
        bid = d.backup.create(rels, f"repair {f.rule} {f.file}:{f.line}", {"finding": f.id, "strategy": patch.strategy})
        if not d.backup.verify(bid):
            return {"finding": f.id, "status": "FAILED", "reason": "backup verification failed - nothing was changed"}
        written = []
        try:
            for rel, new in new_texts.items():
                d.perm.guard_write(rel, approved=approved, auto_ok=auto_ok)
                atomic_write_text(d.root / rel, new, newline, enc)
                written.append(rel)
            # 3) post-write verification of the REAL state
            problems = []
            for rel, new in new_texts.items():
                real = (d.root / rel).read_text(encoding=enc).replace("\r\n", "\n")
                if real != new:
                    problems.append(f"{rel}: content on disk differs from the verified patch")
                try:
                    ast.parse(real)
                except SyntaxError as e:
                    if f.rule != "syntax-error":
                        problems.append(f"{rel}: syntax error after patch ({e.msg})")
            after_real = None
            if not use_shadow or self.extra_post_check:
                sh = Shadow(d.root, d.data_dir)
                try:
                    after_real = self._tests(sh.path)
                finally:
                    sh.cleanup()
                tests_info["post_apply"] = after_real.to_dict()
                bad = self.regressions(base, after_real)
                if bad:
                    problems.append(f"regression: previously passing tests now fail: {bad}")
            if self.extra_post_check:
                ok, msg = self.extra_post_check(d.root)
                if not ok:
                    problems.append(msg)
            still = [x for x in self._reanalyze(f.file, new_texts[f.file]) if x.rule == f.rule and x.message == f.message] if f.file in new_texts else []
            if still:
                problems.append("the finding is still present after the patch")
            if problems:
                raise RuntimeError("; ".join(problems))
        except Exception as e:                                        # noqa - ANY failure => restore
            res = d.backup.restore(bid)
            rid = kb.record_repair(status="ROLLED BACK", backup_id=bid, tests=tests_info, notes=f"{e} | restore ok={res['ok']}", **rec)
            kb.set_finding_status(f.id, "ROLLED BACK")
            kb.event("rollback", f"repair of {f.rule} in {f.file} rolled back: {e}", {"backup": bid})
            return {"finding": f.id, "rule": f.rule, "status": "ROLLED BACK", "repair_id": rid, "backup_id": bid, "reason": str(e), "restore_ok": res["ok"]}
        verified = base.ran and (tests_info.get("shadow_after") or tests_info.get("post_apply") or {}).get("ran", False)
        status = "VERIFIED" if verified else "FIXED"
        after_sha = sha256_bytes((d.root / f.file).read_bytes())
        rid = kb.record_repair(status=status, backup_id=bid, tests=tests_info, after_sha=after_sha,
                               notes="verified by tests + static re-analysis" if verified else "no test suite: verified by static re-analysis only", **rec)
        kb.set_finding_status(f.id, status)
        guard = self._write_regression_guard(f)
        kb.event("repair", f"{status}: {f.rule} in {f.file}:{f.line} (backup {bid})", {"repair": rid})
        return {"finding": f.id, "rule": f.rule, "status": status, "repair_id": rid, "backup_id": bid, "diff": rec["diff"], "regression_guard": str(guard),
                "tests_before": f"{base.passed}/{base.total} pass" if base.ran else "no tests", "after_sha": after_sha}

    # ---- approval workflow -------------------------------------------------------------------------------- #
    def approve(self, rid: int) -> dict:
        p = self.d.data_dir / "proposals" / f"{rid}.json"
        if not p.exists():
            return {"status": "ERROR", "reason": f"no proposal {rid}"}
        data = json.loads(p.read_text(encoding="utf-8"))
        f = Finding(**data["finding"])
        patch = Patch(finding_id=f.id, rule=f.rule, strategy=data["patch"]["strategy"], description=data["patch"]["description"],
                      files={k: v for k, v in data["patch"]["files"].items()}, risk=data["patch"]["risk"], changed_lines=data["patch"]["changed_lines"])
        for rel, (old, _) in patch.files.items():
            cur, _, _ = read_text_preserving(self.d.root / rel)
            if cur != old:
                self.d.kb.update_repair(rid, status="STALE")
                return {"status": "STALE", "reason": f"{rel} changed since the proposal was made - re-scan"}
        if self.d.perm.mode == "diagnostic":
            return {"status": "BLOCKED", "reason": "diagnostic mode is read-only; switch to supervised/autonomous first"}
        res = self.repair_finding(f, approved=True, patch=patch)
        self.d.kb.update_repair(rid, status="APPROVED" if res["status"] in ("FIXED", "VERIFIED") else res["status"])
        return res

    def reject(self, rid: int) -> dict:
        self.d.kb.update_repair(rid, status="REJECTED")
        return {"status": "REJECTED", "repair_id": rid}

    def rollback(self, rid: int) -> dict:
        r = self.d.kb.repair(rid)
        if not r or not r.get("backup_id"):
            return {"status": "ERROR", "reason": "repair has no backup"}
        if self.d.perm.mode == "diagnostic":
            return {"status": "BLOCKED", "reason": "diagnostic mode is read-only"}
        res = self.d.backup.restore(r["backup_id"])
        if res["ok"]:
            self.d.kb.update_repair(rid, status="ROLLED BACK", notes=(r.get("notes") or "") + " | manually rolled back")
            self.d.kb.set_finding_status(r["finding_id"], "ROLLED BACK")
            self.d.kb.event("rollback", f"repair {rid} rolled back by user", {"backup": r["backup_id"]})
        return dict(res, repair_id=rid, status="ROLLED BACK" if res["ok"] else "ERROR")

    # ---- logic-bug repair from failing tests ----------------------------------------------------------------- #
    def repair_failing_tests(self, approved: bool = False) -> List[dict]:
        """Root-cause each failing test, search single-edit fixes (mutation repair) and accept only a fix that
        makes tests pass without breaking any previously passing test."""
        from .rootcause import analyze_failure
        d, kb = self.d, self.d.kb
        base = self.baseline_run()
        results = []
        if not base.ran or base.ok:
            return results
        real_failures = [x for x in base.failures if "_FailedTest" not in x["id"]]
        for fail in real_failures:
            rc = analyze_failure(fail, d.root, d.model)
            o = rc["origin"]
            res = {"test": fail["id"], "root_cause": rc, "status": "NO FIX FOUND"}
            if not o or o["file"] not in d.model.sources or d.model.is_test(o["file"]):
                res["status"] = "MANUAL"
                res["reason"] = "origin is not in project source code (or is the test itself)"
                results.append(res)
                continue
            mode = d.perm.mode
            text, newline, enc = read_text_preserving(d.root / o["file"])
            cands = mutation_candidates(text, o["line"])
            res["candidates"] = len(cands)
            sh = Shadow(d.root, d.data_dir)
            found = None
            t_end = time.time() + float(d.settings.get("mutation_budget_seconds"))
            try:
                for desc, new, ln in cands:
                    if time.time() > t_end:
                        res["reason"] = "mutation time budget exhausted"
                        break
                    sh.write(o["file"], new, newline)
                    targeted = self._tests(sh.path, targets=[fail["id"]] if base.framework == "unittest" else None)
                    if not targeted.ran or any(x["id"] == fail["id"] for x in targeted.failures):
                        continue
                    full = self._tests(sh.path)
                    if self.regressions(base, full):
                        continue
                    if full.failed + full.errors < base.failed + base.errors:
                        found = (desc, new, ln)
                        break
            finally:
                sh.cleanup()
            if not found:
                results.append(res)
                continue
            desc, new, ln = found
            f = Finding(rule="test-failure", category="test", severity="high", classification="confirmed", file=o["file"], line=ln,
                        message=f"failing test {fail['id']}: {fail['message'][:120]}", confidence=0.7, root_cause=rc["root_cause"],
                        fix_plan=f"mutation repair: {desc}", auto_fixable=False, risk="medium", extra={"test": fail["id"]})
            patch = Patch(finding_id=f.id, rule="test-failure", strategy="mutation:" + re.sub(r"\(line \d+\)", "", desc).strip(),
                          description=f"{desc} - makes {fail['id']} pass without breaking other tests", files={o["file"]: [text, new]},
                          risk="medium", changed_lines=count_changed(text, new))
            # logic changes are never "low risk": autonomous mode still asks unless approved
            out = self.repair_finding(f, approved=approved, patch=patch)
            out.update({"test": fail["id"], "mutation": desc, "root_cause": rc})
            results.append(out)
            self.baseline = None                              # the code changed: recompute the baseline next time
            d.refresh()
        return results

    # ---- regression guards --------------------------------------------------------------------------------------- #
    def _write_regression_guard(self, f: Finding) -> Path:
        gdir = self.d.data_dir / "regression_tests"
        gdir.mkdir(exist_ok=True)
        p = gdir / f"test_guard_{f.id}.py"
        if f.rule == "test-failure":
            body = (f"    def test_{f.id}(self):\n        r = subprocess.run([sys.executable, '-m', 'unittest', {f.extra['test']!r}], cwd=ROOT, capture_output=True, text=True, timeout=300)\n"
                    f"        self.assertEqual(r.returncode, 0, r.stderr[-800:])\n")
        else:
            body = (f"    def test_{f.id}(self):\n        m = discovery.discover(ROOT)\n        fs = analysis.analyze(m) + security.scan_security(m)\n"
                    f"        again = [x for x in fs if x.rule == {f.rule!r} and x.file == {f.file!r} and x.message == {f.message!r}]\n"
                    f"        self.assertEqual(again, [], 'regression: {f.rule} reappeared in {f.file}')\n")
        p.write_text(
            "import subprocess, sys, unittest\nfrom pathlib import Path\n"
            f"sys.path.insert(0, {str(DOCTOR_ROOT)!r})\nfrom doctor_core import analysis, discovery, security\nROOT = Path({str(self.d.root)!r})\n\n\n"
            f"class Guard(unittest.TestCase):\n{body}\n\nif __name__ == '__main__':\n    unittest.main()\n", encoding="utf-8")
        return p

    def run_regression_guards(self) -> TestRun:
        gdir = self.d.data_dir / "regression_tests"
        run = TestRun(framework="doctor-regression")
        if not gdir.exists() or not list(gdir.glob("test_guard_*.py")):
            run.note = "no regression guards yet"
            return run
        p = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", str(gdir), "-p", "test_guard_*.py", "-v"],
                           capture_output=True, text=True, timeout=600, errors="replace")
        from .testing import _parse_unittest
        _parse_unittest((p.stdout or "") + "\n" + (p.stderr or ""), run)
        run.raw_tail = (p.stderr or "")[-800:]
        return run
