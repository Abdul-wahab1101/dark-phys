'use strict';
const fs=require('node:fs/promises'); const path=require('node:path'); const {planScenes}=require('../agents/production/scene-planner');
async function main(){const [input,output]=process.argv.slice(2);if(!input){console.log('Usage: node scripts/plan-scenes.js approved-beats.json [output.json]');process.exitCode=1;return;}const data=JSON.parse(await fs.readFile(input,'utf8'));const plan=planScenes(data);const dest=path.resolve(output||path.join('uploads','production',plan.projectId,'scene-plan.json'));await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,JSON.stringify(plan,null,2)+'\n');console.log('Scene plan:',dest,'| scenes:',plan.scenes.length);}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
