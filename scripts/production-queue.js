'use strict';
const {loadLocalEnv}=require('../agents/production/local-env');
loadLocalEnv();
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {ProductionOrchestrator}=require('../agents/production/orchestration');
const args=process.argv.slice(2),get=k=>{const i=args.indexOf('--'+k);return i<0?'':args[i+1];};
const orchestrator=new ProductionOrchestrator({root:get('state')||'.dark-phys-orchestrator'});
const allowed=new Set(['cinematic-production.js','shorts-factory.js','analytics-report.js','quality-control.js','phase4-package.js','script-engine-v2.js']);
async function main(){
 const cmd=args[0]||'list';
 if(cmd==='list'){console.log(JSON.stringify(orchestrator.list(),null,2));return;}
 if(cmd==='cleanup-temp'){const baseDir=get('base-dir');if(!baseDir)throw Error('--base-dir is required');const report=orchestrator.cleanupOwnedTemp({baseDir,dryRun:!args.includes('--execute')});console.log(JSON.stringify(report,null,2));if(!args.includes('--execute'))console.log('Dry run only. Add --execute after reviewing the candidate list.');return;}
 if(cmd==='add-weekly'){const file=get('file');if(!file)throw Error('--file is required');const data=JSON.parse(fs.readFileSync(file,'utf8'));const jobs=data.jobs||data;if(!Array.isArray(jobs))throw Error('Input must contain a jobs array');const start=get('start')?Date.parse(get('start')):Date.now();if(!Number.isFinite(start))throw Error('--start must be a valid ISO date');console.log(JSON.stringify(orchestrator.addWeeklyBatch(jobs,{startAt:start,spacingHours:Number(get('spacing-hours')||24)}),null,2));return;}
 if(cmd==='run-next'){const result=await orchestrator.runNext(async job=>{const script=path.basename(String(job.script||''));if(!allowed.has(script))throw Error('Script is not in the safe production allowlist: '+script);const scriptPath=path.resolve('scripts',script);if(!fs.existsSync(scriptPath))throw Error('Allowed script missing: '+scriptPath);const save=job.saveCheckpoint;save({stage:'execution-started',completed:job.checkpoint.completed||[]});const timeoutMs=Math.max(60000,Math.min(12*60*60*1000,Number(job.timeoutMs)||6*60*60*1000));const child=spawnSync(process.execPath,[scriptPath,...(Array.isArray(job.args)?job.args:[])],{stdio:'inherit',windowsHide:true,timeout:timeoutMs,env:{...process.env,DARK_PHYS_ORCHESTRATOR_JOB_ID:String(job.jobId),DARK_PHYS_ORCHESTRATOR_ATTEMPT:String(job.attempts)}});if(child.error){if(child.error.code==='ETIMEDOUT')throw Error(script+' exceeded the '+Math.round(timeoutMs/60000)+' minute job timeout and was terminated');throw child.error;}if(child.status!==0)throw Error(script+' exited with '+child.status+(child.signal?' after signal '+child.signal:''));save({stage:'execution-completed',completed:[...(job.checkpoint.completed||[]),script]});return{script,exitCode:child.status};});console.log(JSON.stringify(result,null,2));if(result.status==='failed')process.exitCode=2;return;}
 console.log('Usage: node scripts/production-queue.js list | add-weekly --file jobs.json [--start ISO] [--spacing-hours 24] | run-next | cleanup-temp --base-dir PATH [--execute]');
 process.exitCode=2;
}
main().catch(e=>{console.error('Production queue:',e.message);process.exitCode=1;});
