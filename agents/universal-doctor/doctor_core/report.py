"""Reports: JSON + Markdown (+ HTML snapshot)."""
from __future__ import annotations

import html
import json
import time
from pathlib import Path


def to_markdown(st: dict) -> str:
    h, c = st["health"], st["counts"]
    L = [f"# Doctor report - {Path(st['project']).name}", f"*generated {time.strftime('%Y-%m-%d %H:%M:%S')} | mode: **{st['mode']}** | Doctor {st['version']}*", "",
         f"## Health: {h['label']} ({h['score']}/100)", f"Formula: `{h['formula']}`  (static penalty {h['static_penalty']}, test penalty {h['test_penalty']})", "",
         "| metric | value |", "|---|---|"]
    for k, v in c.items():
        L.append(f"| {k.replace('_', ' ')} | {v} |")
    comp = st["components"]
    L += ["", f"Components: {comp['total']} total, {comp['healthy']} healthy, {comp['warning']} warning, {comp['failed']} failed", ""]
    t = st.get("tests")
    if t:
        L += [f"## Tests ({t['framework']})", f"ran={t['ran']} total={t['total']} passed={t['passed']} failed={t['failed']} errors={t['errors']} duration={t['duration']}s", ""]
        for f in t["failures"][:20]:
            L.append(f"- **{f['id']}**: {f['message']}")
    L += ["", "## Findings (most severe first)", "", "| sev | class | rule | location | message | status |", "|---|---|---|---|---|---|"]
    for f in st["findings"][:120]:
        L.append(f"| {f['severity']} | {f['classification']} | {f['rule']} | {f['file']}:{f['line']} | {f['message'][:110].replace('|', '/')} | {f['status']} |")
    L += ["", "## Repairs", ""]
    for r in st["repairs"][:30]:
        L.append(f"- #{r['id']} **{r['status']}** {r['rule']} in {r['file']} (risk {r['risk']}) {r.get('notes', '')[:100]}")
    L += ["", "## Predicted risks (not bugs)", ""]
    for r in st["risks"]:
        L.append(f"- {r['file']}: score {r['risk_score']} {r['reasons']}")
    return "\n".join(L) + "\n"


def to_html(st: dict) -> str:
    return "<html><meta charset='utf-8'><body><pre>" + html.escape(to_markdown(st)) + "</pre></body></html>"


def write_reports(doctor, name: str = "latest") -> dict:
    st = doctor.state(max_findings=1000)
    d = doctor.data_dir / "reports"
    d.mkdir(exist_ok=True)
    paths = {"json": d / f"{name}.json", "md": d / f"{name}.md", "html": d / f"{name}.html"}
    paths["json"].write_text(json.dumps(st, indent=1, default=str), encoding="utf-8")
    paths["md"].write_text(to_markdown(st), encoding="utf-8")
    paths["html"].write_text(to_html(st), encoding="utf-8")
    return {k: str(v) for k, v in paths.items()}
