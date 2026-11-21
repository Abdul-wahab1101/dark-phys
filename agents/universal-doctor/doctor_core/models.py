"""Shared data models (plain dataclasses, JSON serialisable)."""
from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


def make_id(*parts: Any) -> str:
    return hashlib.sha1("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()[:12]


@dataclass
class Finding:
    rule: str
    category: str                    # code | security | performance | agent | config | dependency | runtime | architecture | test
    severity: str                    # critical | high | medium | low | info
    classification: str              # confirmed | suspected | recommendation
    file: str
    line: int
    message: str
    confidence: float = 0.8
    end_line: int = 0
    evidence: str = ""
    root_cause: str = ""
    fix_plan: str = ""
    auto_fixable: bool = False
    risk: str = "medium"             # risk of applying the automatic fix: low | medium | high
    status: str = "OPEN"
    affected: List[str] = field(default_factory=list)
    extra: Dict[str, Any] = field(default_factory=dict)
    id: str = ""

    def __post_init__(self):
        if not self.id:
            self.id = make_id(self.rule, self.file, self.line, self.message)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Patch:
    finding_id: str
    rule: str
    strategy: str
    description: str
    files: Dict[str, List[str]]      # rel path -> [old_text, new_text]
    risk: str = "low"
    changed_lines: int = 0
    notes: str = ""


@dataclass
class TestRun:
    framework: str = "none"
    ran: bool = False
    total: int = 0
    passed: int = 0
    failed: int = 0
    errors: int = 0
    skipped: int = 0
    duration: float = 0.0
    failures: List[Dict[str, Any]] = field(default_factory=list)
    passed_ids: List[str] = field(default_factory=list)
    note: str = ""
    raw_tail: str = ""

    @property
    def ok(self) -> bool:
        return self.ran and self.failed == 0 and self.errors == 0

    def to_dict(self) -> dict:
        return asdict(self)
