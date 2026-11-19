'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const args=process.argv.slice(2);
if(args.includes('--help')||!args.length){console.log('Usage: node scripts/research-content-studio.js "topic query" [--region=US] [--language=en] [--no-reddit]');process.exit(args.length?0:1);}
const query=args.filter(x=>!x.startsWith('--'))[0];
const region=(args.find(x=>x.startsWith('--region='))||'--region=US').split('=')[1];
const language=(args.find(x=>x.startsWith('--language='))||'--language=en').split('=')[1];
const py=process.platform==='win32'?'python':'python3';
const result=cp.spawnSync(py,['scripts/channel-intelligence.py','research','--query',query,'--region',region,'--language',language,...(args.includes('--no-reddit')?['--no-reddit']:[])],{encoding:'utf8',maxBuffer:8*1024*1024});
if(result.error)throw result.error;if(result.status!==0){process.stderr.write(result.stderr||'Research provider command failed\n');process.exit(result.status||1);}
const data=JSON.parse(result.stdout),sources=[];
for(const [provider,group] of Object.entries(data)){if(!group||!Array.isArray(group.items))continue;for(const item of group.items){if(!item.url||!/^https?:\\/\\//i.test(item.url))continue;sources.push({id:'src-'+(sources.length+1),provider,title:item.title||'Untitled result',url:item.url,publisher:item.source||item.channel_title||item.author||provider,observedAt:item.observed_at||item.published_at||'',summary:item.summary||item.description||''});}}
const slug=query.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50)||'research';
const out=path.join(__dirname,'..','uploads','content-studio','research-'+slug);fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'research-signals.json'),JSON.stringify({query,region,language,fetchedAt:new Date().toISOString(),providerStatus:data.provider_status,sources,limitations:'Search metadata and snippets are leads, not verified evidence. Open and read each source; record precise claim-to-source mappings in the content package.'},null,2)+'\n');
const lines=['# Research source leads','','Query: '+query,'Region: '+region,'Language: '+language,'',...sources.map(s=>'- ['+s.id+'] **'+s.title+'** ('+s.provider+') — '+s.url+(s.observedAt?' — '+s.observedAt:'')),'','## Provider status',...Object.entries(data.provider_status||{}).map(([k,v])=>'- '+k+': '+v),'','Search results are leads only. Read sources and verify evidence before scripting.'];
fs.writeFileSync(path.join(out,'research-sources.md'),lines.join('\n')+'\n');console.log(JSON.stringify({output:out,sourceCount:sources.length,providerStatus:data.provider_status},null,2));
