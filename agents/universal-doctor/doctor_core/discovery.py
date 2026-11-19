"""Project discovery, technology detection and architecture intelligence."""
from __future__ import annotations

import ast
import hashlib
import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

from .config import CONFIG_EXT, IGNORED_DIRS, LANG_BY_EXT, MAX_FILE_BYTES

try:
    import tomllib
except Exception:                                   # pragma: no cover
    tomllib = None

STDLIB = set(getattr(sys, "stdlib_module_names", ())) | {"__future__"}
FRAMEWORK_KEYS = {
    "flask": "Flask", "fastapi": "FastAPI", "django": "Django", "starlette": "Starlette", "tornado": "Tornado",
    "react": "React", "next": "Next.js", "vue": "Vue", "@angular/core": "Angular", "express": "Express",
    "react-native": "React Native", "laravel/framework": "Laravel", "flutter": "Flutter", "spring-boot": "Spring Boot",
    "openai": "OpenAI SDK", "anthropic": "Anthropic SDK", "langchain": "LangChain", "llama_index": "LlamaIndex",
    "chromadb": "ChromaDB", "faiss": "FAISS", "transformers": "HF Transformers", "sqlalchemy": "SQLAlchemy",
    "pytest": "pytest", "jest": "Jest", "playwright": "Playwright", "celery": "Celery", "pydantic": "Pydantic",
}
DB_KEYS = {"sqlite3": "SQLite", "sqlalchemy": "SQLAlchemy", "psycopg2": "PostgreSQL", "pymysql": "MySQL", "mysql": "MySQL",
           "pymongo": "MongoDB", "redis": "Redis", "chromadb": "ChromaDB", "faiss": "FAISS", "sqlite": "SQLite"}
AI_KEYS = ("openai", "anthropic", "langchain", "llama_index", "chromadb", "faiss", "transformers", "ollama", "google.generativeai", "cohere")


class ProjectModel:
    def __init__(self, root: Path):
        self.root = Path(root).resolve()
        self.files: List[dict] = []
        self.languages: Counter = Counter()
        self.frameworks: Set[str] = set()
        self.build_systems: Set[str] = set()
        self.dependencies: Dict[str, str] = {}
        self.databases: Set[str] = set()
        self.apis: List[dict] = []
        self.deployment: List[str] = []
        self.docs: List[str] = []
        self.tests: List[str] = []
        self.entry_points: List[str] = []
        self.ai_systems: Set[str] = set()
        self.notes: List[str] = []
        self.sources: Dict[str, str] = {}            # rel -> text (LF) for text files we analyse
        self.trees: Dict[str, ast.AST] = {}
        self.syntax_errors: Dict[str, dict] = {}
        self.imports: Dict[str, List[dict]] = {}     # rel -> [{module, level, names, line, top_level, guarded}]
        self.graph: Dict[str, Set[str]] = defaultdict(set)         # all local import edges
        self.top_graph: Dict[str, Set[str]] = defaultdict(set)     # edges from import statements executed at import time
        self.reverse: Dict[str, Set[str]] = defaultdict(set)
        self.skipped: List[str] = []
        self.truncated = False

    # ---- helpers ------------------------------------------------------------------ #
    @property
    def py_files(self) -> List[str]:
        return [f["rel"] for f in self.files if f["ext"] == ".py"]

    def is_test(self, rel: str) -> bool:
        n = rel.rsplit("/", 1)[-1]
        return n.startswith("test_") or n.endswith("_test.py") or "/tests/" in "/" + rel or n == "conftest.py"

    def local_module_names(self) -> Set[str]:
        out = set()
        for rel in self.py_files:
            parts = rel[:-3].split("/")
            out.add(parts[-1])
            if parts[-1] == "__init__" and len(parts) > 1:
                out.add(parts[-2])
        return out

    def summary(self) -> dict:
        return {"files": len(self.files), "languages": dict(self.languages), "frameworks": sorted(self.frameworks),
                "build_systems": sorted(self.build_systems), "databases": sorted(self.databases),
                "ai_systems": sorted(self.ai_systems), "tests": len(self.tests), "entry_points": self.entry_points[:20],
                "deployment": self.deployment, "apis": len(self.apis), "dependencies": len(self.dependencies),
                "syntax_errors": len(self.syntax_errors), "truncated": self.truncated}


