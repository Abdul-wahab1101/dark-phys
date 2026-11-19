"""Channel-safe content gap and stronger near-duplicate analysis."""
from __future__ import annotations
import re
from collections import Counter
from .core import normalize_text, similarity_report

STOP = set("""the and for with from that this what when where why how your you are was were have has had into about after before their them they then than can could would should will just very more most some such also only not but our out all its his her she him who whom""".split())
UR_STOP = set("""hai hain tha thi thay aur ke ki ka ko se mein main par per ye yeh woh wo kya kyun kese kaise kab kahan agar magar aik ek is us in un apna apni apne hota hoti hotay karne karna kar ke liye""".split())

def _terms(text):
    return {t for t in normalize_text(text).split() if len(t)>2 and t not in STOP and t not in UR_STOP}

def _ngrams(text, n=3):
    words=normalize_text(text).split()
    return {" ".join(words[i:i+n]) for i in range(max(0,len(words)-n+1))}

def semantic_similarity(a,b):
    """Deterministic lexical semantic proxy; no embedding model/API or network call."""
    ta,tb=_terms(a),_terms(b)
    union=ta|tb
    jaccard=len(ta&tb)/max(1,len(union))
    ga,gb=_ngrams(a),_ngrams(b)
    ng=len(ga&gb)/max(1,len(ga|gb))
    base=similarity_report(a,b)["ratio"]
    score=0.45*jaccard+0.35*ng+0.20*base
    return {"score":round(score,4),"token_jaccard":round(jaccard,4),"trigram_jaccard":round(ng,4),
            "sequence_ratio":round(base,4),"possible_duplicate":score>=0.58 or base>=0.88,
            "method":"deterministic lexical similarity; not an embedding model"}

def competitor_gap(query, videos, max_examples=8):
    """Find under-covered query subtopics in public video metadata.

    Input is a list of public video title/description records from the official API
    or user-supplied observations. This does not rank or score channels.
    """
    qterms=_terms(query)
    if not qterms: return {"query":query,"coverage":"insufficient","gaps":[],"videos_reviewed":len(videos)}
    covered=Counter()
    examples=[]
    for video in videos:
        text=(video.get("title","")+" "+video.get("description",""))[:4000]
        terms=_terms(text)
        covered.update(terms & qterms)
        if terms & qterms:
            examples.append({"title":video.get("title",""),"url":video.get("url",""),"matched_terms":sorted(terms&qterms)})
    gaps=[{"term":t,"observed_mentions":covered[t]} for t in sorted(qterms,key=lambda x:(covered[x],x))]
    return {"query":query,"videos_reviewed":len(videos),"coverage":"limited_public_metadata_sample" if videos else "no_data",
      "undercovered_terms":[x for x in gaps if x["observed_mentions"]==0],
      "term_coverage":gaps,"sample_examples":examples[:max_examples],
      "caveat":"A search-result sample is not the whole niche. Absence in titles/descriptions does not prove no creator covers a subject. No competitor channel rankings or performance estimates."}
