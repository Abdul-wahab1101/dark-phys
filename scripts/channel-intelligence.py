#!/usr/bin/env python3
"""Dark Phys channel-intelligence CLI."""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "agents" / "channel-intelligence"))
from core import ChannelIntelligence, score_topic

def main():
    parser = argparse.ArgumentParser(description="Dark Phys Phase 1 channel intelligence")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("channels", help="List configured channel profiles")
    add = sub.add_parser("add-topic", help="Save a topic candidate")
    add.add_argument("--channel", required=True)
    add.add_argument("--title", required=True)
    add.add_argument("--core-topic", default="")
    add.add_argument("--language", default=None)
    add.add_argument("--factors", help="JSON object with 0..5 ratings")
    dup = sub.add_parser("check-duplicate", help="Check a topic against channel history")
    dup.add_argument("--channel", required=True)
    dup.add_argument("--title", required=True)
    dup.add_argument("--core-topic", default="")
    dup.add_argument("--script-file")
    get = sub.add_parser("show-topic", help="Show a topic and its evidence")
    get.add_argument("id", type=int)
    args = parser.parse_args()
    intel = ChannelIntelligence()
    if args.command == "channels":
        print(json.dumps(intel.list_channels(), ensure_ascii=False, indent=2))
    elif args.command == "add-topic":
        factors = json.loads(args.factors) if args.factors else None
        topic_id = intel.add_topic(args.channel, args.title, args.core_topic, args.language, factors)
        print(json.dumps({"id":topic_id,"topic":intel.get_topic(topic_id)}, ensure_ascii=False, indent=2))
    elif args.command == "check-duplicate":
        script = Path(args.script_file).read_text(encoding="utf-8") if args.script_file else ""
        matches = intel.find_duplicates(args.channel,args.title,args.core_topic,script)
        print(json.dumps({"duplicate":bool(matches),"matches":matches},ensure_ascii=False,indent=2))
        if matches:
            raise SystemExit(2)
    elif args.command == "show-topic":
        print(json.dumps(intel.get_topic(args.id),ensure_ascii=False,indent=2))

if __name__ == "__main__":
    main()