# --------------------------------------------------------------------------- #
def discover(root: Path, max_files: int = 5000) -> ProjectModel:
    m = ProjectModel(root)
    count = 0
    for dirpath, dirnames, filenames in os.walk(m.root):
        dirnames[:] = sorted(d for d in dirnames if d not in IGNORED_DIRS and not d.startswith(".doctor"))
        for fn in sorted(filenames):
            if fn.endswith(".doctor-tmp"):
                continue
            p = Path(dirpath) / fn
            rel = p.relative_to(m.root).as_posix()
            try:
                size = p.stat().st_size
            except OSError:
                continue
            ext = p.suffix.lower()
            count += 1
            if count > max_files:
                m.truncated = True
                break
            lang = LANG_BY_EXT.get(ext, "")
            info = {"rel": rel, "size": size, "ext": ext, "lang": lang, "lines": 0}
            if lang or ext in CONFIG_EXT or fn in ("Dockerfile", "Makefile", "requirements.txt", "Procfile") or fn.startswith(".env"):
                if size <= MAX_FILE_BYTES:
                    try:
                        raw = p.read_bytes()
                        if b"\x00" not in raw[:4096]:
                            text = raw.decode("utf-8-sig", errors="replace").replace("\r\n", "\n")
                            m.sources[rel] = text
                            info["lines"] = text.count("\n") + 1
                    except OSError:
                        pass
                else:
                    m.skipped.append(f"{rel} (> {MAX_FILE_BYTES // 1000} KB)")
            if lang:
                m.languages[lang] += 1
            m.files.append(info)
        if m.truncated:
            m.notes.append(f"scan truncated at {max_files} files (raise max_files in settings)")
            break
    _detect_technologies(m)
    _parse_python(m)
    _build_graph(m)
    _detect_entry_points(m)
    return m


def _read_json(m: ProjectModel, rel: str) -> dict:
    try:
        return json.loads(m.sources.get(rel, "{}") or "{}")
    except ValueError:
        return {}


def _detect_technologies(m: ProjectModel) -> None:
    names = {f["rel"].rsplit("/", 1)[-1]: f["rel"] for f in m.files}
    deps: Dict[str, str] = {}
    for rel, text in m.sources.items():
        base = rel.rsplit("/", 1)[-1]
        if base.startswith("requirements") and base.endswith(".txt"):
            m.build_systems.add("pip")
            for line in text.splitlines():
                line = line.split("#")[0].strip()
                if line and not line.startswith(("-", "git+", "http")):
                    mm = re.match(r"([A-Za-z0-9_.\-\[\]]+)\s*([<>=!~]=?.*)?", line)
                    if mm:
                        deps[mm.group(1).split("[")[0].lower()] = (mm.group(2) or "").strip()
        elif base == "pyproject.toml" and tomllib:
            m.build_systems.add("pyproject")
            try:
                d = tomllib.loads(text)
                for item in d.get("project", {}).get("dependencies", []):
                    mm = re.match(r"([A-Za-z0-9_.\-]+)\s*(.*)", item)
                    if mm:
                        deps[mm.group(1).lower()] = mm.group(2).strip()
                for k, v in d.get("tool", {}).get("poetry", {}).get("dependencies", {}).items():
                    deps[k.lower()] = str(v)
            except Exception:
                m.notes.append(f"{rel}: could not parse TOML")
        elif base == "package.json":
            m.build_systems.add("npm")
            d = _read_json(m, rel)
            for sect in ("dependencies", "devDependencies"):
                for k, v in (d.get(sect) or {}).items():
                    deps[k.lower()] = str(v)
        elif base == "composer.json":
            m.build_systems.add("composer")
            for k, v in (_read_json(m, rel).get("require") or {}).items():
                deps[k.lower()] = str(v)
        elif base in ("pom.xml", "build.gradle", "build.gradle.kts"):
            m.build_systems.add("maven/gradle")
            if "spring-boot" in text:
                m.frameworks.add("Spring Boot")
        elif base.endswith(".csproj") or base.endswith(".sln"):
            m.build_systems.add(".NET")
            m.frameworks.add(".NET")
        elif base == "pubspec.yaml":
            m.build_systems.add("pub")
            if "flutter" in text:
                m.frameworks.add("Flutter")
        elif base in ("Cargo.toml",):
            m.build_systems.add("cargo")
        elif base == "go.mod":
            m.build_systems.add("go modules")
        elif base == "Makefile":
            m.build_systems.add("make")
    m.dependencies = deps
    for key, label in FRAMEWORK_KEYS.items():
        if key in deps:
            m.frameworks.add(label)
    for rel in m.sources:
        base = rel.rsplit("/", 1)[-1]
        low = rel.lower()
        if base == "Dockerfile" or base.startswith("Dockerfile."):
            m.deployment.append("Docker: " + rel)
        elif base in ("docker-compose.yml", "docker-compose.yaml", "compose.yaml"):
            m.deployment.append("Docker Compose: " + rel)
        elif ".github/workflows/" in low:
            m.deployment.append("GitHub Actions: " + rel)
        elif base in ("Jenkinsfile", "Procfile", ".gitlab-ci.yml", "serverless.yml", "azure-pipelines.yml") or low.endswith(".tf"):
            m.deployment.append(base + ": " + rel)
        elif base.lower().startswith("readme") or low.startswith("docs/"):
            m.docs.append(rel)
        if m.is_test(rel) or low.endswith((".test.js", ".spec.js", ".test.ts", ".spec.ts")):
            m.tests.append(rel)
    for f in m.files:
        if f["ext"] in (".db", ".sqlite", ".sqlite3"):
            m.databases.add("SQLite")


