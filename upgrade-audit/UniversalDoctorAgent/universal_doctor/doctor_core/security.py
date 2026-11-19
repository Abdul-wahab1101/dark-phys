"""Security Doctor: secrets (always masked), injection patterns, unsafe configuration. Static only."""
from __future__ import annotations

import ast
import hashlib
import math
import re
from typing import List

from .discovery import ProjectModel
from .models import Finding

SECRET_PATTERNS = [
    ("aws-access-key", re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "critical", 0.95),
    ("github-token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b"), "critical", 0.95),
    ("slack-token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"), "critical", 0.9),
    ("api-key (sk-...)", re.compile(r"\bsk-[A-Za-z0-9_\-]{20,}\b"), "critical", 0.85),
    ("google-api-key", re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b"), "critical", 0.9),
    ("private-key", re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY"), "critical", 0.98),
]
GENERIC = re.compile(r"""(?ix)\b([A-Za-z_]*(?:api[_-]?key|secret|token|passwd|password|private[_-]?key|auth)[A-Za-z_]*)\s*[:=]\s*['"]([^'"\s]{8,})['"]""")
PLACEHOLDER = re.compile(r"(?i)(your[_-]?|xxx|changeme|example|placeholder|<.+>|\$\{|\{\{|os\.environ|getenv|dummy|test|sample|todo|\*\*\*|\.\.\.)")
SKIP_SUFFIX = (".lock", ".min.js", ".map", ".svg", ".png", ".jpg")


def mask(s: str) -> str:
    return (s[:2] + "*" * max(4, len(s) - 6) + s[-2:]) if len(s) > 8 else "*" * len(s)


def entropy(s: str) -> float:
    if not s:
        return 0.0
    return -sum((s.count(c) / len(s)) * math.log2(s.count(c) / len(s)) for c in set(s))


def fingerprint(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()[:10]


def scan_security(m: ProjectModel) -> List[Finding]:
    out: List[Finding] = []
    gitignore = m.sources.get(".gitignore", "")
    for rel, text in m.sources.items():
        if rel.endswith(SKIP_SUFFIX) or m.is_test(rel):
            continue
        lines = text.split("\n")
        for i, line in enumerate(lines, 1):
            if len(line) > 600:
                continue
            for name, rx, sev, conf in SECRET_PATTERNS:
                mm = rx.search(line)
                if mm:
                    out.append(Finding("hardcoded-secret", "security", sev, "confirmed", rel, i, f"{name} found in source (value masked: {mask(mm.group(0))})",
                                       conf, evidence=line.replace(mm.group(0), mask(mm.group(0)))[:160],
                                       root_cause="A credential is committed in plain text; anyone with repository access can use it.",
                                       fix_plan="Revoke/rotate the credential, load it from an environment variable or secret store, and remove it from history. "
                                                "Doctor never edits credentials automatically.", extra={"fingerprint": fingerprint(mm.group(0)), "kind": name}))
            g = GENERIC.search(line)
            if g and not PLACEHOLDER.search(g.group(2)) and entropy(g.group(2)) >= 3.0 and not any(o.line == i and o.file == rel for o in out):
                out.append(Finding("hardcoded-secret", "security", "high", "suspected", rel, i, f"possible hard-coded {g.group(1)} (value masked: {mask(g.group(2))})", 0.6,
                                   evidence=line.replace(g.group(2), mask(g.group(2)))[:160],
                                   root_cause="A secret-like value is assigned as a string literal.", fix_plan="Move it to an environment variable / secret store.",
                                   extra={"fingerprint": fingerprint(g.group(2)), "kind": "generic"}))
        if rel.endswith((".js", ".jsx", ".ts", ".tsx", ".vue", ".html")):
            for rx, rule, sev, msg in ((r"\beval\s*\(", "unsafe-eval", "high", "eval() executes arbitrary code"),
                                       (r"new\s+Function\s*\(", "unsafe-eval", "high", "new Function() executes arbitrary code"),
                                       (r"\.innerHTML\s*=", "xss-risk", "medium", "assignment to innerHTML can enable cross-site scripting"),
                                       (r"document\.write\s*\(", "xss-risk", "medium", "document.write can enable cross-site scripting"),
                                       (r"dangerouslySetInnerHTML", "xss-risk", "medium", "dangerouslySetInnerHTML bypasses React escaping"),
                                       (r"child_process\.(exec|execSync)\s*\(\s*`", "command-injection", "high", "shell command built from a template string")):
                for mm in re.finditer(rx, text):
                    ln = text[:mm.start()].count("\n") + 1
                    out.append(Finding(rule, "security", sev, "suspected", rel, ln, msg, 0.7, evidence=lines[ln - 1].strip()[:160],
                                       root_cause="Untrusted data may reach a dangerous sink.", fix_plan="Avoid the sink or sanitise/escape the data."))
        if rel.endswith(("Dockerfile",)) or rel.rsplit("/", 1)[-1].startswith("Dockerfile"):
            if not re.search(r"^\s*USER\s+(?!root)", text, re.M):
                out.append(Finding("docker-root-user", "security", "low", "recommendation", rel, 1, "container runs as root (no non-root USER)", 0.7,
                                   root_cause="A compromised process has root privileges inside the container.", fix_plan="Add a non-root USER."))
            for i, l in enumerate(lines, 1):
                if re.match(r"^\s*FROM\s+\S+:latest\b", l) or re.search(r"curl[^|]*\|\s*(sudo\s+)?(ba)?sh", l):
                    out.append(Finding("docker-unsafe-pattern", "security", "medium", "suspected", rel, i, "unpinned ':latest' image or 'curl | sh'", 0.7, evidence=l.strip()[:120],
                                       root_cause="Build is not reproducible / executes remote code.", fix_plan="Pin image versions; verify downloads."))
        if rel.endswith((".yml", ".yaml")) and re.search(r"privileged:\s*true", text):
            out.append(Finding("docker-privileged", "security", "high", "confirmed", rel, 1, "privileged container configuration", 0.85,
                               root_cause="Privileged containers can escape isolation.", fix_plan="Remove privileged: true."))
    envs = [f["rel"] for f in m.files if f["rel"].rsplit("/", 1)[-1] in (".env", ".env.local", ".env.production")]
    for e in envs:
        if ".env" not in gitignore:
            out.append(Finding("env-not-ignored", "security", "high", "suspected", e, 1, f"'{e}' exists but .gitignore does not list .env files", 0.7,
                               root_cause="Environment files usually hold secrets and may be committed.", fix_plan="Add .env to .gitignore."))
    for rel, tree in m.trees.items():
        if m.is_test(rel):
            continue
        lines = m.sources[rel].split("\n")

        def add(rule, node, sev, cls, conf, msg, cause, fix, auto=False, risk="medium", extra=None):
            out.append(Finding(rule, "security", sev, cls, rel, node.lineno, msg, conf, evidence=lines[node.lineno - 1].strip()[:160],
                               root_cause=cause, fix_plan=fix, auto_fixable=auto, risk=risk, extra=extra or {}))
        dynamic = lambda n: isinstance(n, (ast.JoinedStr, ast.Name, ast.BinOp, ast.Attribute, ast.Subscript)) or \
            (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "format")
        for n in ast.walk(tree):
            if not isinstance(n, ast.Call):
                continue
            fn = ast.unparse(n.func)
            if fn in ("eval", "exec") and n.args and not isinstance(n.args[0], ast.Constant):
                add("unsafe-eval", n, "high", "suspected", 0.8, f"{fn}() on non-constant input", "Dynamic code execution can run attacker-controlled code.",
                    "Use ast.literal_eval / a parser / a dispatch table.")
            if fn == "os.system" and n.args and dynamic(n.args[0]):
                add("command-injection", n, "high", "suspected", 0.8, "os.system with a dynamic command", "Shell metacharacters in the data are executed.",
                    "Use subprocess.run([...], shell=False).")
            if re.match(r"subprocess\.(run|call|Popen|check_output|check_call)$", fn):
                shell = any(k.arg == "shell" and isinstance(k.value, ast.Constant) and k.value.value is True for k in n.keywords)
                if shell:
                    dyn = n.args and dynamic(n.args[0])
                    add("command-injection", n, "high" if dyn else "medium", "suspected" if dyn else "recommendation", 0.8 if dyn else 0.5,
                        "subprocess with shell=True" + (" and a dynamic command" if dyn else ""), "A shell interprets the command string; untrusted data can inject commands.",
                        "Pass an argument list and shell=False.")
            if fn in ("pickle.load", "pickle.loads", "marshal.loads", "shelve.open"):
                add("insecure-deserialization", n, "high", "suspected", 0.7, f"{fn}() can execute code from untrusted data", "Unpickling runs arbitrary code.", "Use JSON or a safe format.")
            if fn == "yaml.load" and len(n.args) == 1 and not any(k.arg == "Loader" for k in n.keywords):
                add("insecure-deserialization", n, "high", "confirmed", 0.9, "yaml.load() without a safe Loader", "yaml.load can construct arbitrary Python objects.",
                    "Use yaml.safe_load.", auto=n.lineno == n.end_lineno, risk="low", extra={"line": n.lineno, "col": n.func.col_offset, "end_col": n.func.end_col_offset})
            if fn in ("hashlib.md5", "hashlib.sha1"):
                add("weak-hash", n, "low", "recommendation", 0.5, f"{fn} is cryptographically weak", "Collisions are practical; unsuitable for passwords/signatures.", "Use sha256+ or a password KDF.")
            if any(k.arg == "verify" and isinstance(k.value, ast.Constant) and k.value.value is False for k in n.keywords):
                add("tls-verification-disabled", n, "high", "confirmed", 0.9, "TLS certificate verification disabled (verify=False)", "Man-in-the-middle attacks go undetected.", "Remove verify=False.")
            if fn.endswith(".run") and any(k.arg == "debug" and isinstance(k.value, ast.Constant) and k.value.value is True for k in n.keywords):
                add("debug-enabled", n, "high", "confirmed", 0.85, "web app started with debug=True", "The debugger exposes code execution.", "Disable debug in production.")
            if fn == "tempfile.mktemp":
                add("insecure-temp-file", n, "medium", "confirmed", 0.9, "tempfile.mktemp is race-prone", "Predictable names enable symlink attacks.", "Use NamedTemporaryFile/mkstemp.")
            if fn in ("os.chmod",) and len(n.args) >= 2 and isinstance(n.args[1], ast.Constant) and n.args[1].value in (0o777, 511):
                add("excessive-permissions", n, "medium", "confirmed", 0.9, "chmod 777", "World-writable files can be tampered with.", "Use the least privilege needed.")
            if re.search(r"\.(extractall)$", fn) and not any(k.arg in ("filter",) for k in n.keywords):
                add("unsafe-extract", n, "medium", "suspected", 0.5, "archive extractall without path validation", "Crafted archives can write outside the target dir (path traversal).", "Validate members or use filter='data'.")
            if re.search(r"\.(execute|executemany|raw)$", fn) and n.args:
                a0 = n.args[0]
                if isinstance(a0, ast.JoinedStr) or (isinstance(a0, ast.BinOp) and isinstance(a0.op, (ast.Mod, ast.Add)) and not isinstance(a0.left, ast.Constant if False else ast.Pass)) \
                        or (isinstance(a0, ast.Call) and isinstance(a0.func, ast.Attribute) and a0.func.attr == "format"):
                    src = ast.unparse(a0)
                    if re.search(r"(?i)\b(select|insert|update|delete|drop|create)\b", src):
                        add("sql-injection", n, "high", "suspected", 0.8, "SQL statement built with string formatting", "User data concatenated into SQL can alter the query.",
                            "Use parameterised queries (placeholders).")
            if re.search(r"(print|log|logger|logging)\.?(info|debug|warning|error|exception)?$", fn) and any(
                    isinstance(a, (ast.Name, ast.JoinedStr)) and re.search(r"(?i)(password|passwd|secret|api_?key|token)", ast.unparse(a)) for a in n.args):
                add("sensitive-data-logged", n, "medium", "suspected", 0.6, "credential-like variable is printed/logged", "Secrets in logs leak to anyone who can read them.", "Never log credentials.")
        for n in ast.walk(tree):
            if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and re.search(r"(?i)(allow_origins|cors_origins)", t.id) for t in n.targets) and "'*'" in ast.unparse(n.value).replace('"', "'"):
                out.append(Finding("cors-wildcard", "security", "low", "recommendation", rel, n.lineno, "CORS allows every origin ('*')", 0.6,
                                   root_cause="Any website can call the API from a browser.", fix_plan="List trusted origins explicitly."))
    seen, uniq = set(), []
    for f in out:
        if f.id not in seen:
            seen.add(f.id)
            uniq.append(f)
    return uniq
