"""Unit tests of the Doctor's building blocks.   Run:  python -m unittest discover -s tests -v"""
import ast
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from doctor_core import analysis, discovery, repair, security                      # noqa: E402
from doctor_core.backup import BackupManager, atomic_write_text, read_text_preserving  # noqa: E402
from doctor_core.knowledge import Knowledge                                        # noqa: E402
from doctor_core.models import Finding, TestRun                                    # noqa: E402
from doctor_core.testing import _parse_unittest                                    # noqa: E402


def model_of(files: dict) -> discovery.ProjectModel:
    d = Path(tempfile.mkdtemp(prefix="doctor_ut_"))
    for rel, text in files.items():
        p = d / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    return discovery.discover(d)


def findings(src: str, rel: str = "mod.py"):
    m = model_of({rel: src})
    return analysis.analyze(m), m


def fix(rule: str, src: str):
    fs, m = findings(src)
    f = next(x for x in fs if x.rule == rule)
    p = repair.make_patch(f, src)
    return f, p


class AnalysisPrecision(unittest.TestCase):
    def test_no_false_positives_on_idiomatic_code(self):
        src = ('"""doc"""\nimport os\nfrom typing import *\nimport json\n\nclass A:\n    x = 1\n    def f(self, a, *args, k=None, **kw):\n'
               '        total = [i * j for i in range(3) for j in range(2) if i]\n        with open(os.devnull) as fh:\n            data = json.load(fh)\n'
               '        try:\n            pass\n        except (KeyError, ValueError) as e:\n            print(e)\n        return total, data, args, kw, k, self.x\n')
        fs, _ = findings(src)
        self.assertEqual([f.rule for f in fs if f.severity in ("critical", "high", "medium")], [])

    def test_star_import_disables_undefined_name(self):
        fs, _ = findings("from os.path import *\nprint(join('a', 'b'))\n")
        self.assertFalse([f for f in fs if f.rule == "undefined-name"])

    def test_guarded_optional_import_is_not_reported(self):
        fs, _ = findings("try:\n    import definitely_not_installed_pkg\nexcept ImportError:\n    definitely_not_installed_pkg = None\n")
        self.assertFalse([f for f in fs if f.rule in ("missing-dependency", "broken-import")])

    def test_hardcoded_success_only_when_failure_is_impossible(self):
        bad, _ = findings('def quality_check(x):\n    return {"status": "PASS"}\n')
        good, _ = findings('def quality_check(x):\n    status = "PASS"\n    if x < 0:\n        status = "FAIL"\n    return {"status": status}\n')
        self.assertTrue([f for f in bad if f.rule == "hardcoded-success-status"])
        self.assertFalse([f for f in good if f.rule == "hardcoded-success-status"])

    def test_call_arity(self):
        fs, _ = findings("def f(a, b=1):\n    return a\n\nf()\nf(1, 2, 3)\nf(1, c=2)\nf(1)\nf(a=1, b=2)\n")
        self.assertEqual(sorted(f.line for f in fs if f.rule == "call-arity-mismatch"), [4, 5, 6])

    def test_infinite_loop_vs_worker_loop(self):
        fs, _ = findings("import time\ndef a():\n    while True:\n        x = 1\n\ndef b():\n    while True:\n        time.sleep(1)\n\ndef c():\n    while True:\n        if input():\n            break\n")
        rules = {(f.rule, f.line) for f in fs}
        self.assertIn(("infinite-loop", 3), rules)
        self.assertIn(("unbounded-loop", 7), rules)
        self.assertFalse([f for f in fs if f.line == 11 and "loop" in f.rule])


