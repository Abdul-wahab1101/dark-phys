"""Compliant public-signal research adapters for Dark Phys Phase 1.

Google Trends RSS and GDELT are keyless public feeds. Reddit RSS is best-effort.
YouTube Data API requires YOUTUBE_DATA_API_KEY. No scraping, private data or
competitor-channel scoring is performed. Responses are cached to reduce requests.
"""
from __future__ import annotations
import json, os, re, sqlite3, time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
CACHE_DB = ROOT / "data" / "research-cache.sqlite3"
UA = "DarkPhysChannelResearch/1.0 (public research; contact: project-local)"

def _db():
    CACHE_DB.parent.mkdir(parents=True, exist_ok=True)
    db=sqlite3.connect(CACHE_DB, timeout=15)
    db.execute("CREATE TABLE IF NOT EXISTS cache (cache_key TEXT PRIMARY KEY, fetched REAL NOT NULL, payload TEXT NOT NULL)")
    return db

def _cached(key, ttl):
    with _db() as db:
        row=db.execute("SELECT fetched,payload FROM cache WHERE cache_key=?",(key,)).fetchone()
    if row and time.time()-row[0] < ttl:
        return json.loads(row[1])
    return None

def _store(key, payload):
    with _db() as db:
        db.execute("INSERT OR REPLACE INTO cache VALUES (?,?,?)",(key,time.time(),json.dumps(payload,ensure_ascii=False)))

def _get(url, headers=None, timeout=15):
    req=Request(url,headers={"User-Agent":UA,**(headers or {})})
    with urlopen(req,timeout=timeout) as response:
        if response.status != 200:
            raise RuntimeError(f"Research provider returned HTTP {response.status}")
        return response.read()

def _parse_rss(raw, provider, limit=25):
    root=ET.fromstring(raw)
    results=[]
    for item in root.findall(".//item")[:limit]:
        title=(item.findtext("title") or "").strip()
        link=(item.findtext("link") or "").strip()
        desc=re.sub(r"<[^>]+>"," ",item.findtext("description") or "").strip()
        pub=item.findtext("pubDate") or ""
        try: observed=parsedate_to_datetime(pub).astimezone(timezone.utc).isoformat()
        except Exception: observed=datetime.now(timezone.utc).isoformat()
        if title and link:
            results.append({"provider":provider,"title":title,"url":link,"summary":desc[:1200],"observed_at":observed})
    return results

def google_trends(query, geo="US", limit=20, ttl=1800):
    key=f"trends:{geo}:{query.casefold()}"
    cached=_cached(key,ttl)
    if cached is not None: return cached
    url="https://trends.google.com/trending/rss?"+urlencode({"geo":geo})
    try:
        items=_parse_rss(_get(url,{"Accept":"application/rss+xml"}),"google_trends",limit)
        q=query.casefold()
        if q: items=[x for x in items if q in (x["title"]+" "+x["summary"]).casefold()]
        result={"provider":"google_trends","query":query,"geo":geo,"items":items,"fetched_at":datetime.now(timezone.utc).isoformat(),"status":"ok"}
    except Exception as exc:
        result={"provider":"google_trends","query":query,"geo":geo,"items":[],"status":"unavailable","error":str(exc)}
    _store(key,result); return result

def gdelt_news(query, max_records=25, ttl=900):
    key=f"gdelt:{query.casefold()}:{max_records}"
    cached=_cached(key,ttl)
    if cached is not None: return cached
    params={"query":query,"mode":"ArtList","format":"json","maxrecords":min(max(1,int(max_records)),250),"sort":"HybridRel"}
    try:
        payload=json.loads(_get("https://api.gdeltproject.org/api/v2/doc/doc?"+urlencode(params)))
        items=[]
        for x in payload.get("articles",[]):
            items.append({"provider":"gdelt","title":x.get("title",""),"url":x.get("url",""),
              "source":x.get("domain",""),"language":x.get("language",""),"observed_at":x.get("seendate","")})
        result={"provider":"gdelt","query":query,"items":items,"status":"ok","fetched_at":datetime.now(timezone.utc).isoformat()}
    except Exception as exc:
        result={"provider":"gdelt","query":query,"items":[],"status":"unavailable","error":str(exc)}
    _store(key,result); return result

