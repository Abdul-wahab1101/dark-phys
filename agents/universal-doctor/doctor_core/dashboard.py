"""Professional local dashboard (stdlib http.server): live state, findings, repairs, approvals, mode switch.
Bound to 127.0.0.1 only; every mutating call needs the session token and a localhost Host/Origin."""
from __future__ import annotations

import json
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from .config import MODES, MODE_HELP, STATUSES

PAGE = r"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Doctor Agent</title>
<meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root{--bg:#0d1117;--card:#161b22;--line:#30363d;--tx:#e6edf3;--mut:#8b949e;--ok:#3fb950;--warn:#d29922;--bad:#f85149;--info:#58a6ff;--pur:#bc8cff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.45 system-ui,Segoe UI,Arial}
header{display:flex;gap:16px;align-items:center;padding:14px 22px;border-bottom:1px solid var(--line);flex-wrap:wrap}
h1{font-size:18px;margin:0}.sp{flex:1}.pill{padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid var(--line)}
.HEALTHY,.VERIFIED,.FIXED{color:var(--ok);border-color:var(--ok)}.WARNING,.INVESTIGATING,.REPAIRING{color:var(--warn);border-color:var(--warn)}
.CRITICAL,.ROLLED{color:var(--bad);border-color:var(--bad)}.NEEDS{color:var(--pur);border-color:var(--pur)}
main{padding:18px 22px;display:grid;gap:16px;grid-template-columns:repeat(12,1fr)}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;min-width:0}
.c3{grid-column:span 3}.c4{grid-column:span 4}.c6{grid-column:span 6}.c8{grid-column:span 8}.c12{grid-column:span 12}
@media(max-width:1000px){.c3,.c4,.c6,.c8{grid-column:span 12}}
.k{font-size:28px;font-weight:700}.l{color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mut);font-weight:600;font-size:12px}
button,select{background:#21262d;color:var(--tx);border:1px solid var(--line);border-radius:6px;padding:5px 10px;cursor:pointer}button:hover{border-color:var(--info)}
.sev-critical{color:var(--bad);font-weight:700}.sev-high{color:#ff7b72}.sev-medium{color:var(--warn)}.sev-low{color:var(--info)}.sev-info{color:var(--mut)}
code,pre{background:#0b0f14;border:1px solid var(--line);border-radius:6px;padding:2px 6px;font-size:12px}pre{padding:10px;overflow:auto;max-height:260px}
.bar{height:10px;background:#0b0f14;border-radius:6px;overflow:hidden}.bar>i{display:block;height:100%}
.sm{font-size:12px;color:var(--mut)}.scroll{max-height:340px;overflow:auto}
</style></head><body>
<header><h1>🩺 Universal Doctor Agent</h1><span id="proj" class="sm"></span><span class="sp"></span>
<span id="mon" class="pill"></span><span id="status" class="pill"></span>
<label class="sm">Mode <select id="mode"></select></label><button onclick="act('scan')">Scan now</button><span id="busy" class="sm"></span></header>
<main>
<div class="card c4"><div class="l">Health score</div><div class="k" id="score">-</div><div class="bar"><i id="scorebar"></i></div><div class="sm" id="formula"></div><div class="sm" id="lastscan"></div></div>
<div class="card c4"><div class="l">Components</div><div class="k" id="comp">-</div><div class="sm" id="compd"></div><div class="l" style="margin-top:8px">Tests</div><div id="tests" class="sm"></div></div>
<div class="card c4"><div class="l">Operating mode</div><div id="modehelp" class="sm"></div><div class="l" style="margin-top:8px">Doctor self-health</div><div id="self" class="sm"></div></div>
<div class="card c12"><div id="kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px"></div></div>
<div class="card c8"><div class="l">Findings (confirmed first)</div><div class="scroll"><table id="ft"><thead><tr><th>sev</th><th>class</th><th>rule</th><th>location</th><th>message</th><th>status</th></tr></thead><tbody></tbody></table></div></div>
<div class="card c4"><div class="l">Predicted risks (not bugs)</div><div id="risks" class="scroll sm"></div></div>
<div class="card c12"><div class="l">Repairs &amp; approvals</div><div class="scroll"><table id="rt"><thead><tr><th>#</th><th>status</th><th>rule</th><th>file</th><th>risk</th><th>notes</th><th></th></tr></thead><tbody></tbody></table></div><pre id="diff" style="display:none"></pre></div>
<div class="card c6"><div class="l">Security &amp; performance</div><div id="secperf" class="scroll sm"></div></div>
<div class="card c6"><div class="l">Architecture &amp; agents</div><div id="arch" class="scroll sm"></div></div>
<div class="card c12"><div class="l">Recent events</div><div id="ev" class="scroll sm"></div></div>
</main><script>
const TOKEN="__TOKEN__";const MODES=__MODES__;const HELP=__HELP__;
const $=i=>document.getElementById(i);const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
async function api(p,body){const o=body?{method:'POST',headers:{'X-Doctor-Token':TOKEN,'Content-Type':'application/json'},body:JSON.stringify(body)}:{};const r=await fetch(p,o);return r.json()}
async function act(a,extra){$('busy').textContent='working…';const r=await api('/api/'+a,Object.assign({},extra||{}));if(r.error)alert(r.error);setTimeout(load,600)}
$('mode').onchange=e=>act('mode',{mode:e.target.value});
async function showDiff(id){const r=await api('/api/diff?id='+id);const p=$('diff');p.style.display='block';p.textContent=r.diff||'(no diff)'}
function cls(s){return String(s).split(' ')[0]}
async function load(){let s;try{s=await api('/api/state')}catch(e){return}
$('proj').textContent=s.project;const h=s.health;$('status').textContent=h.label;$('status').className='pill '+h.label;
$('score').textContent=h.score+' / 100';$('scorebar').style.width=h.score+'%';$('scorebar').style.background=h.score>=85?'var(--ok)':h.score>=60?'var(--warn)':'var(--bad)';
$('formula').textContent=h.formula+' (static −'+h.static_penalty+', tests −'+h.test_penalty+')';
$('lastscan').textContent=s.last_scan?('last scan: '+s.last_scan.duration_s+' s, '+s.last_scan.findings+' findings'):'no scan yet';
const c=s.components;$('comp').textContent=c.total;$('compd').innerHTML='<span class="HEALTHY pill">'+c.healthy+' healthy</span> <span class="WARNING pill">'+c.warning+' warning</span> <span class="CRITICAL pill">'+c.failed+' failed</span>';
const t=s.tests;$('tests').textContent=t&&t.ran?(t.framework+': '+t.passed+' passed, '+t.failed+' failed, '+t.errors+' errors ('+t.duration+' s)'):(t?t.note||'tests not run':'not run');
const m=$('mode');if(!m.options.length)MODES.forEach(x=>{const o=document.createElement('option');o.value=o.textContent=x;m.appendChild(o)});m.value=s.mode;$('modehelp').textContent=s.mode+': '+HELP[s.mode];
const mo=s.monitoring;$('mon').textContent=mo.active?'MONITORING ACTIVE':'monitoring off';$('mon').className='pill '+(mo.active?'HEALTHY':'');
const k=s.counts;const items=[['Confirmed bugs',k.confirmed_bugs,'CRITICAL'],['Suspected',k.suspected,'WARNING'],['Critical vulnerabilities',k.critical_vulnerabilities,'CRITICAL'],['Performance issues',k.performance_issues,'WARNING'],['Bugs repaired',k.repaired,'FIXED'],['Fixes verified',k.verified,'VERIFIED'],['Rolled back',k.rolled_back,'ROLLED'],['Needs approval',k.needs_approval,'NEEDS'],['Unresolved',k.unresolved,'WARNING']];
$('kpis').innerHTML=items.map(i=>'<div><div class="l">'+i[0]+'</div><div class="k '+(i[1]?i[2]:'')+'" style="border:0">'+i[1]+'</div></div>').join('');
$('ft').tBodies[0].innerHTML=s.findings.slice(0,150).map(f=>'<tr><td class="sev-'+f.severity+'">'+f.severity+'</td><td>'+f.classification+'</td><td>'+esc(f.rule)+'</td><td><code>'+esc(f.file)+':'+f.line+'</code></td><td>'+esc(f.message.slice(0,140))+'<div class="sm">'+esc((f.fix_plan||'').slice(0,120))+'</div></td><td><span class="pill '+cls(f.status)+'">'+f.status+'</span></td></tr>').join('');
$('rt').tBodies[0].innerHTML=s.repairs.map(r=>'<tr><td>'+r.id+'</td><td><span class="pill '+cls(r.status)+'">'+r.status+'</span></td><td>'+esc(r.rule)+'</td><td><code>'+esc(r.file)+'</code></td><td>'+r.risk+'</td><td class="sm">'+esc((r.notes||'').slice(0,90))+'</td><td>'+
 '<button onclick="showDiff('+r.id+')">diff</button> '+(r.status=='NEEDS APPROVAL'||r.status=='PROPOSED'?'<button onclick="act(\'approve\',{id:'+r.id+'})">approve</button> <button onclick="act(\'reject\',{id:'+r.id+'})">reject</button>':'')+(['VERIFIED','FIXED','APPROVED'].includes(r.status)?'<button onclick="act(\'rollback\',{id:'+r.id+'})">rollback</button>':'')+'</td></tr>').join('');
$('risks').innerHTML=s.risks.map(r=>'<div><b>'+esc(r.file)+'</b> score '+r.risk_score+'<div class="sm">'+Object.entries(r.reasons).map(e=>e[0]+': '+e[1]).join(', ')+'</div></div>').join('')||'none';
const sec=s.findings.filter(f=>f.category==='security'),perf=s.findings.filter(f=>f.category==='performance');
$('secperf').innerHTML='<b>Security ('+sec.length+')</b><br>'+sec.slice(0,8).map(f=>'<div class="sev-'+f.severity+'">'+f.severity+' '+esc(f.rule)+' <code>'+esc(f.file)+':'+f.line+'</code></div>').join('')+'<br><b>Performance ('+perf.length+')</b><br>'+perf.slice(0,8).map(f=>'<div>'+esc(f.rule)+' <code>'+esc(f.file)+':'+f.line+'</code></div>').join('');
const a=s.architecture,ag=s.agents||{};$('arch').innerHTML='modules: '+(a.modules||0)+', import edges: '+(a.edges||0)+'<br>cycles: '+((a.cycles||[]).length)+', orphans: '+((a.orphans||[]).length)+', duplicates: '+((a.duplicates||[]).length)+', TODO/stubs: '+((a.incomplete||[]).length)+'<br>agents found: '+Object.keys(ag.agents||{}).length+', orchestrators: '+Object.keys(ag.orchestrators||{}).length;
$('ev').innerHTML=s.events.map(e=>'<div>'+e.ts+' <b>'+e.kind+'</b> '+esc(e.message)+'</div>').join('');
const eng=Object.entries(s.engines).map(e=>e[0]+':'+(e[1].healthy?'ok':'DEGRADED')).join(' · ');$('self').textContent=eng+(s.integrity.length?' · INTEGRITY: '+s.integrity.join(','):' · integrity ok');
$('busy').textContent='';}
load();setInterval(load,5000);
</script></body></html>"""


class DashboardServer:
    def __init__(self, doctor, port: int = 8765, token: str | None = None):
        self.doctor, self.port = doctor, port
        self.token = token or secrets.token_urlsafe(18)
        self.lock = threading.Lock()
        self.job = {"running": False, "name": "", "result": None}
        self.httpd: ThreadingHTTPServer | None = None
        self.thread: threading.Thread | None = None

    # ---- jobs run in a background thread, one at a time ------------------------------------------------------ #
    def run_job(self, name: str, fn) -> dict:
        with self.lock:
            if self.job["running"]:
                return {"error": f"busy with '{self.job['name']}'"}
            self.job = {"running": True, "name": name, "result": None}

        def work():
            try:
                res = fn()
            except Exception as e:                                           # noqa
                res = {"error": f"{type(e).__name__}: {e}"}
            self.job = {"running": False, "name": name, "result": res}
        threading.Thread(target=work, daemon=True).start()
        return {"started": name}

    def handle(self, method: str, path: str, body: dict, headers) -> tuple:
        d = self.doctor
        u = urlparse(path)
        host = (headers.get("Host") or "").split(":")[0]
        if host not in ("127.0.0.1", "localhost"):
            return 403, {"error": "forbidden host"}
        if method == "GET":
            if u.path == "/":
                html = PAGE.replace("__TOKEN__", self.token).replace("__MODES__", json.dumps(list(MODES))).replace("__HELP__", json.dumps(MODE_HELP))
                return 200, html
            if u.path == "/api/state":
                return 200, dict(d.state(), job=self.job)
            if u.path == "/api/diff":
                rid = int(parse_qs(u.query).get("id", ["0"])[0])
                r = d.kb.repair(rid)
                return 200, {"diff": (r or {}).get("diff", "")}
            return 404, {"error": "not found"}
        origin = headers.get("Origin")
        if origin and urlparse(origin).hostname not in ("127.0.0.1", "localhost"):
            return 403, {"error": "forbidden origin"}
        if headers.get("X-Doctor-Token") != self.token:
            return 403, {"error": "missing or wrong session token"}
        if u.path == "/api/scan":
            return 200, self.run_job("scan", lambda: d.scan())
        if u.path == "/api/mode":
            try:
                d.set_mode(body.get("mode", ""))
            except ValueError as e:
                return 400, {"error": str(e)}
            return 200, {"mode": d.mode}
        if u.path == "/api/approve":
            return 200, self.run_job("approve", lambda: d.repair.approve(int(body["id"])))
        if u.path == "/api/reject":
            return 200, d.repair.reject(int(body["id"]))
        if u.path == "/api/rollback":
            return 200, self.run_job("rollback", lambda: d.repair.rollback(int(body["id"])))
        if u.path == "/api/repair":
            return 200, self.run_job("repair", lambda: d.repair_all())
        return 404, {"error": "not found"}

    def start(self, background: bool = True):
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):          # quiet
                pass

            def _send(self, code, payload):
                data = payload.encode() if isinstance(payload, str) else json.dumps(payload, default=str).encode()
                self.send_response(code)
                self.send_header("Content-Type", "text/html; charset=utf-8" if isinstance(payload, str) else "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                self._send(*outer.handle("GET", self.path, {}, self.headers))

            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0)
                try:
                    body = json.loads(self.rfile.read(n) or b"{}")
                except ValueError:
                    return self._send(400, {"error": "bad json"})
                try:
                    self._send(*outer.handle("POST", self.path, body, self.headers))
                except Exception as e:                                       # noqa
                    self._send(500, {"error": f"{type(e).__name__}: {e}"})
        self.httpd = ThreadingHTTPServer(("127.0.0.1", self.port), H)
        self.port = self.httpd.server_address[1]
        if background:
            self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
            self.thread.start()
        else:
            self.httpd.serve_forever()
        return self

    def stop(self):
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