def _parse_python(m: ProjectModel) -> None:
    for rel in m.py_files:
        text = m.sources.get(rel)
        if text is None:
            continue
        try:
            tree = ast.parse(text, filename=rel)
        except SyntaxError as e:
            m.syntax_errors[rel] = {"msg": e.msg, "line": e.lineno or 1, "col": e.offset or 0,
                                    "text": (e.text or "").rstrip("\n")}
            continue
        except (ValueError, RecursionError) as e:
            m.syntax_errors[rel] = {"msg": str(e), "line": 1, "col": 0, "text": ""}
            continue
        m.trees[rel] = tree
        imps: List[dict] = []
        guarded: Set[int] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Try):
                for h in node.handlers:
                    types = [ast.unparse(h.type)] if h.type is not None else ["BaseException"]
                    if any(t in ("ImportError", "ModuleNotFoundError", "Exception", "BaseException") or "ImportError" in t for t in types):
                        for sub in node.body:
                            for n2 in ast.walk(sub):
                                guarded.add(id(n2))
        toplevel = {id(n) for n in ast.walk(ast.Module(body=[s for s in tree.body if not isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef))], type_ignores=[]))}
        in_func: Set[int] = set()
        for n in ast.walk(tree):
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                for n2 in ast.walk(n):
                    in_func.add(id(n2))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for a in node.names:
                    imps.append({"module": a.name, "level": 0, "names": [], "line": node.lineno,
                                 "top_level": id(node) not in in_func, "guarded": id(node) in guarded, "asname": a.asname})
            elif isinstance(node, ast.ImportFrom):
                imps.append({"module": node.module or "", "level": node.level, "names": [a.name for a in node.names],
                             "line": node.lineno, "top_level": id(node) not in in_func, "guarded": id(node) in guarded})
        m.imports[rel] = imps
    for rel, text in m.sources.items():
        if rel.endswith((".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs")):
            imps = []
            for mm in re.finditer(r"""(?:import\s+(?:[\w*{}\s,]+\s+from\s+)?|require\()\s*['"](\.{1,2}/[^'"]+)['"]""", text):
                imps.append({"module": mm.group(1), "level": -1, "names": [], "line": text[:mm.start()].count("\n") + 1,
                             "top_level": True, "guarded": False})
            m.imports[rel] = imps


