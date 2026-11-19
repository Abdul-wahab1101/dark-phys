"""Recovery & Rollback helpers: bounded retries, circuit breaker, timeouts, checkpoints, guarded engines."""
from __future__ import annotations

import json
import os
import subprocess
import time
import traceback
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional


class CircuitOpen(Exception):
    pass


class CircuitBreaker:
    """closed -> (N failures) -> open -> (cooldown) -> half-open -> (success) -> closed"""

    def __init__(self, max_failures: int = 3, cooldown: float = 30.0, clock: Callable[[], float] = time.monotonic):
        self.max_failures, self.cooldown, self.clock = max_failures, cooldown, clock
        self.failures, self.opened_at = 0, None

    @property
    def state(self) -> str:
        if self.opened_at is None:
            return "closed"
        return "half-open" if self.clock() - self.opened_at >= self.cooldown else "open"

    def call(self, fn: Callable, *a, **kw):
        if self.state == "open":
            raise CircuitOpen(f"circuit open after {self.failures} failures; retry in {self.cooldown - (self.clock() - self.opened_at):.0f}s")
        try:
            r = fn(*a, **kw)
        except Exception:
            self.failures += 1
            if self.failures >= self.max_failures or self.state == "half-open":
                self.opened_at = self.clock()
            raise
        self.failures, self.opened_at = 0, None
        return r


def retry(fn: Callable, attempts: int = 3, base_delay: float = 0.5, max_delay: float = 8.0, retry_on=(Exception,), sleep=time.sleep):
    """Bounded exponential backoff. Never retries forever. Returns (result, attempts_used)."""
    last: Optional[BaseException] = None
    for i in range(1, attempts + 1):
        try:
            return fn(), i
        except retry_on as e:                           # noqa
            last = e
            if i < attempts:
                sleep(min(max_delay, base_delay * 2 ** (i - 1)))
    raise RuntimeError(f"failed after {attempts} attempts: {last}") from last


def run_with_timeout(cmd: List[str], timeout: float, cwd: Optional[str] = None, env: Optional[dict] = None) -> Dict[str, Any]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd, env=env, errors="replace")
        return {"ok": p.returncode == 0, "returncode": p.returncode, "stdout": p.stdout[-2000:], "stderr": p.stderr[-2000:], "timeout": False}
    except subprocess.TimeoutExpired:
        return {"ok": False, "returncode": None, "stdout": "", "stderr": "", "timeout": True}
    except OSError as e:
        return {"ok": False, "returncode": None, "stdout": "", "stderr": str(e), "timeout": False}


class Checkpoints:
    """Tiny JSON checkpoint store so long operations can resume / be rolled back to a known state."""

    def __init__(self, directory: Path):
        self.dir = Path(directory)
        self.dir.mkdir(parents=True, exist_ok=True)

    def save(self, name: str, state: dict) -> Path:
        tmp = self.dir / f".{name}.tmp"
        tmp.write_text(json.dumps(state, indent=1, default=str), encoding="utf-8")
        final = self.dir / f"{name}.json"
        os.replace(tmp, final)
        return final

    def load(self, name: str) -> Optional[dict]:
        p = self.dir / f"{name}.json"
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


class ServiceRestarter:
    """Controlled restarts of a service Doctor was told to supervise: at most `max_restarts` per window."""

    def __init__(self, start_cmd: List[str], max_restarts: int = 3, window: float = 300.0, clock=time.monotonic):
        self.start_cmd, self.max_restarts, self.window, self.clock = start_cmd, max_restarts, window, clock
        self.history: List[float] = []
        self.proc: Optional[subprocess.Popen] = None

    def can_restart(self) -> bool:
        now = self.clock()
        self.history = [t for t in self.history if now - t < self.window]
        return len(self.history) < self.max_restarts

    def start(self) -> bool:
        if not self.can_restart():
            return False
        self.history.append(self.clock())
        self.proc = subprocess.Popen(self.start_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True

    def alive(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def stop(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(5)
            except subprocess.TimeoutExpired:
                self.proc.kill()


class GuardedEngine:
    """Wraps a Doctor engine so one failing engine degrades gracefully and is recorded instead of crashing everything."""

    def __init__(self, name: str, fn: Callable, breaker: Optional[CircuitBreaker] = None):
        self.name, self.fn = name, fn
        self.breaker = breaker or CircuitBreaker(3, 60)
        self.history: List[dict] = []

    def __call__(self, *a, default=None, **kw):
        try:
            return self.breaker.call(self.fn, *a, **kw)
        except CircuitOpen as e:
            self.history.append({"ts": time.strftime("%H:%M:%S"), "engine": self.name, "error": str(e), "degraded": True})
        except Exception as e:                           # noqa
            self.history.append({"ts": time.strftime("%H:%M:%S"), "engine": self.name, "error": f"{type(e).__name__}: {e}",
                                 "trace": traceback.format_exc()[-800:], "degraded": True})
        return default

    @property
    def healthy(self) -> bool:
        return self.breaker.state == "closed" and not any(h.get("degraded") for h in self.history[-1:])
