# Universal Doctor Agent — safe integration

The Doctor is integrated as an **optional, isolated maintenance subsystem** at `agents/universal-doctor/`.
It is deliberately not imported into the YouTube production/render pipeline and does not run during normal
video generation. This prevents diagnostics, file watching, or repair work from interrupting production jobs.

## Safe operating contract

- Default mode is `diagnostic`: scans and runs tests in a throw-away shadow copy; the target project remains read-only.
- `supervised`: patches are proposals until a human explicitly approves each repair.
- `autonomous`: only reproducible low-risk fixes may be applied automatically, after shadow verification and backup;
  medium/high-risk, logic, credential, destructive, deployment, publishing, package-install and external actions require approval.
- Before every write the repair engine creates a SHA-256-verified backup; post-write checks run and failures trigger rollback.
- Doctor state, reports, knowledge DB and backups are stored outside the scanned target project.
- Dashboard binds to `127.0.0.1`; mutating requests require a per-session token and localhost Host/Origin checks.
- Do not expose the dashboard port to the public internet or run the Doctor with elevated privileges.

## Windows quick start

From the repository root in PowerShell:

```powershell
cd agents/universal-doctor
python doctor.py health
python doctor.py selftest
python -m unittest discover -s tests -v
python doctor.py scan ..\.. --no-tests
```

The last command scans the Dark Phys repository in diagnostic mode. It does not change project files.
For deeper checks use `diagnose` (includes runtime import checks) or `preflight` (GO / NO-GO gate).

## Monitoring and dashboard (opt-in)

```powershell
python doctor.py monitor ..\.. --interval 60
# In another terminal:
python doctor.py status ..\..
python doctor.py dashboard ..\.. --port 8765
```

Stop monitoring with Ctrl+C or create the Doctor data directory's `monitor.stop` file.
Monitoring is not automatically started by the production pipeline.

## Repair policy

Keep the project in diagnostic mode for routine checks. If a repair is needed, switch to supervised mode,
inspect the proposal diff, then approve a specific proposal ID only after reviewing it:

```powershell
python doctor.py mode ..\.. supervised
python doctor.py repair ..\.. 
python doctor.py proposals ..\..
python doctor.py approve ..\.. 7
python doctor.py rollback ..\.. 7
```

Replace `7` with the actual proposal/repair ID. Never use `--approve-all` on the production repository.
Do not switch to autonomous mode for the live production repository without a separate, explicit review.

## Validation

GitHub Actions runs the Doctor's unit suite, controlled self-test, self-health check and safety-integrity
manifest check alongside the existing video-tool regression workflow. The seeded self-test exercises monitoring,
diagnostics, backup/rollback, repair approval gates, regression guards, circuit-breaker recovery and dashboard
request protections. These tests are controlled fixtures, not proof that every real-world defect can be found.

## Known limits

The agent is deterministic/static and does not call an LLM. The checked-in report records 20 unit tests and
61/61 controlled self-test checks from its prior Linux/Python 3.12 run. Windows behavior, Python 3.13,
large projects, pytest-specific projects and arbitrary real-world bugs still require environment-specific validation.


## Safe backup and restore commands

Run these from the Dark Phys repository root (replace the path with your actual project folder):

```powershell
python agents/universal-doctor/doctor.py backup "engines/youtube-automation-agent" "config/settings.json" "config/channel.json" --reason "before channel configuration"
python agents/universal-doctor/doctor.py backups "engines/youtube-automation-agent"
python agents/universal-doctor/doctor.py verify-backup "engines/youtube-automation-agent" BACKUP_ID
```

Restore is deliberately explicit and creates a second safety snapshot first:

```powershell
python agents/universal-doctor/doctor.py restore-backup "engines/youtube-automation-agent" BACKUP_ID --yes
```

Use project-relative file paths only. Backups reject absolute paths, parent-directory traversal and symlink targets; restore verifies the SHA-256 manifest before writing. The CLI makes a pre-restore safety backup and attempts to roll back to it if restoration fails. Store a second copy of important backups on a separate drive. Do not back up .env, OAuth tokens or private credentials to an unencrypted shared location.
