"""Continuous Health Monitoring: polling file watcher with resource limits and an honest heartbeat."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Dict, Optional, Tuple

from .config import IGNORED_DIRS, LANG_BY_EXT


def snapshot(root: Path, max_files: int = 5000) -> Dict[str, Tuple[float, int]]:
    snap: Dict[str, Tuple[float, int]] = {}
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d not in IGNORED_DIRS]
        for f in fn:
            p = Path(dp) / f
            if p.suffix.lower() in LANG_BY_EXT or p.suffix.lower() in (".json", ".yml", ".yaml", ".toml") or f == "requirements.txt":
                try:
                    st = p.stat()
                    snap[p.relative_to(root).as_posix()] = (st.st_mtime, st.st_size)
                except OSError:
                    pass
            if len(snap) >= max_files:
                return snap
    return snap


def _pid_alive(pid: int) -> bool:
    if os.name == "nt":                        # os.kill(pid, 0) would TERMINATE the process on Windows - never use it there
        try:
            import ctypes
            h = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
            if h:
                ctypes.windll.kernel32.CloseHandle(h)
                return True
            return False
        except Exception:
            return True
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def monitor_status(data_dir: Path) -> dict:
    """Monitoring counts as ACTIVE only if a fresh heartbeat exists AND its process is alive."""
    p = Path(data_dir) / "monitor.json"
    if not p.exists():
        return {"active": False, "reason": "monitor was never started"}
    try:
        hb = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"active": False, "reason": "unreadable heartbeat"}
    age = time.time() - hb.get("last_beat", 0)
    fresh = age < max(5.0, 3 * hb.get("interval", 30))
    alive = _pid_alive(int(hb.get("pid", 0))) if hb.get("pid") else False
    if hb.get("stopped"):
        return dict(hb, active=False, reason="monitor was stopped")
    active = fresh and alive
    return dict(hb, active=active, age_seconds=round(age, 1), reason="running" if active else ("stale heartbeat" if not fresh else "process not running"))


class Monitor:
    def __init__(self, doctor, interval: Optional[float] = None, schedule_minutes: float = 60, scan_budget_s: float = 120):
        self.d = doctor
        self.interval = float(interval if interval is not None else doctor.settings.get("monitor_interval"))
        self.schedule = schedule_minutes * 60
        self.budget = scan_budget_s
        self.hb_path = doctor.data_dir / "monitor.json"
        self.stop_file = doctor.data_dir / "monitor.stop"
        self.cycles = 0
        self.scans = 0

    def _beat(self, **extra) -> None:
        hb = {"pid": os.getpid(), "interval": self.interval, "last_beat": time.time(), "cycles": self.cycles, "scans": self.scans,
              "started": getattr(self, "_started", time.time()), "stopped": False}
        hb.update(extra)
        tmp = self.hb_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(hb), encoding="utf-8")
        os.replace(tmp, self.hb_path)

    def run(self, max_cycles: Optional[int] = None, on_scan=None) -> dict:
        self._started = time.time()
        self.stop_file.unlink(missing_ok=True)
        prev = snapshot(self.d.root, int(self.d.settings.get("max_files")))
        last_full = 0.0
        self._beat(note="started")
        self.d.kb.event("monitor", f"monitoring started (interval {self.interval}s)")
        reason = "max cycles reached"
        try:
            return self._loop(max_cycles, on_scan, prev, last_full, reason)
        except Exception as e:                                                  # noqa - report the crash honestly
            self._beat(stopped=True, reason=f"monitor crashed: {type(e).__name__}: {e}")
            self.d.kb.event("monitor", f"monitoring CRASHED: {type(e).__name__}: {e}")
            raise

    def _loop(self, max_cycles, on_scan, prev, last_full, reason) -> dict:
        while max_cycles is None or self.cycles < max_cycles:
            if self.stop_file.exists():
                reason = "stop requested"
                break
            time.sleep(self.interval)
            self.cycles += 1
            cur = snapshot(self.d.root, int(self.d.settings.get("max_files")))
            changed = sorted({k for k in set(prev) | set(cur) if prev.get(k) != cur.get(k)})
            due = time.time() - last_full >= self.schedule
            if changed or due:
                t0 = time.time()
                summary = self.d.scan(run_tests_flag=True, runtime_checks=False)
                self.scans += 1
                last_full = time.time()
                trig = f"{len(changed)} file(s) changed" if changed else "scheduled scan"
                self.d.kb.event("monitor", f"{trig}: scan -> health {summary['health']} ({summary['label']}) in {time.time() - t0:.1f}s",
                                {"changed": changed[:20]})
                if time.time() - t0 > self.budget:
                    self.d.kb.event("monitor", f"scan took longer than the {self.budget}s budget - consider a larger interval")
                if on_scan:
                    on_scan(changed, summary)
                prev = cur
            self._beat(last_change=changed[:10] if changed else None)
        self._beat(stopped=True, reason=reason)
        self.d.kb.event("monitor", f"monitoring stopped ({reason})")
        return {"cycles": self.cycles, "scans": self.scans, "reason": reason}


def preflight(doctor) -> dict:
    """Pre-deployment gate: scan + tests + critical vulnerabilities -> GO / NO-GO with reasons."""
    s = doctor.scan(run_tests_flag=True, runtime_checks=True)
    reasons = []
    open_ = [f for f in doctor.findings if f.status not in ("FIXED", "VERIFIED")]
    t = doctor.last_tests
    if t and t.ran and (t.failed or t.errors):
        reasons.append(f"{t.failed + t.errors} failing test(s)")
    if t and not t.ran:
        reasons.append("tests could not be run - cannot verify")
    crit = [f for f in open_ if f.severity == "critical" and f.classification == "confirmed"]
    if crit:
        reasons.append(f"{len(crit)} confirmed critical finding(s)")
    vul = [f for f in open_ if f.category == "security" and f.severity in ("critical", "high") and f.classification == "confirmed"]
    if vul:
        reasons.append(f"{len(vul)} confirmed high/critical vulnerability(ies)")
    return {"verdict": "NO-GO" if reasons else "GO", "reasons": reasons, "health": s["health"], "label": s["label"]}


def http_check(url: str, expect: int = 200, timeout: float = 10.0) -> dict:
    """Post-deployment verification of a URL you explicitly provide (read-only GET)."""
    import urllib.error
    import urllib.request
    t0 = time.time()
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            code = r.status
    except urllib.error.HTTPError as e:
        code = e.code
    except Exception as e:                       # noqa
        return {"ok": False, "error": f"{type(e).__name__}: {e}", "url": url}
    return {"ok": code == expect, "status": code, "seconds": round(time.time() - t0, 3), "url": url}
