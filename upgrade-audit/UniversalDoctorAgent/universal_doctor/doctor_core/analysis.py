"""Code Analysis + Bug Detection engines (static). Python is analysed deeply with the AST;
config files and JavaScript get syntax checks; other languages are only listed (see limitations)."""
from __future__ import annotations

import ast
import builtins
import difflib
import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Set

from .discovery import STDLIB, ProjectModel, find_cycles
from .models import Finding

try:
    import tomllib
except Exception:                                   # pragma: no cover
    tomllib = None

# rule -> (category, root cause text, fix plan)
RULES: Dict[str, tuple] = {
    "syntax-error": ("code", "The file cannot be parsed, so every import of it fails at runtime.", "Correct the syntax at the reported line."),
    "broken-import": ("code", "The import points to a module that does not exist in the project.", "Fix the module path / create the missing module."),
    "broken-import-name": ("code", "The imported name is not defined in the target module, so the import raises ImportError.", "Import an existing name or define it in the module."),
    "missing-dependency": ("dependency", "A third-party package is imported but not installed in the analysed environment.", "Install / declare the dependency (Doctor never installs packages by itself)."),
    "import-typo": ("code", "The imported module name is almost identical to an existing module - probably a typo.", "Use the suggested module name."),
    "circular-import": ("architecture", "Modules import each other at import time; whichever is imported first sees a half-initialised module.", "Move the shared code to a third module or import lazily inside functions."),
    "missing-import": ("code", "A standard-library module is used but never imported, so the first execution raises NameError.", "Add the missing import statement."),
    "undefined-name": ("code", "The name is read but never defined, imported or assigned anywhere in this module.", "Define/import the name or remove the usage."),
    "mutable-default": ("code", "A mutable default argument is created once and shared by every call (state leaks between calls).", "Use None as default and create the object inside the function."),
    "bare-except": ("code", "A bare 'except:' also catches KeyboardInterrupt/SystemExit and hides real errors.", "Catch Exception (or a narrower type)."),
    "swallowed-exception": ("code", "The exception is caught and silently discarded, so failures look like success.", "Log, re-raise, or handle the specific error."),
    "none-comparison": ("code", "Comparing with == None can be fooled by objects that override __eq__.", "Use 'is None' / 'is not None'."),
    "is-literal-comparison": ("code", "'is' compares identity, not value; with literals the result is implementation dependent.", "Use == / !=."),
    "infinite-loop": ("code", "A 'while True' loop has no exit (break/return/raise) and no blocking call - it spins forever.", "Add a termination condition or a blocking wait."),
    "unbounded-loop": ("code", "A 'while True' loop has no visible exit; fine for a worker, dangerous otherwise.", "Make sure a stop condition (flag, limit, signal) exists."),
    "assert-tuple": ("code", "assert on a non-empty tuple is always true, so the check never fails.", "Write assert cond, 'message' (no parentheses around both)."),
    "zero-division": ("code", "Division by the constant 0 always raises ZeroDivisionError.", "Fix the divisor."),
    "unreachable-code": ("code", "Statements after return/raise/break/continue can never run.", "Remove or move the dead code."),
    "redefined-function": ("code", "The same function name is defined twice in one scope; the second definition silently replaces the first.", "Rename or remove one definition."),
    "call-arity-mismatch": ("code", "A call passes arguments that do not match the function signature - TypeError when executed.", "Fix the call or the signature."),
    "hardcoded-success-status": ("agent", "A check/QC/verify function returns a constant success status regardless of what it measured (a 'hallucinated success').", "Derive the status from the measured results and report warnings/failures honestly."),
    "missing-timeout": ("runtime", "requests/httpx calls without timeout can block forever and freeze the caller.", "Pass an explicit timeout=..."),
    "complex-function": ("code", "High cyclomatic complexity makes the function error-prone and hard to test.", "Split the function / add tests."),
    "duplicate-key": ("code", "A dict literal repeats a key; the later value silently wins.", "Remove the duplicated key."),
    "invalid-json": ("config", "The JSON file cannot be parsed, so any code that loads it fails.", "Fix the JSON syntax."),
    "invalid-toml": ("config", "The TOML file cannot be parsed.", "Fix the TOML syntax."),
    "invalid-yaml": ("config", "The YAML file uses tabs for indentation (invalid) or cannot be parsed.", "Indent with spaces."),
    "unpinned-dependency": ("dependency", "An unpinned dependency can change behaviour between installs.", "Pin versions (==) or use a lock file."),
    "js-syntax-error": ("code", "The JavaScript file fails the syntax check.", "Fix the syntax."),
}