def reddit_public_rss(query, limit=20, ttl=900):
    key=f"reddit-rss:{query.casefold()}:{limit}"
    cached=_cached(key,ttl)
    if cached is not None: return cached
    url="https://www.reddit.com/search.rss?"+urlencode({"q":query,"sort":"relevance","t":"month","limit":min(max(1,int(limit)),25)})
    try:
        root=ET.fromstring(_get(url,{"Accept":"application/atom+xml"}))
        ns={"a":"http://www.w3.org/2005/Atom"}
        items=[]
        for entry in root.findall("a:entry",ns):
            title=(entry.findtext("a:title",default="",namespaces=ns)).strip()
            link=entry.find("a:link",ns)
            author=entry.findtext("a:author/a:name",default="",namespaces=ns)
            href=link.attrib.get("href","") if link is not None else ""
            updated=entry.findtext("a:updated",default="",namespaces=ns)
            if title and href: items.append({"provider":"reddit_rss","title":title,"url":href,"author":author,"observed_at":updated})
        result={"provider":"reddit_rss","query":query,"items":items,"status":"ok","fetched_at":datetime.now(timezone.utc).isoformat()}
    except Exception as exc:
        result={"provider":"reddit_rss","query":query,"items":[],"status":"unavailable","error":str(exc)}
    _store(key,result); return result

def youtube_search(query, region="US", language="en", max_results=10, ttl=3600):
    """Official YouTube Data API search; return public video metadata only."""
    api_key=os.getenv("YOUTUBE_DATA_API_KEY","").strip()
    if not api_key:
        return {"provider":"youtube_data_api","query":query,"items":[],"status":"needs_api_key",
                "required_env":"YOUTUBE_DATA_API_KEY"}
    key=f"youtube-search:{region}:{language}:{query.casefold()}:{max_results}"
    cached=_cached(key,ttl)
    if cached is not None: return cached
    params={"part":"snippet","type":"video","q":query,"regionCode":region,"relevanceLanguage":language,
            "maxResults":min(max(1,int(max_results)),25),"key":api_key}
    try:
        payload=json.loads(_get("https://www.googleapis.com/youtube/v3/search?"+urlencode(params)))
        items=[]
        for x in payload.get("items",[]):
            sn=x.get("snippet",{}); vid=x.get("id",{}).get("videoId")
            if vid:
                items.append({"provider":"youtube_data_api","video_id":vid,"title":sn.get("title",""),
                  "description":sn.get("description","")[:3000],"channel_title":sn.get("channelTitle",""),
                  "published_at":sn.get("publishedAt",""),"url":f"https://www.youtube.com/watch?v={vid}"})
        result={"provider":"youtube_data_api","query":query,"items":items,"status":"ok",
                "fetched_at":datetime.now(timezone.utc).isoformat(),"api_data_policy":"Display as YouTube API data; do not combine with external datasets or create channel rankings."}
    except Exception as exc:
        result={"provider":"youtube_data_api","query":query,"items":[],"status":"unavailable","error":str(exc)}
    _store(key,result); return result

def collect_research(query, region="US", language="en", include_reddit=True):
    """Fetch independent public signals; provider failures do not hide other results."""
    result={
      "google_trends":google_trends(query,geo=region),
      "news":gdelt_news(query),
      "reddit":reddit_public_rss(query) if include_reddit else {"status":"skipped","items":[]},
      "youtube":youtube_search(query,region=region,language=language),
    }
    result["provider_status"]={k:v.get("status") for k,v in result.items() if isinstance(v,dict)}
    return result
