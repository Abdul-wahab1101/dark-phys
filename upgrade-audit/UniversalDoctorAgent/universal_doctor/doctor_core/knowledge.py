"""Persistent project knowledge (SQLite): scans, findings state, repair history, events, conventions."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional


class _Result:
    def __init__(self, rows, lastrowid):
        self.rows, self.lastrowid = rows, lastrowid

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows

    def __iter__(self):
        return iter(self.rows)


class _LockedDB:
    """One sqlite connection shared by the scan thread, the monitor thread and the dashboard threads (serialised by a lock)."""

    def __init__(self, path):
        self.c = sqlite3.connect(str(path), timeout=30, check_same_thread=False)
        self.c.row_factory = sqlite3.Row
        self.lock = threading.RLock()

    def execute(self, sql, params=()):
        with self.lock:
            cur = self.c.execute(sql, params)
            rows = cur.fetchall() if cur.description else []
            return _Result(rows, cur.lastrowid)

    def executemany(self, sql, seq):
        with self.lock:
            self.c.executemany(sql, seq)

    def executescript(self, script):
        with self.lock:
            self.c.executescript(script)

    def commit(self):
        with self.lock:
            self.c.commit()

    def close(self):
        with self.lock:
            self.c.close()


class Knowledge:
    def __init__(self, data_dir: Path):
        self.path = Path(data_dir) / "knowledge.db"
        self.db = _LockedDB(self.path)
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS scans(id INTEGER PRIMARY KEY, ts TEXT, summary TEXT);
        CREATE TABLE IF NOT EXISTS findings(id TEXT, scan_id INTEGER, json TEXT, PRIMARY KEY(id, scan_id));
        CREATE TABLE IF NOT EXISTS finding_state(id TEXT PRIMARY KEY, status TEXT, ts TEXT);
        CREATE TABLE IF NOT EXISTS repairs(id INTEGER PRIMARY KEY, ts TEXT, finding_id TEXT, rule TEXT, strategy TEXT, file TEXT,
            status TEXT, risk TEXT, diff TEXT, before_sha TEXT, after_sha TEXT, backup_id TEXT, tests TEXT, notes TEXT);
        CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, ts TEXT, kind TEXT, message TEXT, data TEXT);
        CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);
        """)
        self.db.commit()

    @staticmethod
    def _now() -> str:
        return time.strftime("%Y-%m-%dT%H:%M:%S")

    # ---- scans / findings ----------------------------------------------------------- #
    def record_scan(self, summary: dict, findings: List[dict]) -> int:
        cur = self.db.execute("INSERT INTO scans(ts, summary) VALUES(?,?)", (self._now(), json.dumps(summary)))
        sid = cur.lastrowid
        self.db.executemany("INSERT OR REPLACE INTO findings(id, scan_id, json) VALUES(?,?,?)",
                            [(f["id"], sid, json.dumps(f)) for f in findings])
        self.db.commit()
        return sid

    def latest_scan(self) -> Optional[dict]:
        r = self.db.execute("SELECT * FROM scans ORDER BY id DESC LIMIT 1").fetchone()
        return None if not r else {"id": r["id"], "ts": r["ts"], "summary": json.loads(r["summary"])}

    def latest_findings(self) -> List[dict]:
        s = self.latest_scan()
        if not s:
            return []
        states = {r["id"]: r["status"] for r in self.db.execute("SELECT id, status FROM finding_state")}
        out = []
        for r in self.db.execute("SELECT json FROM findings WHERE scan_id=?", (s["id"],)):
            f = json.loads(r["json"])
            f["status"] = states.get(f["id"], f.get("status", "OPEN"))
            out.append(f)
        return out

    def set_finding_status(self, fid: str, status: str) -> None:
        self.db.execute("INSERT OR REPLACE INTO finding_state(id, status, ts) VALUES(?,?,?)", (fid, status, self._now()))
        self.db.commit()

    def scans(self, limit: int = 20) -> List[dict]:
        return [{"id": r["id"], "ts": r["ts"], "summary": json.loads(r["summary"])}
                for r in self.db.execute("SELECT * FROM scans ORDER BY id DESC LIMIT ?", (limit,))]

    # ---- repairs ------------------------------------------------------------------------ #
    def record_repair(self, **f) -> int:
        f.setdefault("ts", self._now())
        f["tests"] = json.dumps(f.get("tests", {}))
        cols = ["ts", "finding_id", "rule", "strategy", "file", "status", "risk", "diff", "before_sha", "after_sha", "backup_id", "tests", "notes"]
        cur = self.db.execute(f"INSERT INTO repairs({','.join(cols)}) VALUES({','.join('?' * len(cols))})",
                              [f.get(c, "") for c in cols])
        self.db.commit()
        return cur.lastrowid

    def update_repair(self, rid: int, **f) -> None:
        if "tests" in f:
            f["tests"] = json.dumps(f["tests"])
        sets = ", ".join(f"{k}=?" for k in f)
        self.db.execute(f"UPDATE repairs SET {sets} WHERE id=?", list(f.values()) + [rid])
        self.db.commit()

    def repair(self, rid: int) -> Optional[dict]:
        r = self.db.execute("SELECT * FROM repairs WHERE id=?", (rid,)).fetchone()
        return self._repair_row(r) if r else None

    def repairs(self, limit: int = 100, status: Optional[str] = None) -> List[dict]:
        q, a = "SELECT * FROM repairs", []
        if status:
            q += " WHERE status=?"
            a.append(status)
        q += " ORDER BY id DESC LIMIT ?"
        a.append(limit)
        return [self._repair_row(r) for r in self.db.execute(q, a)]

    @staticmethod
    def _repair_row(r) -> dict:
        d = dict(r)
        try:
            d["tests"] = json.loads(d["tests"] or "{}")
        except ValueError:
            d["tests"] = {}
        return d

    def failed_before(self, rule: str, file: str, before_sha: str, strategy: str) -> bool:
        """Has this exact strategy already failed on this exact file content? (never repeat blindly)"""
        r = self.db.execute(
            "SELECT 1 FROM repairs WHERE rule=? AND file=? AND before_sha=? AND strategy=? "
            "AND status IN ('ROLLED BACK','REJECTED BY TESTS') LIMIT 1", (rule, file, before_sha, strategy)).fetchone()
        return bool(r)

    # ---- events / kv ----------------------------------------------------------------------- #
    def event(self, kind: str, message: str, data: Any = None) -> None:
        self.db.execute("INSERT INTO events(ts, kind, message, data) VALUES(?,?,?,?)",
                        (self._now(), kind, message, json.dumps(data) if data is not None else ""))
        self.db.commit()

    def events(self, limit: int = 50) -> List[dict]:
        return [dict(r) for r in self.db.execute("SELECT ts, kind, message FROM events ORDER BY id DESC LIMIT ?", (limit,))]

    def kv_set(self, k: str, v: Any) -> None:
        self.db.execute("INSERT OR REPLACE INTO kv(k, v) VALUES(?,?)", (k, json.dumps(v)))
        self.db.commit()

    def kv_get(self, k: str, default=None):
        r = self.db.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
        return json.loads(r["v"]) if r else default

    def close(self) -> None:
        self.db.close()