class PyAnalyzer(ast.NodeVisitor):
    def __init__(self, rel: str, text: str, tree: ast.AST, m: ProjectModel):
        self.rel, self.text, self.tree, self.m = rel, text, tree, m
        self.lines = text.split("\n")
        self.out: List[Finding] = []
        self.is_agent = "agent" in rel.lower()

    # ---- plumbing --------------------------------------------------------------- #
    def add(self, rule: str, line: int, message: str, severity: str, classification: str = "confirmed", confidence: float = 0.85,
            auto: bool = False, risk: str = "medium", extra: Optional[dict] = None, end_line: int = 0, fix: str = "") -> None:
        cat, cause, plan = RULES.get(rule, ("code", "", ""))
        if self.is_agent and rule in ("hardcoded-success-status", "swallowed-exception", "infinite-loop", "unbounded-loop"):
            cat = "agent"
        ev = "\n".join(self.lines[max(0, line - 1):max(line, end_line or line)][:4]).strip()
        self.out.append(Finding(rule=rule, category=cat, severity=severity, classification=classification, file=self.rel, line=line,
                                end_line=end_line or line, message=message, confidence=confidence, evidence=ev[:300],
                                root_cause=cause, fix_plan=fix or plan, auto_fixable=auto, risk=risk, extra=extra or {}))

    def run(self) -> List[Finding]:
        self.visit(self.tree)
        self.check_names()
        self.check_unreachable()
        self.check_redefinitions()
        self.check_arity()
        return self.out

    # ---- visitors ------------------------------------------------------------------ #
    def visit_FunctionDef(self, node):
        self._func(node)
        self.generic_visit(node)

    visit_AsyncFunctionDef = visit_FunctionDef

    def _func(self, node) -> None:
        a = node.args
        pos = list(a.posonlyargs) + list(a.args)
        defaults = list(a.defaults)
        pairs = list(zip(pos[len(pos) - len(defaults):], defaults)) + [(k, d) for k, d in zip(a.kwonlyargs, a.kw_defaults) if d is not None]
        for arg, d in pairs:
            mutable = isinstance(d, (ast.List, ast.Dict, ast.Set, ast.ListComp, ast.DictComp, ast.SetComp)) or (
                isinstance(d, ast.Call) and isinstance(d.func, ast.Name) and d.func.id in ("list", "dict", "set", "bytearray") and not d.args and not d.keywords)
            if mutable:
                single = d.lineno == getattr(d, "end_lineno", d.lineno)
                body0 = node.body[0]
                ok = single and body0.lineno > d.lineno and not isinstance(d, (ast.ListComp, ast.DictComp, ast.SetComp))
                self.add("mutable-default", d.lineno, f"mutable default for argument '{arg.arg}' of {node.name}()", "medium", "confirmed", 0.95,
                         auto=ok, risk="low", extra={"func": node.name, "arg": arg.arg, "line": d.lineno, "col": d.col_offset,
                                                      "end_col": d.end_col_offset, "src": ast.get_source_segment(self.text, d), "func_line": node.lineno})
        # hard-coded success
        if re.search(r"(qc|quality|check|verif|validat|health|audit|test)", node.name, re.I):
            self._hardcoded_success(node)
        # complexity
        cx = 1
        for n in ast.walk(node):
            if isinstance(n, (ast.If, ast.For, ast.AsyncFor, ast.While, ast.IfExp, ast.ExceptHandler, ast.With, ast.Assert, ast.comprehension)):
                cx += 1
            elif isinstance(n, ast.BoolOp):
                cx += len(n.values) - 1
        if cx >= 20:
            self.add("complex-function", node.lineno, f"{node.name}() has cyclomatic complexity {cx}", "low" if cx < 35 else "medium",
                     "recommendation", 0.7, extra={"complexity": cx, "func": node.name})

    def _hardcoded_success(self, node) -> None:
        """Flag functions whose status/result/ok values are ONLY ever constant success values."""
        succ = {"PASS", "OK", "SUCCESS", "PASSED", "HEALTHY", "SUCCEEDED", "DONE"}
        keys = {"status", "result", "success", "ok", "passed", "healthy", "verdict"}
        values = []                                   # every value assigned to a status-like key
        for n in ast.walk(node):
            if isinstance(n, ast.Dict):
                for k, v in zip(n.keys, n.values):
                    if isinstance(k, ast.Constant) and str(k.value).lower() in keys:
                        values.append((n, v))
            elif isinstance(n, ast.Assign):
                for t in n.targets:
                    if (isinstance(t, ast.Subscript) and isinstance(t.slice, ast.Constant) and str(t.slice.value).lower() in keys) \
                            or (isinstance(t, ast.Name) and t.id.lower() in ("status", "verdict", "qc_status", "final_status")):
                        values.append((n, n.value))
        if not values:
            return

        def is_success_const(v):
            return isinstance(v, ast.Constant) and ((isinstance(v.value, str) and v.value.upper() in succ) or v.value is True)
        if all(is_success_const(v) for _, v in values):
            n = values[0][0]
            self.add("hardcoded-success-status", n.lineno,
                     f"{node.name}() only ever produces a constant success status ({len(values)} assignment(s)); failures and warnings can never be reported",
                     "high", "suspected", 0.8, risk="high", extra={"func": node.name})

    def visit_ExceptHandler(self, node):
        if node.type is None:
            self.add("bare-except", node.lineno, "bare 'except:' clause", "medium", "confirmed", 0.95, auto=True, risk="low",
                     extra={"col": node.col_offset})
        broad = node.type is None or (isinstance(node.type, ast.Name) and node.type.id in ("Exception", "BaseException"))
        if broad and all(isinstance(s, (ast.Pass, ast.Continue)) or (isinstance(s, ast.Expr) and isinstance(getattr(s, "value", None), ast.Constant)) for s in node.body):
            self.add("swallowed-exception", node.lineno, "broad exception is caught and silently ignored", "medium", "suspected", 0.75)
        self.generic_visit(node)

    def visit_Compare(self, node):
        if len(node.ops) == 1:
            op, rhs, lhs = node.ops[0], node.comparators[0], node.left
            if isinstance(op, (ast.Eq, ast.NotEq)) and (isinstance(rhs, ast.Constant) and rhs.value is None):
                seg = ast.get_source_segment(self.text, node)
                single = node.lineno == node.end_lineno
                self.add("none-comparison", node.lineno, "comparison to None with ==/!=", "low", "confirmed", 0.95, auto=bool(seg) and single,
                         risk="low", extra={"line": node.lineno, "col": node.col_offset, "end_col": node.end_col_offset, "src": seg,
                                            "neg": isinstance(op, ast.NotEq)})
            if isinstance(op, (ast.Is, ast.IsNot)):
                for side in (lhs, rhs):
                    if isinstance(side, ast.Constant) and isinstance(side.value, (str, bytes, int, float)) and not isinstance(side.value, bool):
                        seg = ast.get_source_segment(self.text, node)
                        self.add("is-literal-comparison", node.lineno, "'is' used to compare with a literal", "medium", "confirmed", 0.9,
                                 auto=bool(seg) and node.lineno == node.end_lineno, risk="low",
                                 extra={"line": node.lineno, "col": node.col_offset, "end_col": node.end_col_offset, "src": seg,
                                        "neg": isinstance(op, ast.IsNot)})
                        break
        self.generic_visit(node)

    def visit_Assert(self, node):
        if isinstance(node.test, ast.Tuple) and node.test.elts:
            self.add("assert-tuple", node.lineno, "assert on a tuple is always true", "high", "confirmed", 0.95)
        self.generic_visit(node)

    def visit_BinOp(self, node):
        if isinstance(node.op, (ast.Div, ast.FloorDiv, ast.Mod)) and isinstance(node.right, ast.Constant) and node.right.value == 0 \
                and not isinstance(node.right.value, bool):
            self.add("zero-division", node.lineno, "division by constant zero", "high", "confirmed", 0.97)
        self.generic_visit(node)

    def visit_Dict(self, node):
        seen = {}
        for k in node.keys:
            if isinstance(k, ast.Constant):
                if k.value in seen:
                    self.add("duplicate-key", k.lineno, f"duplicate dict key {k.value!r}", "medium", "confirmed", 0.95)
                seen[k.value] = 1
        self.generic_visit(node)

    def visit_While(self, node):
        if isinstance(node.test, ast.Constant) and node.test.value in (True, 1):
            has_exit, blocks, yields = False, False, False
            stack = list(node.body)
            while stack:
                n = stack.pop()
                if isinstance(n, (ast.Break, ast.Return, ast.Raise)):
                    has_exit = True
                if isinstance(n, (ast.Yield, ast.YieldFrom, ast.Await)):
                    yields = True
                if isinstance(n, ast.Call):
                    f = ast.unparse(n.func)
                    if re.search(r"(sleep|wait|accept|recv|input|get|read|readline|serve_forever|poll|select|join)$", f):
                        blocks = True
                    if re.search(r"(sys\.exit|os\._exit|exit|quit)$", f):
                        has_exit = True
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    continue
                if isinstance(n, (ast.While, ast.For, ast.AsyncFor)) and n is not node:
                    # a nested loop's break does not leave THIS loop; only look for return/raise/exit in it
                    for sub in ast.walk(n):
                        if isinstance(sub, (ast.Return, ast.Raise)):
                            has_exit = True
                    continue
                stack.extend(ast.iter_child_nodes(n))
            if not has_exit and not yields:
                if blocks:
                    self.add("unbounded-loop", node.lineno, "'while True' without exit (blocking worker loop?)", "low", "recommendation", 0.5)
                else:
                    self.add("infinite-loop", node.lineno, "'while True' without exit or blocking call", "high", "suspected", 0.85)
        self.generic_visit(node)

    def visit_Call(self, node):
        f = node.func
        if isinstance(f, ast.Attribute) and isinstance(f.value, ast.Name) and f.value.id in ("requests", "httpx") \
                and f.attr in ("get", "post", "put", "delete", "head", "patch", "request"):
            has_kw = any(k.arg == "timeout" or k.arg is None for k in node.keywords)
            if not has_kw:
                end_line = getattr(node, "end_lineno", node.lineno)
                self.add("missing-timeout", node.lineno, f"{f.value.id}.{f.attr}() without timeout", "medium", "confirmed", 0.9,
                         auto=end_line == node.lineno, risk="medium",
                         extra={"line": node.lineno, "end_col": node.end_col_offset, "has_args": bool(node.args or node.keywords)})
        self.generic_visit(node)

    # ---- module-level checks ------------------------------------------------------------ #
    def check_names(self) -> None:
        bound = set(dir(builtins)) | {"__file__", "__name__", "__doc__", "__spec__", "__package__", "__builtins__", "__path__",
                                      "__loader__", "__class__", "__annotations__", "_", "__debug__", "__qualname__", "__module__"}
        star = False
        for n in ast.walk(self.tree):
            if isinstance(n, ast.Name) and isinstance(n.ctx, (ast.Store, ast.Del)):
                bound.add(n.id)
            elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                bound.add(n.name)
                for tp in getattr(n, "type_params", []) or []:
                    bound.add(tp.name)
            elif isinstance(n, ast.arg):
                bound.add(n.arg)
            elif isinstance(n, (ast.Import, ast.ImportFrom)):
                for a in n.names:
                    if a.name == "*":
                        star = True
                    bound.add((a.asname or a.name).split(".")[0])
            elif isinstance(n, ast.ExceptHandler) and n.name:
                bound.add(n.name)
            elif isinstance(n, (ast.Global, ast.Nonlocal)):
                bound.update(n.names)
            elif hasattr(ast, "MatchAs") and isinstance(n, ast.MatchAs) and n.name:
                bound.add(n.name)
            elif hasattr(ast, "MatchStar") and isinstance(n, ast.MatchStar) and n.name:
                bound.add(n.name)
            elif hasattr(ast, "MatchMapping") and isinstance(n, ast.MatchMapping) and n.rest:
                bound.add(n.rest)
            elif hasattr(ast, "TypeAlias") and isinstance(n, ast.TypeAlias):
                bound.add(n.name.id)
        if star:
            return
        reported: Set[str] = set()
        attr_base = {id(n.value) for n in ast.walk(self.tree) if isinstance(n, ast.Attribute)}
        for n in ast.walk(self.tree):
            if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load) and n.id not in bound and n.id not in reported:
                reported.add(n.id)
                if n.id in STDLIB and id(n) in attr_base:
                    self.add("missing-import", n.lineno, f"'{n.id}' is used but never imported", "high", "confirmed", 0.95, auto=True,
                             risk="low", extra={"module": n.id})
                else:
                    self.add("undefined-name", n.lineno, f"name '{n.id}' is not defined anywhere in this module", "high", "suspected", 0.75)

    def _bodies(self):
        for n in ast.walk(self.tree):
            for attr in ("body", "orelse", "finalbody"):
                b = getattr(n, attr, None)
                if isinstance(b, list) and b and isinstance(b[0], ast.stmt):
                    yield b

    def check_unreachable(self) -> None:
        for body in self._bodies():
            for i, st in enumerate(body[:-1]):
                if isinstance(st, (ast.Return, ast.Raise, ast.Continue, ast.Break)):
                    nxt = body[i + 1]
                    self.add("unreachable-code", nxt.lineno, "code after return/raise/break/continue never runs", "low", "confirmed", 0.95)
                    break

    def check_redefinitions(self) -> None:
        scopes = [self.tree.body] + [n.body for n in ast.walk(self.tree) if isinstance(n, ast.ClassDef)]
        for body in scopes:
            seen: Dict[str, int] = {}
            for st in body:
                if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef)) and not st.decorator_list:
                    if st.name in seen:
                        self.add("redefined-function", st.lineno, f"function '{st.name}' redefined (first defined at line {seen[st.name]})",
                                 "medium", "confirmed", 0.9)
                    seen[st.name] = st.lineno

    def check_arity(self) -> None:
        defs: Dict[str, ast.FunctionDef] = {}
        counts: Dict[str, int] = {}
        for st in self.tree.body:
            if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef)) and not st.decorator_list:
                defs[st.name] = st
            for n in ([st] if not isinstance(st, ast.FunctionDef) else []):
                pass
        assigned = {t.id for n in ast.walk(self.tree) if isinstance(n, (ast.Assign, ast.AnnAssign, ast.AugAssign))
                    for t in (n.targets if isinstance(n, ast.Assign) else [n.target]) if isinstance(t, ast.Name)}
        for st in self.tree.body:
            if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                counts[st.name] = counts.get(st.name, 0) + 1
        for n in ast.walk(self.tree):
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in defs and counts.get(n.func.id) == 1 \
                    and n.func.id not in assigned:
                fn = defs[n.func.id]
                if any(isinstance(a, ast.Starred) for a in n.args) or any(k.arg is None for k in n.keywords):
                    continue
                a = fn.args
                pos = [x.arg for x in list(a.posonlyargs) + list(a.args)]
                nreq = len(pos) - len(a.defaults)
                given_pos = len(n.args)
                kws = {k.arg for k in n.keywords}
                problem = ""
                if given_pos > len(pos) and not a.vararg:
                    problem = f"{fn.name}() takes {len(pos)} positional argument(s) but {given_pos} were given"
                else:
                    unknown = [k for k in kws if k not in pos and k not in [x.arg for x in a.kwonlyargs]]
                    if unknown and not a.kwarg:
                        problem = f"{fn.name}() got unexpected keyword argument '{unknown[0]}'"
                    else:
                        filled = set(pos[:given_pos]) | kws
                        missing = [p for p in pos[:nreq] if p not in filled]
                        missing += [k.arg for k, d in zip(a.kwonlyargs, a.kw_defaults) if d is None and k.arg not in kws]
                        if missing:
                            problem = f"{fn.name}() missing required argument '{missing[0]}'"
                if problem:
                    self.add("call-arity-mismatch", n.lineno, problem, "high", "confirmed", 0.9, extra={"func": fn.name})