class Fixers(unittest.TestCase):
    def check(self, rule, src, expect_in, forbid=None):
        f, p = fix(rule, src)
        self.assertIsNotNone(p, f"no patch for {rule}")
        new = p.files["mod.py"][1]
        ast.parse(new)
        self.assertIn(expect_in, new)
        if forbid:
            self.assertNotIn(forbid, new)
        return new

    def test_mutable_default_with_docstring(self):
        new = self.check("mutable-default", 'def f(a, b={}):\n    """doc"""\n    b[a] = 1\n    return b\n', "b = {}")
        self.assertIn("def f(a, b=None):", new)
        self.assertLess(new.index('"""doc"""'), new.index("if b is None:"))

    def test_bare_except(self):
        self.check("bare-except", "try:\n    pass\nexcept:\n    pass\n", "except Exception:")

    def test_none_comparison(self):
        self.check("none-comparison", "x = 1\nif x == None:\n    pass\nif x != None:\n    pass\n", "x is None")

    def test_is_literal(self):
        self.check("is-literal-comparison", "x = 'a'\nif x is 'a':\n    pass\n", "x == 'a'")

    def test_missing_import_placement(self):
        new = self.check("missing-import", '"""doc"""\nfrom __future__ import annotations\n\nprint(os.getcwd())\n', "import os")
        self.assertLess(new.index("__future__"), new.index("import os"))

    def test_syntax_colon(self):
        m = model_of({"mod.py": "def f(x)\n    return x\n"})
        f = analysis.analyze(m)[0]
        p = repair.make_patch(f, m.sources["mod.py"])
        self.assertIn("def f(x):", p.files["mod.py"][1])

    def test_timeout_and_yaml(self):
        self.check("missing-timeout", "import requests\nr = requests.get('http://x')\n", "timeout=30")
        m = model_of({"mod.py": "import yaml\nd = yaml.load(open('f'))\n"})
        f = next(x for x in security.scan_security(m) if x.rule == "insecure-deserialization")
        self.assertIn("yaml.safe_load", repair.make_patch(f, m.sources["mod.py"]).files["mod.py"][1])

    def test_no_patch_for_unfixable(self):
        f, p = None, None
        fs, _ = findings('def quality_check(x):\n    return {"status": "PASS"}\n')
        f = next(x for x in fs if x.rule == "hardcoded-success-status")
        self.assertIsNone(repair.make_patch(f, "x"))

    def test_mutation_candidates_include_the_right_fix(self):
        src = "def f(age):\n    return age > 18\n"
        descs = [d for d, _, _ in repair.mutation_candidates(src, 2)]
        self.assertTrue(any(">→>=" in d for d in descs))
        for _, new, _ in repair.mutation_candidates(src, 2):
            ast.parse(new)


class FilesAndBackups(unittest.TestCase):
    def test_crlf_and_bom_preserved(self):
        d = Path(tempfile.mkdtemp())
        p = d / "a.py"
        p.write_bytes(b"\xef\xbb\xbfx = 1\r\ny = 2\r\n")
        text, nl, enc = read_text_preserving(p)
        self.assertEqual((text, nl, enc), ("x = 1\ny = 2\n", "\r\n", "utf-8-sig"))
        atomic_write_text(p, "x = 1\ny = 3\n", nl, enc)
        self.assertEqual(p.read_bytes(), b"\xef\xbb\xbfx = 1\r\ny = 3\r\n")

    def test_backup_restore_is_byte_identical_and_detects_damage(self):
        d = Path(tempfile.mkdtemp())
        (d / "a.py").write_bytes(b"print(1)\r\n")
        bm = BackupManager(d, d / "_bk")
        bid = bm.create(["a.py"], "t")
        (d / "a.py").write_bytes(b"broken")
        self.assertTrue(bm.restore(bid)["ok"])
        self.assertEqual((d / "a.py").read_bytes(), b"print(1)\r\n")
        (bm.dir / bid / "files" / "a.py").write_bytes(b"tampered")
        self.assertFalse(bm.verify(bid))
        self.assertFalse(bm.restore(bid)["ok"])


class ParsersAndMemory(unittest.TestCase):
    def test_unittest_output_parser(self):
        out = ("test_a (t.T.test_a) ... ok\ntest_b (t.T.test_b) ... FAIL\n\n" + "=" * 70 + "\nFAIL: test_b (t.T.test_b)\n" + "-" * 70 +
               '\nTraceback (most recent call last):\n  File "/p/t.py", line 5, in test_b\n    self.assertEqual(1, 2)\nAssertionError: 1 != 2\n\n' + "-" * 70 +
               "\nRan 2 tests in 0.01s\n\nFAILED (failures=1)\n")
        r = TestRun()
        _parse_unittest(out, r)
        self.assertEqual((r.total, r.failed, r.errors, r.passed), (2, 1, 0, 1))
        self.assertEqual(r.failures[0]["id"], "t.T.test_b")
        self.assertEqual(r.failures[0]["frames"][0]["line"], 5)
        self.assertEqual(r.passed_ids, ["t.T.test_a"])

    def test_knowledge_remembers_failed_repairs(self):
        kb = Knowledge(Path(tempfile.mkdtemp()))
        kb.record_repair(finding_id="f", rule="r", strategy="s", file="a.py", status="ROLLED BACK", risk="low", diff="", before_sha="abc")
        self.assertTrue(kb.failed_before("r", "a.py", "abc", "s"))
        self.assertFalse(kb.failed_before("r", "a.py", "different-content", "s"))
        self.assertFalse(kb.failed_before("r", "a.py", "abc", "other-strategy"))

    def test_secret_scan_masks_values(self):
        m = model_of({"c.py": 'KEY = "AKIAABCDEFGHIJKLMNOP"\nOTHER = "your_api_key_here"\n'})
        fs = [f for f in security.scan_security(m) if f.rule == "hardcoded-secret"]
        self.assertEqual(len(fs), 1)
        self.assertNotIn("AKIAABCDEFGHIJKLMNOP", str(fs[0].to_dict()))


if __name__ == "__main__":
    unittest.main(verbosity=2)
