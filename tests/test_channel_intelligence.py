import importlib.util
import json
import tempfile
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("channel_core", ROOT / "agents" / "channel-intelligence" / "core.py")
core = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(core)

class ChannelIntelligenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.intel = core.ChannelIntelligence(root / "test.sqlite3", root / "profiles.json")

    def tearDown(self):
        self.tmp.cleanup()

    def test_default_english_and_roman_urdu_profiles(self):
        profiles = self.intel.list_channels()
        self.assertEqual({p["language"] for p in profiles}, {"en", "ur-Latn"})
        self.assertEqual(len({p["id"] for p in profiles}), 2)

    def test_multi_channel_isolation_and_topic_persistence(self):
        topic_id = self.intel.add_topic("dark-phys-en", "Why people manipulate others", "psychological manipulation")
        self.assertEqual(self.intel.get_topic(topic_id)["channel_id"], "dark-phys-en")
        self.assertEqual(self.intel.find_duplicates("dark-phys-ur", "Why people manipulate others"), [])

    def test_score_weighting_and_incomplete_evidence(self):
        result = core.score_topic({"audience_demand":5,"problem_value":4,"curiosity_hook":4,"competition_gap":3})
        self.assertGreaterEqual(result["score"], 0)
        self.assertLessEqual(result["score"], 100)
        self.assertEqual(result["coverage"], 70)
        self.assertEqual(result["label"], "STRONG_CANDIDATE")
        self.assertEqual(core.score_topic({"audience_demand":5})["label"], "INSUFFICIENT_EVIDENCE")

    def test_invalid_score_rejected(self):
        with self.assertRaises(ValueError):
            core.score_topic({"audience_demand":6})

    def test_duplicate_title_and_core_topic_detection(self):
        self.intel.add_topic("dark-phys-en","7 Signs of Emotional Manipulation","emotional manipulation signs")
        matches = self.intel.find_duplicates("dark-phys-en","Seven Signs of Emotional Manipulation","emotional manipulation signs")
        self.assertTrue(matches)

    def test_script_fingerprint(self):
        topic_id = self.intel.add_topic("dark-phys-en","Test topic")
        script = "This is a sufficiently long example script that is used to verify the stable normalized fingerprint mechanism. " * 2
        first = self.intel.set_script(topic_id, script)
        self.assertEqual(first, self.intel.set_script(topic_id, script))
        self.assertTrue(self.intel.find_duplicates("dark-phys-en","A different title",script=script))


    def test_semantic_near_duplicate_title_detection(self):
        report = core.similarity_report(
            "Why people use emotional manipulation tactics",
            "Why people use emotional manipulation tactics in relationships"
        )
        self.assertTrue(report["duplicate"])
        self.assertIn("semantic_proxy", report)

    def test_script_near_duplicate_detection(self):
        topic_id = self.intel.add_topic("dark-phys-en", "Original script")
        original = ("People sometimes use emotional pressure to control another person's choices. "
                    "Recognizing repeated patterns helps protect healthy boundaries. " * 4)
        self.intel.set_script(topic_id, original)
        paraphrase = ("People sometimes use emotional pressure to control another person's choices. "
                      "Recognizing repeated patterns helps protect healthy boundaries in relationships. " * 4)
        matches = self.intel.find_duplicates("dark-phys-en", "A completely different title", script=paraphrase)
        self.assertTrue(matches)
        self.assertTrue(matches[0]["script_near_duplicate"])

    def test_channel_episode_and_upload_history_is_persistent_and_isolated(self):
        script = ("An original documentary episode explains a distinct question with evidence, "
                  "fresh examples, analysis and practical viewer value. " * 3)
        self.intel.record_episode("dark-phys-en", "video-en-1", "A distinct episode", script,
                                  "Why memory changes under stress", "doc-v2", "split-layout",
                                  "scene-sequence-1", [{"id": "scene-1", "assetId": "clip-a"}])
        history = self.intel.episode_history("dark-phys-en")
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["editorial_angle"], "Why memory changes under stress")
        self.assertEqual(history[0]["scenes"][0]["assetId"], "clip-a")
        self.assertEqual(self.intel.episode_history("dark-phys-ur"), [])
        self.assertTrue(self.intel.find_angle_duplicates("dark-phys-en", "Why memory changes under stress"))
        self.assertEqual(self.intel.find_angle_duplicates("dark-phys-ur", "Why memory changes under stress"), [])
        self.intel.record_upload("dark-phys-en", "video-en-1", "2026-11-21T12:00:00+00:00")
        self.assertEqual(len(self.intel.upload_history("dark-phys-en")), 1)
        self.assertEqual(self.intel.upload_history("dark-phys-ur"), [])
        with self.assertRaises(sqlite3.IntegrityError):
            self.intel.record_episode("dark-phys-en", "video-en-1", "Duplicate", script)

    def test_episode_history_rejects_short_script_and_bad_upload_time(self):
        with self.assertRaises(ValueError):
            self.intel.record_episode("dark-phys-en", "short", "Short", "too short")
        with self.assertRaises(ValueError):
            self.intel.record_upload("dark-phys-en", "bad-date", "not-a-date")

    def test_evidence_requires_source_url_and_known_type(self):
        topic_id = self.intel.add_topic("dark-phys-en","Research test")
        with self.assertRaises(ValueError):
            self.intel.add_evidence(topic_id,"manual","not-a-url","note")
        self.intel.add_evidence(topic_id,"academic","https://example.org/paper","Peer-reviewed source")
        self.assertEqual(len(self.intel.get_topic(topic_id)["evidence"]),1)

if __name__ == "__main__":
    unittest.main()
