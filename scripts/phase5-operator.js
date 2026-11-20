#!/usr/bin/env node
'use strict';
const {loadLocalEnv}=require('../agents/production/local-env');
loadLocalEnv();
const { spawn } = require('node:child_process');
const BASE = (process.env.DARK_PHYS_URL || 'http://127.0.0.1:3456').replace(/\/+$/, '');
const READS = [['health','/health'],['dashboard','/api/dashboard'],['readiness','/api/readiness'],['publish_schedule','/schedule'],['video_analytics','/analytics'],['channel_analytics','/api/analytics/channel'],['outcomes','/api/outcomes'],['growth_experiments','/api/experiments']];
async function inspect(fetchImpl=globalThis.fetch,base=BASE){
 if(typeof fetchImpl!=='function')throw new Error('Node.js 18+ with fetch is required');
 const checks=await Promise.all(READS.map(async([name,route])=>{try{const response=await fetchImpl(base+route,{method:'GET',headers:{Accept:'application/json'}});let data=null;if((response.headers?.get?.('content-type')||'').includes('json'))data=await response.json();return{name,route,status:response.status,ok:response.ok,data};}catch(error){return{name,route,status:0,ok:false,error:String(error.message||error).slice(0,240)};}}));
 const health=checks.find(x=>x.name==='health'),ready=checks.find(x=>x.name==='readiness');
 return{base,reachable:Boolean(health?.ok),setupRequired:health?.data?.status==='setup_required',readiness:ready?.data||null,checks,unavailable:checks.filter(x=>!x.ok),safety:{readOnly:true,uploadsTriggered:false,publishingApprovalRemainsInUpstreamDashboard:true,note:'Status checks only; no generation, schedule changes, uploads or publishing.'}};
}
function openDashboard(){const url=BASE+'/';let child;if(process.platform==='win32')child=spawn('cmd',['/c','start','',url],{detached:true,stdio:'ignore'});else if(process.platform==='darwin')child=spawn('open',[url],{detached:true,stdio:'ignore'});else child=spawn('xdg-open',[url],{detached:true,stdio:'ignore'});child.on('error',e=>{process.stderr.write('Could not open browser: '+e.message+'\n');process.exitCode=1;});child.unref();process.stdout.write('Opening Dark Phys dashboard: '+url+'\n');}
async function main(argv=process.argv.slice(2),fetchImpl=globalThis.fetch){const command=argv[0]||'status';if(command==='open')return openDashboard();if(!['status','preflight'].includes(command)){process.stdout.write('Usage: node scripts/phase5-operator.js status|preflight|open\n');process.exitCode=2;return;}const report=await inspect(fetchImpl);if(argv.includes('--json'))process.stdout.write(JSON.stringify(report,null,2)+'\n');else{process.stdout.write('Dark Phys Phase 5 — '+report.base+'\n');for(const x of report.checks)process.stdout.write((x.ok?'OK   ':'CHECK ')+x.name+' ('+(x.status||'offline')+')\n');if(report.setupRequired)process.stdout.write('SETUP REQUIRED: configure providers and connect the intended YouTube channel.\n');if(!report.reachable)process.stdout.write('Dashboard offline. Start it with .\\start-dark-phys.ps1 after setup.\n');process.stdout.write('Read-only check; no upload or publishing action performed.\n');}if(command==='preflight'&&!report.reachable)process.exitCode=2;}
if(require.main===module)main().catch(e=>{process.stderr.write(e.stack||String(e));process.exitCode=1;});
module.exports={inspect,READS,main};
