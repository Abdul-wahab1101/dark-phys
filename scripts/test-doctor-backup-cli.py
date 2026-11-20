"""End-to-end CLI checks for safe Doctor backup and restore commands."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCTOR = ROOT / "agents" / "universal-doctor" / "doctor.py"


class BackupCli(unittest.TestCase):
    def test_backup_verify_list_and_guarded_restore(self):
        with tempfile.TemporaryDirectory(prefix="dark_phys_backup_cli_") as tmp:
            base = Path(tmp)
            project = base / "project"
            data = base / "doctor-data"
            target = project / "nested" / "settings.json"
            target.parent.mkdir(parents=True)
            target.write_text('{"mode":"before"}', encoding="utf-8")

            def run(*args):
                return subprocess.run(
                    [sys.executable, str(DOCTOR), *map(str, args), "--data-dir", str(data)],
                    cwd=ROOT, text=True, capture_output=True, timeout=30,
                )

            made = run("backup", project, "nested/settings.json", "--reason", "CLI regression")
            self.assertEqual(made.returncode, 0, made.stdout + made.stderr)
            backup_id = json.loads(made.stdout)["backup_id"]
            self.assertTrue(json.loads(made.stdout)["verified"])

            target.write_text('{"mode":"changed"}', encoding="utf-8")
            verified = run("verify-backup", project, backup_id)
            self.assertEqual(verified.returncode, 0, verified.stdout + verified.stderr)

            listed = run("backups", project)
            self.assertEqual(listed.returncode, 0, listed.stdout + listed.stderr)
            self.assertEqual(json.loads(listed.stdout)[0]["id"], backup_id)

            refused = run("restore-backup", project, backup_id)
            self.assertEqual(refused.returncode, 2)
            self.assertIn("--yes", refused.stdout)

            restored = run("restore-backup", project, backup_id, "--yes")
            self.assertEqual(restored.returncode, 0, restored.stdout + restored.stderr)
            self.assertEqual(target.read_text(encoding="utf-8"), '{"mode":"before"}')
            self.assertIn("safety_backup", json.loads(restored.stdout))


if __name__ == "__main__":
    unittest.main(verbosity=2)
