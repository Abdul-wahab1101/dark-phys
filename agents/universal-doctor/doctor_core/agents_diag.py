"""Multi-Agent Diagnostics: discover agents, handoffs through shared files, silent failures, loops."""
from __future__ import annotations

import ast
import re
from collections import defaultdict
from typing import Dict, List, Tuple

from .discovery import ProjectModel
from .models import Finding

FILE_RX = re.compile(r"^[\w./\\\-\{\}]*\.(json|jsonl|db|sqlite|csv|txt|yaml|yml|pkl)$", re.I)
WRITE_HINT = re.compile(r"(json\.dump$|\.write$|write_text$|write_bytes$|to_csv$|\.dump$|save$|writerow$)")
LLM_HINT = re.compile(r"(?i)(openai|anthropic|llm|chat\.completions|messages\.create|generate_content|\.invoke$|\.complete$|ollama)")


def is_agent_file(rel: str, tree: ast.AST) -> bool:
    low = rel.lower()
    if "agent" in low.rsplit("/", 1)[-1] or "/agents/" in "/" + low:
        return True
    return any(isinstance(n, ast.ClassDef) and n.name.endswith("Agent") for n in ast.walk(tree))


def analyze_agents(m: ProjectModel) -> Tuple[dict, List[Finding]]:
    agents: Dict[str, dict] = {}
    for rel, tree in m.trees.items():
        if m.is_test(rel) or not is_agent_file(rel, tree):
            continue
        entries = [n.name for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                   and (n.name in ("run", "main", "execute", "process") or n.name.startswith(("run_", "process_", "execute_")))]
        classes = [n.name for n in tree.body if isinstance(n, ast.ClassDef) and n.name.endswith("Agent")]
        uses_llm = any(LLM_HINT.search(ast.unparse(n.func)) for n in ast.walk(tree) if isinstance(n, ast.Call))
        agents[rel] = {"entries": entries, "classes": classes, "uses_llm": uses_llm, "imports": sorted(m.graph.get(rel, ())), "role": rel.rsplit("/", 1)[-1][:-3]}
    findings: List[Finding] = []
    writers: Dict[str, set] = defaultdict(set)
    readers: Dict[str, set] = defaultdict(set)
    existing = {f["rel"].rsplit("/", 1)[-1] for f in m.files}
    for rel, tree in m.trees.items():
        if rel not in agents:
            continue
        lines = m.sources[rel].split("\n")
        for n in ast.walk(tree):
            if isinstance(n, ast.Call):
                fn = ast.unparse(n.func)
                consts = [a.value for a in ast.walk(n) if isinstance(a, ast.Constant) and isinstance(a.value, str) and FILE_RX.match(a.value)]
                for c in consts:
                    key = re.sub(r"\{[^}]*\}", "*", c.replace("\\", "/")).rsplit("/", 1)[-1]
                    mode_w = fn in ("open",) and any(isinstance(a, ast.Constant) and isinstance(a.value, str) and re.fullmatch(r"[wax]\+?b?", a.value) for a in n.args[1:] + [k.value for k in n.keywords])
                    (writers if (WRITE_HINT.search(fn) or mode_w) else readers)[key].add(rel)
        for n in ast.walk(tree):
            if isinstance(n, ast.While) and isinstance(n.test, ast.Constant) and n.test.value is True:
                body_src = ast.unparse(n)
                if LLM_HINT.search(body_src) or re.search(r"(?i)agent|tool_call|\.run\(", body_src):
                    bounded = bool(re.search(r"(?i)(max_|limit|retries|attempt|iteration|budget|timeout|break)", body_src))
                    if not bounded:
                        findings.append(Finding("agent-unbounded-loop", "agent", "high", "suspected", rel, n.lineno,
                                                "agent/LLM loop has no iteration limit or exit", 0.75, evidence=lines[n.lineno - 1].strip()[:140],
                                                root_cause="An agent that never stops can loop forever and burn resources/credits.",
                                                fix_plan="Add a maximum iteration count / budget and an explicit stop condition."))
            if isinstance(n, ast.Try):
                for h in n.handlers:
                    broad = h.type is None or (isinstance(h.type, ast.Name) and h.type.id in ("Exception", "BaseException"))
                    if not broad:
                        continue
                    body_src = " ".join(ast.unparse(s) for s in h.body)
                    reraises = any(isinstance(s, ast.Raise) for s in ast.walk(h))
                    logs = re.search(r"(?i)(print|log|logger|warn|error|traceback)", body_src)
                    success_ret = re.search(r"return\s+(True|\{[^}]*(success|ok|status)[^}]*(True|PASS|OK|success)[^}]*\})", body_src, re.I)
                    if not reraises and (success_ret or not logs):
                        findings.append(Finding("agent-silent-failure", "agent", "high" if success_ret else "medium", "suspected", rel, h.lineno,
                                                "exception handler hides the failure" + (" and reports success" if success_ret else " (no logging/re-raise)"), 0.75,
                                                evidence=lines[h.lineno - 1].strip()[:140],
                                                root_cause="Failures disappear, so the orchestrator believes the step succeeded.",
                                                fix_plan="Log the error and return/raise a failure the orchestrator can see."))
            if isinstance(n, ast.Call) and ast.unparse(n.func) in ("json.loads",) and agents[rel]["uses_llm"]:
                parent_try = any(isinstance(t, ast.Try) and any(n is x for x in ast.walk(t)) for t in ast.walk(tree))
                if not parent_try:
                    findings.append(Finding("agent-unvalidated-output", "agent", "low", "suspected", rel, n.lineno, "json.loads on model output without error handling", 0.5,
                                            evidence=lines[n.lineno - 1].strip()[:140], root_cause="LLM output is not guaranteed to be valid JSON.",
                                            fix_plan="Wrap in try/except and validate the schema; retry with a bounded number of attempts."))
    for key, rs in readers.items():
        if key not in writers and key not in existing and not key.startswith("*"):
            findings.append(Finding("agent-missing-handoff", "agent", "medium", "suspected", sorted(rs)[0], 1,
                                    f"'{key}' is read by {len(rs)} agent module(s) but never written by any module and does not exist in the project", 0.5,
                                    root_cause="A handoff file may be produced outside the project, or its producer is missing.",
                                    fix_plan="Confirm which agent produces this file, or provide it."))
    # orchestrators: files that import >= 2 agents; order of calls
    orch = {}
    for rel, tree in m.trees.items():
        deps = [d for d in m.graph.get(rel, ()) if d in agents]
        if len(deps) >= 2 and rel not in agents or (len(deps) >= 2 and "orchestr" in rel.lower()):
            calls: List[Tuple[int, str]] = []
            names = {}
            for imp in m.imports.get(rel, []):
                if imp.get("resolved") in agents:
                    for nme in imp["names"]:
                        names[nme] = imp["resolved"]
                    names[imp["module"].split(".")[-1]] = imp["resolved"]
            for n in ast.walk(tree):
                if isinstance(n, ast.Call):
                    base = ast.unparse(n.func).split(".")[0]
                    if base in names:
                        calls.append((n.lineno, f"{names[base]}::{ast.unparse(n.func)}"))
            calls.sort()
            orch[rel] = [c for _, c in calls]
            counts: Dict[str, int] = defaultdict(int)
            for _, c in calls:
                counts[c] += 1
            for c, k in counts.items():
                if k > 1:
                    findings.append(Finding("agent-duplicate-execution", "agent", "low", "suspected", rel, 1, f"orchestrator calls {c} {k} times", 0.4,
                                            root_cause="The same agent step may run twice (wasted work or double side effects).", fix_plan="Check that the repeated call is intentional."))
    info = {"agents": agents, "orchestrators": orch,
            "shared_files": {k: {"writers": sorted(writers.get(k, [])), "readers": sorted(readers.get(k, []))} for k in sorted(set(writers) | set(readers))}}
    return info, findings
