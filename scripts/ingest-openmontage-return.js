'use strict';
const path=require('node:path'); const {ingestReturn}=require('../agents/production/openmontage-return');
async function main(){const dir=process.argv[2];if(!dir){console.log('Usage: node scripts/ingest-openmontage-return.js <OpenMontage-return-folder>');process.exitCode=1;return;}const r=await ingestReturn({returnDir:dir,reviewDir:path.resolve('uploads','review-queue','openmontage-return')});console.log(JSON.stringify(r,null,2));}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
