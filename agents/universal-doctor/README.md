# Universal Autonomous AI Doctor Agent  (v1.0.0)

A local, zero-budget software "doctor": it **discovers** a project, **detects** bugs / vulnerabilities / risks, **explains the root
cause**, **repairs** what is safe to repair (with backups, test verification and rollback), **remembers** what it did, and
shows everything on a **dashboard**. Pure Python standard library - nothing to install, no paid APIs, no network, **no LLM calls**
(all engines are deterministic: static analysis, test execution, search-based repair).

## Requirements
Python 3.10+ (tested on 3.12; Windows/macOS/Linux code paths exist). Optional: `pytest`, `node` (JS syntax check), `git` (churn for risk prediction).

## Install & first run (Windows CMD)
```
cd C:\path\to\universal_doctor
python doctor.py init
python doctor.py selftest
python doctor.py scan C:\path\to\your\project
```
`init` records the SHA-256 of the safety modules (self-protection). Re-run it after copying/unzipping if line endings were converted.
All Doctor state (knowledge base, backups, proposals, reports, regression guards) lives **outside** your project in
`doctor_data\<project>-<hash>\` (override with `--data-dir` or `DOCTOR_HOME`).

## Operating modes
| mode | what happens |
|---|---|
| `diagnostic` (default) | scan, test (in a throw-away copy), report. **Never modifies the project** (verified byte-for-byte in the self-test). |
| `supervised` | prepares patches + diffs, applies **only after you approve** (`approve ID` / dashboard button). |
| `autonomous` | applies reproducible **low-risk** fixes automatically (shadow-verify -> backup -> write -> re-check -> roll back on any problem). Medium/high-risk and logic fixes still wait for approval. |

```
python doctor.py mode PROJECT autonomous      # show/change mode (takes effect immediately)
python doctor.py repair PROJECT               # repairs according to the mode
python doctor.py proposals PROJECT            # patches waiting for approval (with diffs)
python doctor.py approve PROJECT 7            # apply proposal #7 (re-verified first)
python doctor.py rollback PROJECT 7           # restore the backed-up original bytes
```

## Commands
`scan`, `diagnose` (+runtime import checks), `repair`, `proposals`, `approve`, `reject`, `rollback`, `test [--regression]`, `mode`,
`monitor [--interval S]`, `status`, `preflight` (GO / NO-GO), `dashboard [--port 8765]`, `history`, `report`, `health`, `selftest`.

## Dashboard
`python doctor.py dashboard PROJECT` -> http://127.0.0.1:8765 : health score (formula shown), components healthy/warning/failed, confirmed bugs,
suspected, vulnerabilities, performance issues, repaired / verified / rolled back / needs approval, test results, findings table, repair
history with **diff / approve / reject / rollback** buttons, predicted risks, security & performance, architecture & agents, events,
monitoring status (ACTIVE only with a fresh heartbeat of a live process), mode selector, Doctor self-health.
Bound to 127.0.0.1; every mutating call needs the per-session token embedded in the page and a localhost Host/Origin.
Status labels: HEALTHY, WARNING, CRITICAL, INVESTIGATING, REPAIRING, FIXED, VERIFIED, ROLLED BACK, NEEDS APPROVAL.

## How a repair is made safe
1. history check (an identical strategy that already failed on identical content is never repeated)
2. patch = minimal single-purpose edit (CRLF/BOM preserved); > N changed lines or non-low risk -> approval
3. **shadow verification**: patch applied to a private copy, project's tests run, a patch that breaks a previously-passing test is rejected
4. backup (SHA-256 verified) -> atomic write -> post-write checks (bytes on disk, syntax, finding really gone)
5. any failure -> automatic restore from backup; every outcome recorded in the knowledge base
6. a regression guard test is generated and run after later repairs

## Health score (transparent)
`100 - min(70, sum(severity_weight x class_weight)) - min(30, 10 + 2 x failing_tests)`; severity weights critical 15 / high 8 / medium 3 / low 1;
class weights confirmed 1.0 / suspected 0.4 / recommendation 0.1. CRITICAL if any confirmed critical finding or score < 60; WARNING < 85.

## What is NEVER done automatically (needs your explicit approval)
deleting files/directories/databases, production deployment, publishing, credential/secret edits (protected: `.env`, `*.pem`, `*.key`, ...),
installing packages, paid services, permission escalation, changes outside the project, edits to the Doctor's own files.

## Architecture (18 engines -> modules)
discovery.py (project discovery, technology detection, architecture map, change impact) · analysis.py (code analysis + bug detection) ·
security.py · performance.py · agents_diag.py (multi-agent diagnostics) · rootcause.py · repair.py (repair engine, mutation repair,
regression guards) · testing.py (shadow workspace, test runner, runtime import checks) · backup.py + recovery.py (backup/rollback, retries,
circuit breaker, restarts, checkpoints) · knowledge.py (SQLite) · monitor.py (continuous monitoring, preflight, post-deploy HTTP check) ·
dashboard.py + report.py · safety.py (permissions, modes, self-integrity) · engine.py (orchestrator) · selftest.py.
