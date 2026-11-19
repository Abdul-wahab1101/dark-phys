"""Permissions & Safety Controller: scope, modes, protected files, approval gates, self-integrity."""
from __future__ import annotations

import fnmatch
import hashlib
import json
from pathlib import Path
from typing import Callable, Dict, List

from .config import MODES, PACKAGE_DIR


class SafetyError(Exception):
    """An operation is forbidden (outside scope, read-only mode, protected area)."""


class NeedsApproval(Exception):
    """An operation is allowed only after explicit human approval."""

    def __init__(self, operation: str, reason: str):
        super().__init__(f"{operation}: {reason}")
        self.operation, self.reason = operation, reason


# operations Doctor never performs by itself - they always need explicit approval
BLOCKED_OPERATIONS = {
    "delete_file": "destructive file operation", "delete_directory": "destructive file operation",
    "drop_database": "destructive database operation", "deploy_production": "production deployment",
    "publish_external": "external publishing", "modify_credentials": "credential modification",
    "escalate_permissions": "permission escalation", "install_package": "changes the environment",
    "paid_service": "paid service / purchase", "replace_architecture": "major architecture replacement",
    "write_outside_project": "outside the authorised project", "external_system_action": "affects an external system",
}
PROTECTED_PATTERNS = (".env", ".env.*", "*.pem", "*.key", "*.p12", "*.pfx", "id_rsa*", "*secret*", "*credential*", ".git/*", ".git")
INTEGRITY_FILES = ("safety.py", "backup.py", "config.py")


class PermissionController:
    def __init__(self, project_root: Path, mode_getter: Callable[[], str]):
        self.root = Path(project_root).resolve()
        self._mode = mode_getter

    @property
    def mode(self) -> str:
        m = self._mode()
        if m not in MODES:
            raise SafetyError(f"unknown mode '{m}'")
        return m

    # ---- scope -------------------------------------------------------------- #
    def resolve_in_scope(self, path) -> Path:
        p = Path(path)
        p = (self.root / p) if not p.is_absolute() else p
        rp = p.resolve()
        try:
            rp.relative_to(self.root)
        except ValueError:
            raise SafetyError(f"'{path}' is outside the authorised project ({self.root})")
        doc_root = PACKAGE_DIR.parent.resolve()
        if rp == doc_root or doc_root in rp.parents:
            raise SafetyError("the Doctor's own files are protected against self-modification")
        return rp

    def is_protected(self, rel: str) -> bool:
        rel = rel.replace("\\", "/")
        name = rel.rsplit("/", 1)[-1].lower()
        return any(fnmatch.fnmatch(rel.lower(), pat) or fnmatch.fnmatch(name, pat) for pat in PROTECTED_PATTERNS)

    # ---- gates ----------------------------------------------------------------- #
    def require_approval(self, operation: str) -> None:
        """Always raises: these operations are never performed automatically."""
        raise NeedsApproval(operation, BLOCKED_OPERATIONS.get(operation, "explicit approval required"))

    def guard_write(self, path, *, approved: bool = False, auto_ok: bool = False) -> Path:
        """Return the resolved path if writing is permitted right now, else raise."""
        rp = self.resolve_in_scope(path)
        rel = rp.relative_to(self.root).as_posix()
        if self.is_protected(rel) and not approved:
            raise NeedsApproval("modify_credentials", f"'{rel}' is a protected / credential-like file")
        mode = self.mode
        if mode == "diagnostic":
            raise SafetyError("diagnostic mode is read-only: the target project is never modified")
        if mode == "supervised" and not approved:
            raise NeedsApproval("apply_patch", "supervised mode: a human must approve every change")
        if mode == "autonomous" and not (approved or auto_ok):
            raise NeedsApproval("apply_patch", "autonomous mode only applies verified low-risk fixes automatically")
        return rp


# ---- self-protection: integrity manifest of the safety-critical modules ---------- #
def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_integrity_manifest() -> Dict[str, str]:
    manifest = {n: _digest(PACKAGE_DIR / n) for n in INTEGRITY_FILES}
    (PACKAGE_DIR / "integrity.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def verify_integrity() -> List[str]:
    """Names of safety modules whose content differs from the recorded manifest ([] = intact)."""
    mf = PACKAGE_DIR / "integrity.json"
    if not mf.exists():
        return ["integrity.json missing (run: python doctor.py init)"]
    recorded = json.loads(mf.read_text(encoding="utf-8"))
    return [n for n in INTEGRITY_FILES if recorded.get(n) != _digest(PACKAGE_DIR / n)]