# --------------------------------------------------------------------------- #
def analyze_python(m: ProjectModel, rel: str, text: str, tree: Optional[ast.AST] = None) -> List[Finding]:
    if tree is None:
        try:
            tree = ast.parse(text, filename=rel)
        except SyntaxError as e:
            return [_syntax_finding(rel, {"msg": e.msg, "line": e.lineno or 1, "text": (e.text or "").rstrip("\n")})]
    return PyAnalyzer(rel, text, tree, m).run()


def _syntax_finding(rel: str, err: dict) -> Finding:
    line_txt = err.get("text", "")
    fixable = err["msg"] in ("expected ':'",) and re.match(r"\s*(def|class|if|elif|else|for|while|try|except|finally|with|async)\b", line_txt or "") is not None
    cat, cause, plan = RULES["syntax-error"]
    return Finding(rule="syntax-error", category=cat, severity="critical", classification="confirmed", file=rel, line=err["line"],
                   message=f"SyntaxError: {err['msg']}", confidence=1.0, evidence=line_txt[:300], root_cause=cause, fix_plan=plan,
                   auto_fixable=bool(fixable), risk="low", extra={"msg": err["msg"]})


def _import_findings(m: ProjectModel, rel: str) -> List[Finding]:
    out: List[Finding] = []
    import importlib.util
    local_names = m.local_module_names()
    declared = {d.lower().replace("_", "-") for d in m.dependencies}
    lines = m.sources.get(rel, "").split("\n")

    def mk(rule, line, msg, sev, cls, conf, extra=None):
        cat, cause, plan = RULES[rule]
        return Finding(rule=rule, category=cat, severity=sev, classification=cls, file=rel, line=line, message=msg, confidence=conf,
                       evidence=(lines[line - 1].strip() if 0 < line <= len(lines) else "")[:200], root_cause=cause, fix_plan=plan, extra=extra or {})
    for imp in m.imports.get(rel, []):
        if imp["level"] == -1 or imp["guarded"]:
            continue
        mod, level = imp["module"], imp["level"]
        top = mod.split(".")[0] if mod else ""
        resolved = imp.get("resolved")
        if level > 0:
            if resolved is None and not any((mod + "." + n) and False for n in imp["names"]):
                subs = [n for n in imp["names"]]
                from .discovery import resolve_import
                if not any(resolve_import(m, rel, (mod + "." if mod else "") + n, level) for n in subs):
                    out.append(mk("broken-import", imp["line"], f"relative import '{'.' * level}{mod}' cannot be resolved", "high", "confirmed", 0.9))
            continue
        if top in STDLIB:
            continue
        if resolved:
            tree = m.trees.get(resolved)
            if tree is not None and imp["names"] and "*" not in imp["names"]:
                defined = set()
                has_getattr = False
                for st in tree.body:
                    if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                        defined.add(st.name)
                        has_getattr |= st.name == "__getattr__"
                    elif isinstance(st, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
                        for t in (st.targets if isinstance(st, ast.Assign) else [st.target]):
                            for nn in ast.walk(t):
                                if isinstance(nn, ast.Name):
                                    defined.add(nn.id)
                    elif isinstance(st, (ast.Import, ast.ImportFrom)):
                        for a in st.names:
                            defined.add((a.asname or a.name).split(".")[0])
                            if a.name == "*":
                                has_getattr = True
                    elif isinstance(st, (ast.If, ast.Try, ast.With, ast.For, ast.While)):
                        for nn in ast.walk(st):                     # conditional definitions: be generous
                            if isinstance(nn, (ast.FunctionDef, ast.ClassDef, ast.AsyncFunctionDef)):
                                defined.add(nn.name)
                            elif isinstance(nn, ast.Name) and isinstance(nn.ctx, ast.Store):
                                defined.add(nn.id)
                            elif isinstance(nn, (ast.Import, ast.ImportFrom)):
                                for a in nn.names:
                                    defined.add((a.asname or a.name).split(".")[0])
                if not has_getattr:
                    from .discovery import resolve_import
                    for name in imp["names"]:
                        if name not in defined and not resolve_import(m, rel, mod + "." + name, 0):
                            sug = difflib.get_close_matches(name, sorted(defined), n=1, cutoff=0.75)
                            out.append(mk("broken-import-name", imp["line"], f"cannot import name '{name}' from local module '{mod}'"
                                          + (f" (did you mean '{sug[0]}'?)" if sug else ""), "high", "confirmed", 0.9, {"name": name, "suggestion": sug[0] if sug else ""}))
            continue
        if not top:
            continue
        if top in local_names:
            continue
        try:
            found = importlib.util.find_spec(top) is not None
        except (ImportError, ValueError, AttributeError):
            found = False
        if found:
            continue
        pool = sorted(STDLIB | local_names)
        sug = difflib.get_close_matches(top, pool, n=1, cutoff=0.82)
        if sug:
            out.append(mk("import-typo", imp["line"], f"import '{top}' not found - did you mean '{sug[0]}'?", "high", "confirmed", 0.8, {"suggestion": sug[0]}))
        else:
            decl = top.lower().replace("_", "-") in declared
            out.append(mk("missing-dependency", imp["line"], f"package '{top}' is not installed in this environment"
                          + (" (declared in the project's dependency files)" if decl else " (and not declared in any dependency file)"),
                          "medium" if decl else "high", "suspected", 0.55 if decl else 0.65, {"package": top, "declared": decl}))
    return out


def _config_findings(m: ProjectModel) -> List[Finding]:
    out: List[Finding] = []
    for rel, text in m.sources.items():
        low = rel.lower()
        base = low.rsplit("/", 1)[-1]
        if low.endswith(".json") and not base.endswith("-lock.json"):
            try:
                json.loads(text)
            except ValueError as e:
                ln = getattr(e, "lineno", 1)
                cat, cause, plan = RULES["invalid-json"]
                out.append(Finding("invalid-json", cat, "high", "confirmed", rel, ln, f"invalid JSON: {e}", 1.0,
                                   root_cause=cause, fix_plan=plan, evidence=text.split("\n")[max(0, ln - 1)][:200]))
        elif low.endswith(".toml") and tomllib:
            try:
                tomllib.loads(text)
            except Exception as e:
                cat, cause, plan = RULES["invalid-toml"]
                out.append(Finding("invalid-toml", cat, "high", "confirmed", rel, 1, f"invalid TOML: {e}", 1.0, root_cause=cause, fix_plan=plan))
        elif low.endswith((".yml", ".yaml")):
            for i, line in enumerate(text.split("\n"), 1):
                if re.match(r"^ *\t", line):
                    cat, cause, plan = RULES["invalid-yaml"]
                    out.append(Finding("invalid-yaml", cat, "high", "confirmed", rel, i, "tab character used for YAML indentation", 0.95,
                                       root_cause=cause, fix_plan=plan, evidence=line[:120]))
                    break
            else:
                try:
                    import yaml                                   # optional
                    try:
                        list(yaml.safe_load_all(text))
                    except yaml.YAMLError as e:
                        cat, cause, plan = RULES["invalid-yaml"]
                        out.append(Finding("invalid-yaml", cat, "high", "confirmed", rel, getattr(getattr(e, "problem_mark", None), "line", 0) + 1,
                                           f"invalid YAML: {str(e).splitlines()[0]}", 0.9, root_cause=cause, fix_plan=plan))
                except ImportError:
                    pass
        elif base.startswith("requirements") and base.endswith(".txt"):
            for i, line in enumerate(text.split("\n"), 1):
                s = line.split("#")[0].strip()
                if s and not s.startswith(("-", "git+", "http", ".")) and not re.search(r"(==|~=|>=.*,\s*<|===|@)", s):
                    cat, cause, plan = RULES["unpinned-dependency"]
                    out.append(Finding("unpinned-dependency", cat, "low", "recommendation", rel, i, f"'{s}' is not pinned", 0.7,
                                       root_cause=cause, fix_plan=plan, evidence=s))
    return out


def _js_findings(m: ProjectModel) -> List[Finding]:
    out: List[Finding] = []
    node = shutil.which("node")
    files = [r for r in m.sources if r.endswith((".js", ".mjs", ".cjs"))][:150]
    for rel in files:
        text = m.sources[rel]
        cat, cause, plan = RULES["js-syntax-error"]
        if node:
            try:
                r = subprocess.run([node, "--check", str(m.root / rel)], capture_output=True, text=True, timeout=15)
                if r.returncode != 0:
                    msg = (r.stderr.strip().splitlines() or ["syntax error"])
                    ln = 1
                    mm = re.search(r":(\d+)\s*$", msg[0]) if msg else None
                    if mm:
                        ln = int(mm.group(1))
                    out.append(Finding("js-syntax-error", cat, "high", "confirmed", rel, ln, "node --check: " + " ".join(msg[-3:])[:200], 0.95,
                                       root_cause=cause, fix_plan=plan))
            except (OSError, subprocess.SubprocessError):
                pass
        else:
            stripped = re.sub(r"//[^\n]*|/\*.*?\*/|'(?:\\.|[^'\\\n])*'|\"(?:\\.|[^\"\\\n])*\"|`(?:\\.|[^`\\])*`", "", text, flags=re.S)
            for a, b in ("()", "[]", "{}"):
                if stripped.count(a) != stripped.count(b):
                    out.append(Finding("js-syntax-error", cat, "medium", "suspected", rel, 1,
                                       f"unbalanced '{a}{b}' (heuristic check: Node.js is not installed)", 0.45, root_cause=cause, fix_plan=plan))
                    break
    return out


def analyze(m: ProjectModel) -> List[Finding]:
    out: List[Finding] = []
    for rel, err in m.syntax_errors.items():
        out.append(_syntax_finding(rel, err))
    for rel, tree in m.trees.items():
        text = m.sources[rel]
        out += analyze_python(m, rel, text, tree)
        out += _import_findings(m, rel)
    for cyc in find_cycles(m.top_graph):
        cat, cause, plan = RULES["circular-import"]
        out.append(Finding("circular-import", cat, "medium", "suspected", cyc[0], 1, "circular import chain: " + " -> ".join(cyc), 0.6,
                           root_cause=cause, fix_plan=plan, extra={"cycle": cyc}))
    out += _config_findings(m)
    out += _js_findings(m)
    seen, uniq = set(), []
    for f in out:
        if f.id not in seen:
            seen.add(f.id)
            uniq.append(f)
    return uniq
