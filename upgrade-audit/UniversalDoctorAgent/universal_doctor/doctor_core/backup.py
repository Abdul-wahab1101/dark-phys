"""Backups, diffs, atomic writes and verified rollback."""
from __future__ import annotations

import difflib
import hashlib
import json
import os
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
    data = text_lf.replace("\n", newline).encode(encoding)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex[:8]}.doctor-tmp")
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


class BackupManager:
    def __init__(self, project_root: Path, data_dir: Path):
        self.root = Path(project_root).resolve()
        self.dir = Path(data_dir) / "backups"
        self.dir.mkdir(parents=True, exist_ok=True)

    def create(self, rel_files: List[str], reason: str, meta: Optional[dict] = None) -> str:
        bid = time.strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:6]
        bdir = self.dir / bid
        files: Dict[str, dict] = {}
        for rel in rel_files:
            src = self.root / rel
            if src.exists():
                dst = bdir / "files" / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
                files[rel] = {"sha256": sha256_file(src), "size": src.stat().st_size, "existed": True}
            else:
                files[rel] = {"existed": False}
        bdir.mkdir(parents=True, exist_ok=True)
        (bdir / "manifest.json").write_text(json.dumps(
            {"id": bid, "created": time.strftime("%Y-%m-%dT%H:%M:%S"), "reason": reason, "files": files, "meta": meta or {}},
            indent=2), encoding="utf-8")
        return bid

    def manifest(self, bid: str) -> dict:
        return json.loads((self.dir / bid / "manifest.json").read_text(encoding="utf-8"))

    def verify(self, bid: str) -> bool:
        """Are the stored copies intact (SHA-256)?"""
        m = self.manifest(bid)
        for rel, info in m["files"].items():
            if info.get("existed"):
                p = self.dir / bid / "files" / rel
                if not p.exists() or sha256_file(p) != info["sha256"]:
                    return False
        return True

    def diff(self, bid: str) -> str:
        m, out = self.manifest(bid), []
        for rel, info in m["files"].items():
            old = (self.dir / bid / "files" / rel).read_text(encoding="utf-8", errors="replace") if info.get("existed") else ""
            cur_p = self.root / rel
            new = cur_p.read_text(encoding="utf-8", errors="replace") if cur_p.exists() else ""
            out += list(difflib.unified_diff(old.splitlines(True), new.splitlines(True), f"a/{rel}", f"b/{rel}"))
        return "".join(out)

    def restore(self, bid: str) -> dict:
        """Put every backed-up file back byte-for-byte and verify the result."""
        if not self.verify(bid):
            return {"ok": False, "error": "backup itself is damaged - restore refused"}
        m, restored, problems = self.manifest(bid), [], []
        for rel, info in m["files"].items():
            target = self.root / rel
            if info.get("existed"):
                src = self.dir / bid / "files" / rel
                tmp = target.with_name(f".{target.name}.{uuid.uuid4().hex[:8]}.doctor-tmp")
                shutil.copyfile(src, tmp)
                os.replace(tmp, target)
                if sha256_file(target) != info["sha256"]:
                    problems.append(rel)
                restored.append(rel)
            elif target.exists():
                target.unlink()                  # a file Doctor itself had created for this repair
                restored.append(rel)
        return {"ok": not problems, "restored": restored, "mismatch": problems}

    def list(self) -> List[dict]:
        out = []
        for d in sorted(self.dir.iterdir()):
            if (d / "manifest.json").exists():
                m = self.manifest(d.name)
                out.append({"id": m["id"], "created": m["created"], "reason": m["reason"], "files": list(m["files"])})
        return out
