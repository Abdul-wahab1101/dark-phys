'use strict';
const fs=require('node:fs'),path=require('node:path');
const {analyzeAnalytics}=require('../agents/production/analytics-learning');
const args=process.argv.slice(2),get=k=>{const i=args.indexOf('--'+k);return i<0?'':args[i+1];};
const input=get('input'),output=get('output')||'uploads/analytics-learning-report.json';
if(!input){console.log('Usage: node scripts/analytics-report.js --input uploads/youtube-analytics-export.json [--output uploads/analytics-learning-report.json]');process.exitCode=2;}
else{const data=JSON.parse(fs.readFileSync(input,'utf8'));const report=analyzeAnalytics({videos:data.videos||data.rows||[],scriptBeatsByVideo:data.scriptBeatsByVideo||{},minimumVideos:15});fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log('Analytics report:',path.resolve(output));console.log('Videos:',report.metrics.videoCount,'| 15-video learning gate:',report.learningGate.eligible?'eligible for advisory review':'LOCKED — no rule changes');}
