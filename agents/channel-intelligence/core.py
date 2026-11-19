"""Channel profiles, evidence-backed topic scoring and duplicate prevention.

Uses only the Python standard library. No external service is called implicitly.
Topic scores are editorial decision aids, never predictions of views or virality.
YouTube API-derived data is deliberately kept separate from external research.
"""
from __future__ import annotations

import difflib
import hashlib
import json
import re
import sqlite3
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB = ROOT / "data" / "channel-intelligence.sqlite3"
DEFAULT_PROFILES = ROOT / "config" / "channel-profiles.json"
SCORING_VERSION = "1.0.0"
FACTOR_WEIGHTS = {
    "audience_demand": 20,
    "problem_value": 20,
    "curiosity_hook": 15,
    "competition_gap": 15,
    "visual_potential": 10,
    "evergreen_value": 10,
    "evidence_confidence": 10,
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", str(value or "")).casefold()
    value = re.sub(r"https?://\S+", " ", value)
    value = re.sub(r"[^\w\s]", " ", value, flags=re.UNICODE)
    return re.sub(r"\s+", " ", value).strip()


def token_set(value: str) -> set[str]:
    return {t for t in normalize_text(value).split() if len(t) > 1}


def similarity_report(candidate: str, existing: str) -> dict[str, Any]:
    a, b = normalize_text(candidate), normalize_text(existing)
    if not a or not b:
        return {"ratio": 0.0, "token_overlap": 0.0, "duplicate": False}
    ratio = difflib.SequenceMatcher(None, a, b).ratio()
    ta, tb = token_set(a), token_set(b)
    overlap = len(ta & tb) / max(1, len(ta | tb))
    # Conservative guard: high phrase similarity OR strong token overlap.
    duplicate = ratio >= 0.88 or (overlap >= 0.82 and min(len(ta), len(tb)) >= 4)
    return {"ratio": round(ratio, 4), "token_overlap": round(overlap, 4), "duplicate": duplicate}


def score_topic(factors: dict[str, Any]) -> dict[str, Any]:
    """Score manually/researcher-rated 0..5 factors; missing inputs remain unscored."""
    normalized: dict[str, float] = {}
    for key, weight in FACTOR_WEIGHTS.items():
        raw = factors.get(key)
        if raw is None:
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            raise ValueError(f"{key} must be a number from 0 to 5")
        if not 0 <= value <= 5:
            raise ValueError(f"{key} must be between 0 and 5")
        normalized[key] = value
    if not normalized:
        raise ValueError("At least one scoring factor is required")
    available_weight = sum(FACTOR_WEIGHTS[k] for k in normalized)
    weighted = sum((normalized[k] / 5) * FACTOR_WEIGHTS[k] for k in normalized)
    score = round(weighted / available_weight * 100, 1)
    confidence = round(available_weight, 1)
    if confidence < 60:
        label = "INSUFFICIENT_EVIDENCE"
    elif score >= 80:
        label = "STRONG_CANDIDATE"
    elif score >= 65:
        label = "PROMISING"
    elif score >= 50:
        label = "NEEDS_ANGLE"
    else:
        label = "LOW_PRIORITY"
    return {
        "score": score, "coverage": confidence, "label": label,
        "scoring_version": SCORING_VERSION,
        "factor_weights": FACTOR_WEIGHTS.copy(),
        "factor_scores": normalized,
        "disclaimer": "Editorial prioritization only; not a view, CTR, revenue or virality prediction.",
    }


class ChannelIntelligence:
    def __init__(self, db_path: str | Path = DEFAULT_DB, profiles_path: str | Path = DEFAULT_PROFILES):
        self.db_path = Path(db_path)
        self.profiles_path = Path(profiles_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.profiles_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()
        if not self.profiles_path.exists():
            self._write_default_profiles()

    def _connect(self):
        db = sqlite3.connect(self.db_path, timeout=20)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        return db

    def _init_db(self):
        with self._connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
            CREATE TABLE IF NOT EXISTS topics (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              channel_id TEXT NOT NULL,
              title TEXT NOT NULL,
              normalized_title TEXT NOT NULL,
              core_topic TEXT NOT NULL,
              language TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'candidate',
              score_json TEXT,
              research_json TEXT NOT NULL DEFAULT '{}',
              script_hash TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_topics_channel ON topics(channel_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_topics_hash ON topics(script_hash);
            CREATE TABLE IF NOT EXISTS research_evidence (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
              source_type TEXT NOT NULL,
              source_url TEXT NOT NULL,
              observed_at TEXT NOT NULL,
              note TEXT NOT NULL,
              freshness_days INTEGER,
              FOREIGN KEY(topic_id) REFERENCES topics(id)
            );
            CREATE INDEX IF NOT EXISTS idx_evidence_topic ON research_evidence(topic_id);
            """)
    
    def _write_default_profiles(self):
        profiles = {
          "schema_version": 1,
          "channels": [
            {"id":"dark-phys-en","name":"Dark Phys","language":"en","locale":"en-US","region":"US","niche":"Dark Psychology & Human Behavior","audience":"English-speaking viewers interested in psychology, behavior, relationships and practical self-protection","voice":"Natural, clear international English","enabled":True,"content_pillars":["psychology explained","manipulation and defense","behavioral science","real-world case studies"],"style":{"format":"cinematic documentary explainer","spelling":"US English","examples":"globally understandable"}},
            {"id":"dark-phys-ur","name":"Dark Phys Urdu","language":"ur-Latn","locale":"ur-PK","region":"PK","niche":"Dark Psychology & Human Behavior","audience":"Roman Urdu-speaking viewers in Pakistan and diaspora seeking practical, understandable psychology","voice":"Natural Pakistani Roman Urdu; not literal English translation","enabled":True,"content_pillars":["psychology asaan alfaaz mein","manipulation ko samajhna aur bachao","insani rawaiye","real-life misaalein"],"style":{"format":"cinematic documentary explainer","spelling":"consistent Roman Urdu","examples":"Pakistan-relevant where useful"}}
          ]
        }
        self.profiles_path.write_text(json.dumps(profiles, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def list_channels(self) -> list[dict[str, Any]]:
        data = json.loads(self.profiles_path.read_text(encoding="utf-8"))
        return data.get("channels", [])

    def get_channel(self, channel_id: str) -> dict[str, Any]:
        for channel in self.list_channels():
            if channel["id"] == channel_id:
                return channel
        raise KeyError(f"Unknown channel: {channel_id}")

    def save_channel(self, profile: dict[str, Any]) -> None:
        required = ("id", "name", "language", "locale", "region", "niche", "audience")
        if any(not str(profile.get(k, "")).strip() for k in required):
            raise ValueError("Channel profile missing required fields: " + ", ".join(required))
        data = json.loads(self.profiles_path.read_text(encoding="utf-8"))
        channels = data.setdefault("channels", [])
        for i, current in enumerate(channels):
            if current["id"] == profile["id"]:
                channels[i] = profile
                break
        else:
            channels.append(profile)
        data["channels"] = channels
        self.profiles_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def add_topic(self, channel_id: str, title: str, core_topic: str = "", language: str | None = None,
                  factors: dict[str, Any] | None = None, research: dict[str, Any] | None = None,
                  status: str = "candidate") -> int:
        channel = self.get_channel(channel_id)
        if not title.strip():
            raise ValueError("Topic title cannot be empty")
        score = score_topic(factors or {}) if factors else None
        now = utc_now()
        with self._connect() as db:
            cur = db.execute("""INSERT INTO topics
              (channel_id,title,normalized_title,core_topic,language,status,score_json,research_json,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)""",
              (channel_id, title.strip(), normalize_text(title), core_topic.strip() or title.strip(),
               language or channel["language"], status, json.dumps(score) if score else None,
               json.dumps(research or {}, ensure_ascii=False), now, now))
            return int(cur.lastrowid)

    def find_duplicates(self, channel_id: str, title: str, core_topic: str = "", script: str = "",
                        threshold: float = 0.88) -> list[dict[str, Any]]:
        candidate = core_topic or title
        script_hash = hashlib.sha256(normalize_text(script).encode("utf-8")).hexdigest() if script.strip() else None
        with self._connect() as db:
            rows = db.execute("SELECT * FROM topics WHERE channel_id=? ORDER BY created_at DESC", (channel_id,)).fetchall()
        found = []
        for row in rows:
            title_match = similarity_report(title, row["title"])
            topic_match = similarity_report(candidate, row["core_topic"])
            exact_script = bool(script_hash and row["script_hash"] and script_hash == row["script_hash"])
            if exact_script or title_match["ratio"] >= threshold or topic_match["ratio"] >= threshold or title_match["duplicate"] or topic_match["duplicate"]:
                found.append({"id":row["id"],"title":row["title"],"status":row["status"],
                              "title_similarity":title_match["ratio"],"topic_similarity":topic_match["ratio"],
                              "exact_script_match":exact_script})
        return found

    def set_script(self, topic_id: int, script: str) -> str:
        normalized = normalize_text(script)
        if len(normalized) < 80:
            raise ValueError("Script fingerprint requires at least 80 normalized characters")
        digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
        with self._connect() as db:
            db.execute("UPDATE topics SET script_hash=?,updated_at=? WHERE id=?", (digest, utc_now(), topic_id))
            if db.total_changes == 0:
                raise KeyError(f"Unknown topic id: {topic_id}")
        return digest

    def add_evidence(self, topic_id: int, source_type: str, source_url: str, note: str,
                     freshness_days: int | None = None, observed_at: str | None = None) -> int:
        if source_type not in {"youtube_search","google_trends","reddit","news","academic","official","manual","other"}:
            raise ValueError("Unsupported source_type")
        if not source_url.startswith(("https://", "http://")):
            raise ValueError("Evidence must include an http(s) source URL")
        with self._connect() as db:
            cur = db.execute("""INSERT INTO research_evidence
              (topic_id,source_type,source_url,observed_at,note,freshness_days)
              VALUES (?,?,?,?,?,?)""",
              (topic_id,source_type,source_url,observed_at or utc_now(),note,freshness_days))
            return int(cur.lastrowid)

    def get_topic(self, topic_id: int) -> dict[str, Any]:
        with self._connect() as db:
            row = db.execute("SELECT * FROM topics WHERE id=?", (topic_id,)).fetchone()
            if not row:
                raise KeyError(f"Unknown topic id: {topic_id}")
            evidence = db.execute("SELECT * FROM research_evidence WHERE topic_id=? ORDER BY observed_at DESC", (topic_id,)).fetchall()
        result = dict(row)
        result["score"] = json.loads(result.pop("score_json")) if result["score_json"] else None
        result["research"] = json.loads(result.pop("research_json"))
        result["evidence"] = [dict(x) for x in evidence]
        return result
