#!/usr/bin/env python3
"""Universal Autonomous AI Doctor Agent - command line.

  python doctor.py init                              record the integrity manifest of the safety modules
  python doctor.py scan PATH [--no-tests]            discover + detect (diagnostic: never modifies PATH)
  python doctor.py diagnose PATH                     scan + tests + runtime checks + report files
  python doctor.py repair PATH [--mode M] [--rule R] [--approve-all]
  python doctor.py proposals PATH | approve PATH ID | reject PATH ID | rollback PATH ID
  python doctor.py test PATH [--regression]          run the project's tests (in a throw-away copy)
  python doctor.py mode PATH [diagnostic|supervised|autonomous]
  python doctor.py monitor PATH [--interval S] | status PATH | preflight PATH
  python doctor.py dashboard PATH [--port 8765]      http://127.0.0.1:8765
  python doctor.py history PATH | report PATH | health | selftest
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from doctor_core import report as report_mod                      # noqa: E402
from doctor_core.config import MODES, MODE_HELP, VERSION          # noqa: E402
from doctor_core.backup import BackupManager                       # noqa: E402
from doctor_core.engine import Doctor                             # noqa: E402
from doctor_core.monitor import Monitor, monitor_status, preflight  # noqa: E402
from doctor_core.safety import verify_integrity, write_integrity_manifest  # noqa: E402


def show_findings(d: Doctor, limit: int = 40) -> None:
    for f in d.findings[:limit]:
        print(f"  [{f.severity:8s}|{f.classification:14s}] {f.rule:26s} {f.file}:{f.line}  {f.message[:90]}")
    if len(d.findings) > limit:
        print(f"  ... {len(d.findings) - limit} more (see the report/dashboard)")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="doctor.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["init", "scan", "diagnose", "repair", "proposals", "approve", "reject", "rollback", "test", "mode", "monitor",
                                    "status", "preflight", "dashboard", "history", "report", "health", "selftest", "backup", "backups", "verify-backup", "restore-backup"])
    ap.add_argument("args", nargs="*")
    ap.add_argument("--mode", choices=MODES)
    ap.add_argument("--data-dir")
    ap.add_argument("--no-tests", action="store_true")
    ap.add_argument("--rule", action="append")
    ap.add_argument("--approve-all", action="store_true", help="treat every proposed repair as approved by you (supervised/autonomous only)")
    ap.add_argument("--regression", action="store_true")
    ap.add_argument("--interval", type=float)
    ap.add_argument("--port", type=int)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--yes", action="store_true", help="confirm a destructive backup restore")
    ap.add_argument("--reason", default="manual backup", help="reason label for a backup")
    a = ap.parse_args(argv)

    if a.cmd == "init":
        print(json.dumps(write_integrity_manifest(), indent=1))
        return 0
    if a.cmd == "selftest":
        from doctor_core.selftest import run
        return run()
    if a.cmd == "health":
        import tempfile
        d = Doctor(tempfile.mkdtemp(prefix="doctor_probe_"), data_dir=tempfile.mkdtemp())
        h = d.self_health()
        for k, v in h["checks"].items():
            print(("OK   " if v["ok"] else "FAIL ") + f"{k}: {v['detail']}")
        return 0 if h["ok"] else 1
    if not a.args:
        ap.error("PATH required")
    project = a.args[0]
    d = Doctor(project, a.data_dir, a.mode)
    bad = verify_integrity()
    if bad:
        print(f"WARNING: Doctor integrity check: {bad}", file=sys.stderr)

    if a.cmd in ("scan", "diagnose"):
        s = d.scan(run_tests_flag=not a.no_tests, runtime_checks=(a.cmd == "diagnose"))
        print(f"Project: {d.root}\nMode: {d.mode}   Health: {s['health']}/100 ({s['label']})   findings: {s['findings']}   scan: {s['duration_s']}s")
        t = d.last_tests
        if t and t.ran:
            print(f"Tests ({t.framework}): {t.passed} passed, {t.failed} failed, {t.errors} errors of {t.total}")
        elif t:
            print(f"Tests: {t.note}")
        print("Technologies:", json.dumps(s["technologies"]["languages"]), s["technologies"]["frameworks"])
        show_findings(d)
        paths = report_mod.write_reports(d)
        print("Reports:", paths["md"])
        return 0
    if a.cmd == "repair":
        s = d.scan()
        print(f"Mode: {d.mode} - {MODE_HELP[d.mode]}\nBefore: health {s['health']} findings {s['findings']}")
        res = d.repair_all(rules=a.rule, approved=a.approve_all)
        for r in res:
            print(f"  {r.get('status'):16s} {r.get('rule', r.get('test', '')):24s} {r.get('reason', '')[:80]}")
        s2 = d.scan()
        print(f"After:  health {s2['health']} findings {s2['findings']}")
        return 0
    if a.cmd == "proposals":
        for r in d.kb.repairs(50):
            if r["status"] in ("NEEDS APPROVAL", "PROPOSED"):
                print(f"#{r['id']} {r['status']} {r['rule']} {r['file']} risk={r['risk']}\n{r['diff']}\n")
        return 0
    if a.cmd in ("approve", "reject", "rollback"):
        rid = int(a.args[1])
        print(json.dumps(getattr(d.repair, a.cmd)(rid), indent=1, default=str)[:3000])
        return 0
    if a.cmd == "test":
        d.refresh()
        if a.regression:
            r = d.repair.run_regression_guards()
        else:
            from doctor_core.testing import Shadow, run_tests
            sh = Shadow(d.root, d.data_dir)
            try:
                r = run_tests(sh.path, d.model, d.python)
            finally:
                sh.cleanup()
        print(json.dumps({k: v for k, v in r.to_dict().items() if k != "passed_ids"}, indent=1)[:4000])
        return 0 if r.ok or not r.ran else 1
    if a.cmd == "mode":
        if len(a.args) > 1:
            d.set_mode(a.args[1])
        print(f"mode: {d.mode} - {MODE_HELP[d.mode]}")
        return 0
    if a.cmd == "monitor":
        print(f"monitoring {d.root} every {a.interval or d.settings.get('monitor_interval')}s (Ctrl+C or create {d.data_dir / 'monitor.stop'} to stop)")
        try:
            Monitor(d, a.interval).run()
        except KeyboardInterrupt:
            print("stopped")
        return 0
    if a.cmd == "status":
        print(json.dumps(monitor_status(d.data_dir), indent=1))
        return 0
    if a.cmd == "preflight":
        r = preflight(d)
        print(json.dumps(r, indent=1))
        return 0 if r["verdict"] == "GO" else 2
    if a.cmd == "history":
        for r in d.kb.repairs(40):
            print(f"#{r['id']} {r['ts']} {r['status']:18s} {r['rule']:22s} {r['file']}")
        for e in d.kb.events(15):
            print(f"  {e['ts']} {e['kind']}: {e['message']}")
        return 0
    if a.cmd == "report":
        if not d.findings:
            d.scan()
        print(json.dumps(report_mod.write_reports(d), indent=1))
        return 0
    if a.cmd == "dashboard":
        from doctor_core.dashboard import DashboardServer
        port = a.port or int(d.settings.get("dashboard_port"))
        if not d.findings:
            print("running first scan ...")
            d.scan()
        srv = DashboardServer(d, port)
        print(f"Dashboard: http://127.0.0.1:{port}   (Ctrl+C to stop)  - mutating actions need the session token embedded in the page")
        try:
            srv.start(background=False)
        except KeyboardInterrupt:
            srv.stop()
        return 0
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(errors="replace")
    except Exception:
        pass
    sys.exit(main())
