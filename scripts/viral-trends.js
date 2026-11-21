#!/usr/bin/env node
'use strict';
const {loadLocalEnv}=require('../agents/production/local-env');
loadLocalEnv();
const fs=require('node:fs');
const path=require('node:path');
const {YouTubeTrendSource}=require('../agents/viral-intelligence-sources');
async function main(argv=process.argv.slice(2)){
 const file=argv[0];
 if(!file||file==='--help'||file==='help'){
  console.log('Dark Phys official trend discovery\nUsage: node scripts/viral-trends.js trend-config.json\nConfig JSON: {regionCode:"US",queries:["topic phrase"],maxResults:25,output:"uploads/trends.json"}\nRequires YOUTUBE_DATA_API_KEY. Uses official YouTube Data API v3; no scraping.');
  return 0;
 }
 const config=JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
 const api=new YouTubeTrendSource({regionCode:config.regionCode||'US'});
 const result=await api.discover({regionCode:config.regionCode||'US',queries:Array.isArray(config.queries)?config.queries:[],maxResults:config.maxResults||25});
 const out=path.resolve(config.output||path.join('uploads','viral-intelligence','trend-snapshot-'+Date.now()+'.json'));
 fs.mkdirSync(path.dirname(out),{recursive:true});
 fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({output:out,regionCode:result.regionCode,candidateCount:result.items.length,queryCount:result.searches.length,source:result.provider},null,2));
 return 0;
}
if(require.main===module)main().then(code=>{process.exitCode=code;}).catch(e=>{console.error('Trend discovery error:',e.message);process.exitCode=1;});
module.exports={main};