def resolve_import(m: ProjectModel, importer: str, module: str, level: int) -> Optional[str]:
    """Resolve an import to a project file (rel path) or None if it is not local."""
    files = {f["rel"] for f in m.files}
    imp_dir = importer.rsplit("/", 1)[0] if "/" in importer else ""

    def try_base(base: str, mod: str) -> Optional[str]:
        path = (base + "/" if base else "") + mod.replace(".", "/") if mod else base
        for cand in (path + ".py", path + "/__init__.py"):
            if cand in files:
                return cand
        return None
    if level == -1:                                    # JS relative
        base = imp_dir
        target = os.path.normpath((base + "/" if base else "") + module).replace("\\", "/")
        for suf in ("", ".js", ".jsx", ".ts", ".tsx", ".mjs", "/index.js", "/index.ts"):
            if target + suf in files:
                return target + suf
        return None
    if level > 0:
        base = imp_dir
        for _ in range(level - 1):
            base = base.rsplit("/", 1)[0] if "/" in base else ""
        return try_base(base, module) if module else (base + "/__init__.py" if base + "/__init__.py" in files else None)
    # absolute: project root, then importer's dir and its ancestors (script-style imports), then any "src" root
    bases, d = [""], imp_dir
    chain = []
    while d:
        chain.append(d)
        d = d.rsplit("/", 1)[0] if "/" in d else ""
    bases = chain + [""] + [b for b in ("src", "lib") if any(f.startswith(b + "/") for f in files)]
    for b in bases:
        r = try_base(b, module)
        if r:
            return r
    return None


def _build_graph(m: ProjectModel) -> None:
    for rel, imps in m.imports.items():
        for imp in imps:
            target = resolve_import(m, rel, imp["module"], imp["level"])
            cands = [target] if target else []
            if imp["level"] != -1 and imp["names"]:
                for name in imp["names"]:               # from pkg import submodule
                    sub = resolve_import(m, rel, (imp["module"] + "." if imp["module"] else "") + name, imp["level"])
                    if sub:
                        cands.append(sub)
            for t in cands:
                if t and t != rel:
                    m.graph[rel].add(t)
                    m.reverse[t].add(rel)
                    if imp["top_level"] and not imp["guarded"]:
                        m.top_graph[rel].add(t)
            imp["resolved"] = target


def _detect_entry_points(m: ProjectModel) -> None:
    for rel, tree in m.trees.items():
        for node in tree.body:
            if isinstance(node, ast.If) and "__name__" in ast.dump(node.test) and "__main__" in ast.dump(node.test):
                m.entry_points.append(rel)
                break
    for rel in m.sources:
        if rel.endswith("package.json"):
            d = _read_json(m, rel)
            if d.get("main"):
                m.entry_points.append(f"{rel}: main={d['main']}")
            for k, v in (d.get("scripts") or {}).items():
                if k in ("start", "dev", "build", "test"):
                    m.entry_points.append(f"{rel}: npm run {k} -> {v}")
    for rel, tree in m.trees.items():                    # API routes
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for dec in node.decorator_list:
                    s = ast.unparse(dec)
                    mm = re.match(r"\w+\.(route|get|post|put|delete|patch)\((['\"][^'\"]*['\"])", s)
                    if mm:
                        m.apis.append({"file": rel, "function": node.name, "route": mm.group(2).strip("'\""), "kind": "python"})
    for rel, text in m.sources.items():
        if rel.endswith((".js", ".ts", ".mjs")):
            for mm in re.finditer(r"\b(?:app|router)\.(get|post|put|delete|patch)\(\s*['\"]([^'\"]+)", text):
                m.apis.append({"file": rel, "function": "", "route": mm.group(2), "kind": "node"})
    for rel, imps in m.imports.items():
        for imp in imps:
            top = imp["module"].split(".")[0]
            if top in DB_KEYS:
                m.databases.add(DB_KEYS[top])
            if top in AI_KEYS or imp["module"] in AI_KEYS:
                m.ai_systems.add(top)
            if top in FRAMEWORK_KEYS:
                m.frameworks.add(FRAMEWORK_KEYS[top])


