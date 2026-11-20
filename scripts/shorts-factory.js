'use strict';
const fs=require('node:fs'),path=require('node:path');
const {planShorts,renderShort}=require('../agents/production/shorts-factory');
const args=process.argv.slice(2),get=k=>{const i=args.indexOf('--'+k);return i<0?'':args[i+1];};
const command=args[0]||'help';
if(command==='plan'){
 const input=get('input'),output=get('output')||'uploads/shorts-plan.json';if(!input)throw Error('--input is required');
 const data=JSON.parse(fs.readFileSync(input,'utf8')),plan=planShorts({transcript:data.transcript||data.words,scenes:data.scenes||[],count:Number(get('count')||3),minSeconds:Number(get('min')||20),maxSeconds:Number(get('max')||60),targetSeconds:Number(get('target')||42)});
 fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(plan,null,2)+'\n');console.log('Shorts plan:',path.resolve(output),'| candidates:',plan.candidatesEvaluated,'| selected:',plan.shorts.length);
}else if(command==='render'){
 const input=get('input'),id=get('id'),video=get('video'),output=get('output');if(!input||!id||!video||!output)throw Error('render requires --input plan.json --id short-01 --video long.mp4 --output short.mp4');
 const plan=JSON.parse(fs.readFileSync(input,'utf8')),short=plan.shorts.find(x=>x.id===id);if(!short)throw Error('Short ID not found: '+id);
 console.log(JSON.stringify(renderShort({input:video,short,output}),null,2));
}else{console.log('Usage: node scripts/shorts-factory.js plan --input transcript.json [--count 3] [--min 20] [--max 60] [--output uploads/shorts-plan.json]');console.log('       node scripts/shorts-factory.js render --input uploads/shorts-plan.json --id short-01 --video long.mp4 --output short-01.mp4');}
