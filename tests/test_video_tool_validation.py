import tempfile
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from effects import Effects
from keyframes import Comp, render


class ExistingVideoToolValidationTests(unittest.TestCase):
    def test_effects_reject_odd_frame_size(self):
        with self.assertRaisesRegex(ValueError, "even integers"):
            Effects(641, 360)

    def test_effects_reject_invalid_fps(self):
        with self.assertRaisesRegex(ValueError, "fps"):
            Effects(640, 360, 0)

    def test_effects_accept_yuv420p_safe_profile(self):
        fx = Effects(320, 180, 30)
        self.assertEqual((fx.w, fx.h, fx.fps), (320, 180, 30))

    def test_keyframes_reject_odd_design_size(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaisesRegex(ValueError, "design width and height"):
                Comp({"width": 641, "height": 360, "duration": 1, "layers": []}, Path(td))

    def test_keyframes_reject_invalid_duration(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaisesRegex(ValueError, "duration"):
                Comp({"width": 640, "height": 360, "duration": 0, "layers": []}, Path(td))

    def test_keyframes_reject_invalid_fps(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaisesRegex(ValueError, "fps"):
                Comp({"width": 640, "height": 360, "fps": 0, "duration": 1, "layers": []}, Path(td))

    def test_keyframes_reject_non_list_layers(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaisesRegex(ValueError, "layers"):
                Comp({"width": 640, "height": 360, "duration": 1, "layers": {}}, Path(td))

    def test_render_rejects_unknown_quality_before_render(self):
        with self.assertRaisesRegex(ValueError, "unknown quality"):
            render({"width": 640, "height": 360, "duration": 1, "layers": []},
                   "unused.mp4", quality="ultra-invalid", ffmpeg="ffmpeg")


if __name__ == "__main__":
    unittest.main()
