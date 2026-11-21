import importlib.util, sys, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"agents"/"channel-intelligence"))
from analysis import semantic_similarity, competitor_gap
import research

class ChannelResearchTests(unittest.TestCase):
    def test_semantic_duplicate_proxy(self):
        same=semantic_similarity("Why people use emotional manipulation tactics","Why people use emotional manipulation tactics")
        different=semantic_similarity("emotional manipulation tactics","how volcanoes erupt")
        self.assertTrue(same["possible_duplicate"])
        self.assertLess(different["score"],same["score"])
    def test_gap_analysis_flags_uncovered_terms_without_ranking(self):
        report=competitor_gap("psychology manipulation boundaries",[
          {"title":"Psychology and manipulation","description":"How manipulation works","url":"https://youtube.com/watch?v=abc"}])
        self.assertIn("boundaries",[x["term"] for x in report["undercovered_terms"]])
        self.assertNotIn("channel_score",report)
    def test_youtube_adapter_needs_key_cleanly(self):
        import os
        old=os.environ.pop("YOUTUBE_DATA_API_KEY",None)
        try:
            result=research.youtube_search("test query")
            self.assertEqual(result["status"],"needs_api_key")
        finally:
            if old is not None: os.environ["YOUTUBE_DATA_API_KEY"]=old
    def test_gdelt_provider_failure_is_structured(self):
        # Provider wrapper catches network errors and returns a stable schema.
        original=research._get
        try:
            research._get=lambda *a,**k: (_ for _ in ()).throw(OSError("offline"))
            result=research.gdelt_news("psychology test",ttl=0)
            self.assertEqual(result["status"],"unavailable")
            self.assertEqual(result["items"],[])
        finally:
            research._get=original

if __name__=="__main__": unittest.main()
