'use strict';
/**
 * Phase 7: offline production readiness preflight.
 * Read-only: never starts services, changes files, calls providers or publishes.
 */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');

function commandVersion(command,args=['--version'],runner=spawnSync){
  try{const r=runner(command,args,{encoding:'utf8',windowsHide:true,timeout:5000});if(r.error||r.status!==0)return null;return String(r.stdout||r.stderr||'').trim().split(/\r?\n/)[0].slice(0,180)||null;}catch{return null;}
}
function parseEnvKeys(filePath,readFile=fs.readFileSync){
  try{return String(readFile(filePath,'utf8')).split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#')&&/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line)).map(line=>line.slice(0,line.indexOf('=')).trim());}catch{return [];}
}
function check({root=process.cwd(),env=process.env,platform=process.platform,nodeVersion=process.versions.node,totalmem=os.totalmem(),freemem=os.freemem(),runner=spawnSync,exists=fs.existsSync,statfs=fs.statfsSync,readFile=fs.readFileSync}={}){
  root=path.resolve(root);
  const results=[];
  const add=(id,status,detail,action=null)=>results.push({id,status,detail,action});
  const node=String(nodeVersion);
  const nodeParts=node.split('.').map(Number);
  const nodeMajor=nodeParts[0]||0, nodeMinor=nodeParts[1]||0;
  const nodeOk=nodeMajor>18||(nodeMajor===18&&nodeMinor>=17);
  add('node',nodeOk?'pass':'block', 'Node.js '+node+(nodeMajor>=20?' (recommended LTS)':' (20 LTS recommended)'),nodeOk?null:'Install Node.js 20 LTS (18.17+ minimum)');
  const git=commandVersion('git',['--version'],runner);add('git',git?'pass':'block',git||'Git not found','Install Git for Windows');
  const pyCmd=commandVersion(platform==='win32'?'python':'python3',['--version'],runner)||commandVersion('python',['--version'],runner);
  const pyMatch=pyCmd&&pyCmd.match(/Python\s+(\d+)\.(\d+)/i);
  const pyOk=Boolean(pyMatch)&& (Number(pyMatch[1])>3||(Number(pyMatch[1])===3&&Number(pyMatch[2])>=10));
  add('python',pyOk?'pass':'block',pyCmd||'Python 3.10+ not found',pyOk?null:'Install Python 3.10 or newer');
  const ffmpeg=commandVersion('ffmpeg',['-version'],runner);
  const app=path.join(root,'engines','youtube-automation-agent');
  const appInstalled=exists(path.join(app,'index.js'));
  const depsInstalled=exists(path.join(app,'node_modules'));
  const bundled=exists(path.join(app,'node_modules','ffmpeg-static'));
  add('youtube_engine',appInstalled?'pass':'warn',appInstalled?'YouTube Automation Agent checkout found':'YouTube Automation Agent not installed',appInstalled?null:'Run .\\setup-dark-phys.ps1 after prerequisites');
  add('youtube_dependencies',depsInstalled?'pass':'warn',depsInstalled?'Node dependencies found':'Node dependencies not installed',depsInstalled?null:'Run .\\setup-dark-phys.ps1');
  const rootSharp=exists(path.join(root,'node_modules','sharp'));
  add('thumbnail_runtime',rootSharp?'pass':'block',rootSharp?'Root Sharp thumbnail runtime found':'Root Sharp dependency missing; thumbnail generation will fail to load',rootSharp?null:'Run .\\setup-dark-phys.ps1 to install the required root thumbnail dependency');
  add('ffmpeg',ffmpeg||bundled?'pass':'warn',ffmpeg|| (bundled?'Bundled ffmpeg-static dependency found':'FFmpeg not found on PATH or in engine dependencies'),ffmpeg||bundled?null:'Install FFmpeg or complete the engine dependency setup');
  const openmontage=exists(path.join(root,'engines','OpenMontage'));
  add('openmontage',openmontage?'pass':'info',openmontage?'OpenMontage checkout found':'OpenMontage is optional and not installed',openmontage?null:'Install only when advanced rendering is needed');
  const envFiles=[path.join(root,'.env'),path.join(app,'.env')];
  const envKeys=[...new Set(envFiles.flatMap(file=>parseEnvKeys(file,readFile)))];
  const keyNames=['OPENAI_API_KEY','GEMINI_API_KEY','GOOGLE_API_KEY','DARK_PHYS_LLM_API_KEY','YOUTUBE_DATA_API_KEY','PIXABAY_API_KEY','PIXABAY_API_KEY_2','CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_TEXT_MODEL','CLOUDFLARE_IMAGE_MODEL','ELEVENLABS_API_KEY'];
  const present=keyNames.filter(k=>Boolean(env[k]&&String(env[k]).trim())||envKeys.includes(k));
  const absent=keyNames.filter(k=>!present.includes(k));
  add('credentials', 'info', present.length+' recognised credential variable(s) present; '+absent.length+' absent. Values are never displayed.', 'Configure only the providers you choose during final setup; never commit .env');
  const gb=n=>Number((n/1024**3).toFixed(1));
  const ram=gb(totalmem);
  add('memory',ram>=12?'pass':ram>=6?'warn':'warn',ram+' GB total RAM; '+gb(freemem)+' GB currently free',ram<12?'Use start-dark-phys-lite.ps1, render one job at a time and close unused apps':null);
  let disk=null;
  try{if(typeof statfs==='function'){const s=statfs(root);disk=gb(Number(s.bavail)*Number(s.bsize));}}catch{}
  if(disk!==null)add('disk_space',disk>=20?'pass':disk>=8?'warn':'block',disk+' GB available on project drive',disk<8?'Free at least 8 GB before installing/rendering':disk<20?'Prefer 20 GB+ free for video assets and renders':null);
  else add('disk_space','info','Free-space check unavailable on this Node/filesystem version',null);
  const critical=results.filter(x=>x.status==='block');
  const warnings=results.filter(x=>x.status==='warn');
  const verdict=critical.length?'BLOCK':warnings.length?'CAUTION':'GO';
  return {schemaVersion:1,phase:7,checkedAt:new Date().toISOString(),root,platform,verdict,summary:{passed:results.filter(x=>x.status==='pass').length,warnings:warnings.length,blocked:critical.length,info:results.filter(x=>x.status==='info').length},checks:results,guardrails:{readOnly:true,networkRequests:0,providerCalls:0,secretValuesExposed:false,filesModified:false,publishingTriggered:false},nextActions:results.filter(x=>x.action).map(x=>({check:x.id,action:x.action}))};
}
function main(argv=process.argv.slice(2)){
  const json=argv.includes('--json');
  const report=check();
  if(json)process.stdout.write(JSON.stringify(report,null,2)+'\n');
  else{
    console.log('Dark Phys Phase 7 — Production Readiness');
    console.log('Verdict: '+report.verdict+' | '+report.summary.passed+' pass, '+report.summary.warnings+' warning, '+report.summary.blocked+' blocked');
    for(const c of report.checks)console.log('['+c.status.toUpperCase()+'] '+c.id+': '+c.detail+(c.action?'\n  Next: '+c.action:''));
    console.log('Read-only check. No network calls, file changes, provider calls or publishing.');
  }
  if(report.verdict==='BLOCK')process.exitCode=2;
  return report;
}
if(require.main===module)main();
module.exports={check,main,parseEnvKeys,commandVersion};
