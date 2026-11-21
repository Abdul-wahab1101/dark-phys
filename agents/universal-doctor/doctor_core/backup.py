"""Backups, diffs, atomic writes and verified rollback with path confinement."""
from __future__ import annotations

import difflib
import hashlib
import json
import os
import re
import shutil
import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_file(p: Path) -> str:
    return sha256_bytes(Path(p).read_bytes())


def read_text_preserving(path: Path):
    """(text with LF, newline style, encoding) - so patches keep CRLF / BOM exactly."""
    raw = Path(path).read_bytes()
    enc = "utf-8-sig" if raw.startswith(b"\xef\xbb\xbf") else "utf-8"
    text = raw.decode(enc)
    crlf = text.count("\r\n") > text.count("\n") / 2 if "\n" in text else False
    return text.replace("\r\n", "\n"), ("\r\n" if crlf else "\n"), enc


def atomic_write_text(path: Path, text_lf: str, newline: str = "\n", encoding: str = "utf-8") -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = text_lf.replace("\n", newline).encode(encoding)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex[:8]}.doctor-tmp")
    try:
        with open(tmp, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


class BackupManager:
    def __init__(self, project_root: Path, data_dir: Path):
        self.root = Path(project_root).resolve()
        self.dir = Path(data_dir).resolve() / "backups"
        self.dir.mkdir(parents=True, exist_ok=True)

    def _target(self, rel: str) -> Path:
        """Resolve a project-relative regular-file target without following symlinks."""
        if not isinstance(rel, str) or not rel.strip():
            raise ValueError("backup path must be a non-empty relative path")
        raw = Path(rel)
        if raw.is_absolute() or any(part in ("..", "") for part in raw.parts):
            raise ValueError(f"unsafe backup path: {rel!r}")
        target = self.root / raw
        resolved = target.resolve(strict=False)
        try:
            resolved.relative_to(self.root)
        except ValueError as exc:
            raise ValueError(f"backup path escapes project root: {rel!r}") from exc
        current = self.root
        for part in raw.parts:
            current = current / part
            if current.is_symlink():
                raise ValueError(f"symlink paths are not allowed in backups: {rel!r}")
        if target.exists() and not target.is_file():
            raise ValueError(f"backup target must be a regular file: {rel!r}")
        return target

    def _backup_dir(self, bid: str) -> Path:
        if not isinstance(bid, str) or not re.fullmatch(r"\d{8}_\d{6}_[0-9a-f]{6}", bid):
            raise ValueError("invalid backup id")
        folder = self.dir / bid
        try:
            folder.resolve(strict=False).relative_to(self.dir)
        except ValueError as exc:
            raise ValueError("backup id escapes backup directory") from exc
        if folder.is_symlink():
            raise ValueError("backup directory must not be a symlink")
        return folder

    def create(self, rel_files: List[str], reason: str, meta: Optional[dict] = None) -> str:
        bid = time.strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:6]
        bdir = self._backup_dir(bid)
        files: Dict[str, dict] = {}
        # Validate every path before creating any backup content.
        targets = [(rel, self._target(rel)) for rel in rel_files]
        (bdir / "files").mkdir(parents=True, exist_ok=False)
        try:
            for rel, src in targets:
                if src.exists():
                    dst = bdir / "files" / rel
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, dst)
                    files[rel] = {"sha256": sha256_file(src), "size": src.stat().st_size, "existed": True}
                else:
                    files[rel] = {"existed": False}
            manifest = {"id": bid, "created": time.strftime("%Y-%m-%dT%H:%M:%S"), "reason": str(reason),
                        "files": files, "meta": meta or {}}
            tmp = bdir / ".manifest.tmp"
            tmp.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
            os.replace(tmp, bdir / "manifest.json")
        except Exception:
            shutil.rmtree(bdir, ignore_errors=True)
            raise
        return bid

    def manifest(self, bid: str) -> dict:
        path = self._backup_dir(bid) / "manifest.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("id") != bid or not isinstance(data.get("files"), dict):
            raise ValueError("invalid backup manifest")
        for rel in data["files"]:
            self._target(rel)
        return data

    def verify(self, bid: str) -> bool:
        """Are the stored copies intact (SHA-256), and are all manifest paths safe?"""
        try:
            m = self.manifest(bid)
            bdir = self._backup_dir(bid)
            for rel, info in m["files"].items():
                if info.get("existed"):
                    p = bdir / "files" / rel
                    if p.is_symlink() or not p.is_file() or sha256_file(p) != info.get("sha256"):
                        return False
            return True
        except (OSError, ValueError, KeyError, TypeError):
            return False

    def diff(self, bid: str) -> str:
        m, out = self.manifest(bid), []
        bdir = self._backup_dir(bid)
        for rel, info in m["files"].items():
            old = (bdir / "files" / rel).read_text(encoding="utf-8", errors="replace") if info.get("existed") else ""
            cur_p = self._target(rel)
            new = cur_p.read_text(encoding="utf-8", errors="replace") if cur_p.exists() else ""
            out += list(difflib.unified_diff(old.splitlines(True), new.splitlines(True), f"a/{rel}", f"b/{rel}"))
        return "".join(out)

    def restore(self, bid: str) -> dict:
        """Restore byte-for-byte only after validating the complete backup and all target paths."""
        if not self.verify(bid):
            return {"ok": False, "error": "backup is damaged or contains unsafe paths - restore refused"}
        m, restored, problems = self.manifest(bid), [], []
        bdir = self._backup_dir(bid)
        targets = [(rel, info, self._target(rel)) for rel, info in m["files"].items()]
        for rel, info, target in targets:
            if info.get("existed"):
                src = bdir / "files" / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                tmp = target.with_name(f".{target.name}.{uuid.uuid4().hex[:8]}.doctor-tmp")
                try:
                    shutil.copyfile(src, tmp)
                    os.replace(tmp, target)
                finally:
                    if tmp.exists():
                        tmp.unlink()
                if sha256_file(target) != info["sha256"]:
                    problems.append(rel)
                restored.append(rel)
            elif target.exists():
                target.unlink()
                restored.append(rel)
        return {"ok": not problems, "restored": restored, "mismatch": problems}

    def list(self) -> List[dict]:
        out = []
        for d in sorted(self.dir.iterdir()):
            if d.is_symlink() or not d.is_dir() or not re.fullmatch(r"\d{8}_\d{6}_[0-9a-f]{6}", d.name):
                continue
            if (d / "manifest.json").exists():
                m = self.manifest(d.name)
                out.append({"id": m["id"], "created": m["created"], "reason": m["reason"], "files": list(m["files"])})
        return out
