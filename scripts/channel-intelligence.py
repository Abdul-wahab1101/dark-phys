#!/usr/bin/env python3
"""Dark Phys channel-intelligence CLI."""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AGENT_DIR = ROOT / "agents" / "channel-intelligence"
sys.path.insert(0, str(AGENT_DIR))
from core import ChannelIntelligence
from analysis import semantic_similarity, competitor_gap
from research import collect_research, google_trends, gdelt_news, reddit_public_rss, youtube_search

def emit(value):
    print(json.dumps(value, ensure_ascii=False, indent=2))

def main():
    parser = argparse.ArgumentParser(description="Dark Phys Phase 1 channel intelligence")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("channels", help="List configured channel profiles")
    add = sub.add_parser("add-topic", help="Save a topic candidate")
    add.add_argument("--channel", required=True); add.add_argument("--title", required=True)
    add.add_argument("--core-topic", default=""); add.add_argument("--language", default=None)
    add.add_argument("--factors", help="JSON object with 0..5 ratings")
    dup = sub.add_parser("check-duplicate", help="Check a topic against channel history")
    dup.add_argument("--channel", required=True); dup.add_argument("--title", required=True)
    dup.add_argument("--core-topic", default=""); dup.add_argument("--script-file")
    get = sub.add_parser("show-topic", help="Show a topic and its evidence")
    get.add_argument("id", type=int)
    research = sub.add_parser("research", help="Collect public topic signals from enabled providers")
    research.add_argument("--query", required=True); research.add_argument("--region", default="US")
    research.add_argument("--language", default="en"); research.add_argument("--no-reddit", action="store_true")
    trends = sub.add_parser("trends", help="Read Google Trends public trending RSS")
    trends.add_argument("--query", default=""); trends.add_argument("--region", default="US")
    news = sub.add_parser("news", help="Search GDELT public news index")
    news.add_argument("--query", required=True)
    reddit = sub.add_parser("reddit", help="Read public Reddit search RSS (best effort)")
    reddit.add_argument("--query", required=True)
    yt = sub.add_parser("youtube-search", help="Search official YouTube Data API")
    yt.add_argument("--query", required=True); yt.add_argument("--region", default="US"); yt.add_argument("--language", default="en")
    gap = sub.add_parser("competitor-gap", help="Analyze a public video metadata sample JSON file")
    gap.add_argument("--query", required=True); gap.add_argument("--videos-json", required=True)
    sim = sub.add_parser("similarity", help="Compare two text samples for near-duplicate risk")
    sim.add_argument("--first", required=True); sim.add_argument("--second", required=True)
    args = parser.parse_args()
    intel = ChannelIntelligence()
    if args.command == "channels":
        emit(intel.list_channels())
    elif args.command == "add-topic":
        factors = json.loads(args.factors) if args.factors else None
        topic_id = intel.add_topic(args.channel, args.title, args.core_topic, args.language, factors)
        emit({"id":topic_id,"topic":intel.get_topic(topic_id)})
    elif args.command == "check-duplicate":
        script = Path(args.script_file).read_text(encoding="utf-8") if args.script_file else ""
        matches = intel.find_duplicates(args.channel,args.title,args.core_topic,script)
        emit({"duplicate":bool(matches),"matches":matches})
        if matches: raise SystemExit(2)
    elif args.command == "show-topic":
        emit(intel.get_topic(args.id))
    elif args.command == "research":
        emit(collect_research(args.query,args.region,args.language,not args.no_reddit))
    elif args.command == "trends":
        emit(google_trends(args.query,args.region))
    elif args.command == "news":
        emit(gdelt_news(args.query))
    elif args.command == "reddit":
        emit(reddit_public_rss(args.query))
    elif args.command == "youtube-search":
        emit(youtube_search(args.query,args.region,args.language))
    elif args.command == "competitor-gap":
        videos=json.loads(Path(args.videos_json).read_text(encoding="utf-8"))
        emit(competitor_gap(args.query,videos))
    elif args.command == "similarity":
        emit(semantic_similarity(args.first,args.second))

if __name__ == "__main__":
    main()