# --------------------------------------------------------------------------- #
# architecture intelligence
# --------------------------------------------------------------------------- #
def find_cycles(graph: Dict[str, Set[str]]) -> List[List[str]]:
    """Tarjan strongly connected components with more than one node (or a self loop)."""
    index, low, on, stack, out = {}, {}, set(), [], []
    counter = [0]
    sys.setrecursionlimit(max(sys.getrecursionlimit(), 10000))

    def strong(v):
        index[v] = low[v] = counter[0]
        counter[0] += 1
        stack.append(v)
        on.add(v)
        for w in graph.get(v, ()):
            if w not in index:
                strong(w)
                low[v] = min(low[v], low[w])
            elif w in on:
                low[v] = min(low[v], index[w])
        if low[v] == index[v]:
            comp = []
            while True:
                w = stack.pop()
                on.discard(w)
                comp.append(w)
                if w == v:
                    break
            if len(comp) > 1:
                out.append(sorted(comp))
    for v in sorted(graph):
        if v not in index:
            strong(v)
    return out


def architecture(m: ProjectModel) -> dict:
    cycles = find_cycles(m.top_graph)
    entry = {e for e in m.entry_points if ":" not in e}
    reachable: Dict[str, int] = {}
    for e in entry:
        seen, todo = set(), [e]
        while todo:
            x = todo.pop()
            if x in seen:
                continue
            seen.add(x)
            todo.extend(m.graph.get(x, ()))
        reachable[e] = len(seen)
    names = {"main.py", "app.py", "manage.py", "setup.py", "conftest.py", "wsgi.py", "asgi.py", "__main__.py", "__init__.py"}
    orphans = [r for r in m.py_files
               if not m.reverse.get(r) and r not in entry and not m.is_test(r) and r.rsplit("/", 1)[-1] not in names
               and m.sources.get(r, "").strip()]
    dup: Dict[str, List[str]] = defaultdict(list)
    incomplete: List[dict] = []
    for rel, tree in m.trees.items():
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                body = node.body[1:] if (node.body and isinstance(node.body[0], ast.Expr) and isinstance(getattr(node.body[0], "value", None), ast.Constant) and isinstance(node.body[0].value.value, str)) else node.body
                if len(body) >= 6:
                    norm = ast.dump(ast.Module(body=body, type_ignores=[]), annotate_fields=False)
                    dup[hashlib.sha1(norm.encode()).hexdigest()].append(f"{rel}:{node.lineno}:{node.name}")
                only_pass = len(body) == 1 and (isinstance(body[0], ast.Pass) or (isinstance(body[0], ast.Raise) and "NotImplementedError" in ast.dump(body[0])))
                if only_pass and not node.name.startswith("_") and not any("abstract" in ast.dump(d) for d in node.decorator_list):
                    incomplete.append({"file": rel, "line": node.lineno, "what": f"function '{node.name}' is a stub"})
    for rel, text in m.sources.items():
        if rel.endswith(tuple(LANG_BY_EXT)) and not m.is_test(rel):
            for i, line in enumerate(text.splitlines(), 1):
                if re.search(r"#\s*(TODO|FIXME|XXX|HACK)\b|//\s*(TODO|FIXME)\b", line):
                    incomplete.append({"file": rel, "line": i, "what": line.strip()[:120]})
    fan_in = sorted(((len(v), k) for k, v in m.reverse.items()), reverse=True)[:10]
    return {"cycles": cycles, "orphans": orphans, "duplicates": [v for v in dup.values() if len({x.split(':')[0] for x in v}) > 1 or len(v) > 1],
            "incomplete": incomplete, "entry_reach": reachable, "most_depended_on": [{"file": f, "dependents": n} for n, f in fan_in],
            "modules": len(m.py_files), "edges": sum(len(v) for v in m.graph.values())}


def impact_of(m: ProjectModel, rels: List[str]) -> dict:
    """Change impact: transitive dependents, affected tests, a simple risk estimate."""
    seen: Set[str] = set()
    todo = list(rels)
    while todo:
        x = todo.pop()
        for d in m.reverse.get(x, ()):
            if d not in seen and d not in rels:
                seen.add(d)
                todo.append(d)
    tests = sorted(t for t in seen | set(rels) if m.is_test(t))
    direct = sum(len(m.reverse.get(r, ())) for r in rels)
    risk = "high" if len(seen) > 15 or direct > 8 else ("medium" if len(seen) > 4 else "low")
    return {"changed": rels, "dependents": sorted(seen), "tests": tests, "risk": risk, "direct_dependents": direct}
