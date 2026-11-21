"""Constants, settings and data-directory handling."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any, Dict

VERSION = "1.0.0"
MODES = ("diagnostic", "supervised", "autonomous")
MODE_HELP = {
    "diagnostic": "inspect, scan, test in a throw-away copy, report. NEVER modifies the target project.",
    "supervised": "prepares patches + backups, applies a patch only after explicit approval.",
    "autonomous": "applies reproducible LOW-RISK fixes automatically (backup, test, rollback); everything else needs approval.",
}
SEVERITIES = ("critical", "high", "medium", "low", "info")
SEV_RANK = {s: i for i, s in enumerate(SEVERITIES)}
STATUSES = ("HEALTHY", "WARNING", "CRITICAL", "INVESTIGATING", "REPAIRING", "FIXED", "VERIFIED", "ROLLED BACK", "NEEDS APPROVAL")

IGNORED_DIRS = {".git", ".hg", ".svn", "node_modules", "venv", ".venv", "env", "__pycache__", "dist", "build", ".mypy_cache",
                ".pytest_cache", ".tox", ".idea", ".vscode", "site-packages", ".doctor", "doctor_data", ".next", ".gradle",
                "target", "bin", "obj", ".cache", "coverage", ".eggs"}
LANG_BY_EXT = {".py": "Python", ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
               ".ts": "TypeScript", ".tsx": "TypeScript", ".java": "Java", ".cs": "C#", ".cpp": "C++", ".cc": "C++",
               ".c": "C", ".h": "C/C++", ".hpp": "C++", ".go": "Go", ".rs": "Rust", ".php": "PHP", ".rb": "Ruby",
               ".dart": "Dart", ".swift": "Swift", ".kt": "Kotlin", ".sh": "Shell", ".ps1": "PowerShell", ".sql": "SQL",
               ".html": "HTML", ".css": "CSS", ".vue": "Vue"}
CONFIG_EXT = {".json", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".env"}
MAX_FILE_BYTES = 2_000_000

PACKAGE_DIR = Path(__file__).resolve().parent
DOCTOR_ROOT = PACKAGE_DIR.parent

DEFAULT_SETTINGS: Dict[str, Any] = {
    "mode": "diagnostic",
    "monitor_interval": 30,
    "max_files": 5000,
    "test_timeout": 300,
    "use_shadow": True,
    "auto_max_changed_lines": 30,
    "mutation_budget_seconds": 90,
    "dashboard_port": 8765,
}


def project_slug(project: Path) -> str:
    p = Path(project).resolve()
    return f"{p.name or 'project'}-{hashlib.sha1(str(p).encode()).hexdigest()[:8]}"


def data_dir_for(project: Path, override: str | None = None) -> Path:
    base = Path(override or os.environ.get("DOCTOR_HOME") or (DOCTOR_ROOT / "doctor_data"))
    d = base / project_slug(project)
    d.mkdir(parents=True, exist_ok=True)
    return d


class Settings:
    """Persistent settings (mode etc.) kept OUTSIDE the target project."""

    def __init__(self, data_dir: Path):
        self.path = Path(data_dir) / "settings.json"
        self.data = dict(DEFAULT_SETTINGS)
        self.reload()

    def reload(self) -> None:
        if self.path.exists():
            try:
                self.data.update(json.loads(self.path.read_text(encoding="utf-8")))
            except (OSError, ValueError):
                pass

    def save(self) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, indent=2), encoding="utf-8")
        os.replace(tmp, self.path)

    def get(self, key: str):
        self.reload()
        return self.data.get(key, DEFAULT_SETTINGS.get(key))

    def set(self, key: str, value) -> None:
        if key == "mode" and value not in MODES:
            raise ValueError(f"mode must be one of {MODES}")
        self.data[key] = value
        self.save()
