# Doctor Agent - actual test results (sandbox: Linux, Python 3.12, no network)

| suite | command | result |
|---|---|---|
| unit tests (building blocks) | `python -m unittest discover -s tests -v` | **20 / 20 OK** (tests/unit_result.log) |
| controlled self-test (seeded-bug project, real execution) | `python doctor.py selftest` | **61 / 61 checks passed** (tests/selftest_result.log) |
| CLI end-to-end on a fresh seeded project | scan -> mode autonomous -> repair -> proposals -> test -> test --regression -> preflight -> history | all commands ran; see below |

## Honest history of the self-test
* run 1: 48/56 - found two REAL Doctor bugs: tracebacks from the shadow copy were not mapped back to the real project (logic-bug repair got no
  origin) and the SQLite connection was not usable from the monitor/dashboard threads. Both fixed.
* run 2: 60/61 - one check was wrongly strict ("NO FIX FOUND" is a legitimate status in diagnostic mode). Check corrected.
* run 3 (final): 61/61.

## What the self-test proves (seeded project with 26 bug classes + 7 tests: 3 FAIL, 1 ERROR, 3 pass)
* detection recall: all 26 seeded classes found; precision: the clean module has 0 findings; no bogus undefined-name/syntax findings
* root cause: failing tests traced to `app/calc.py::average` / `is_adult` (function-under-test inference)
* diagnostic mode: project tree byte-identical (incl. no `__pycache__`) after scan + repair attempt; writes refused even with "approved"
* supervised: nothing changes until approval; approved patch applied, backed up, VERIFIED by tests, only that file changed, manual rollback byte-identical
* autonomous: syntax-error, missing-import, mutable-default, bare-except, None-comparison, yaml.load fixed automatically & verified;
  timeout / import-typo / import-name wait for approval; hard-coded success status and the credential are never auto-edited
* logic bugs (failing tests): mutation repair found the single-edit fixes (`+ 1` -> `+ 0`, `>` -> `>=`) after approval; afterwards all 7 tests
  pass and nothing that passed before regressed
* rollback: injected post-write failure -> automatic rollback, bytes restored; identical failed strategy then SKIPPED; a harmful patch is rejected in the
  shadow copy (project untouched) and, with shadow disabled, applied -> regression detected -> rolled back
* regression guards: 6 generated, pass; re-introducing a fixed bug makes a guard fail
* knowledge persists across Doctor instances; the raw fake credential never appears in the DB / reports / proposals (masked)
* safety: path traversal blocked, credential files need approval, 7 destructive/external operations always need approval, mode switch immediate,
  tampering with a safety module detected, Doctor refuses to edit its own files
* recovery: circuit breaker (open/half-open/closed), bounded retries, graceful engine degradation, restart limits
* monitor: ACTIVE only while running, honest afterwards ("monitor was stopped"), file change triggers a scan; dashboard: page + state API,
  403 without token, 403 for foreign Host header, mode switch works, invalid mode rejected, scan as background job
* other stacks: JavaScript/Java project detected, JS issue flagged; dogfooding: Doctor scanning its own code finds no confirmed critical/high bug

## Not covered by these tests / limitations (see README)
Windows, Python 3.13, `pytest` projects, projects > ~5000 files, real-world (non-seeded) bugs beyond those classes.
