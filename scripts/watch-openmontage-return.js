'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {ingestReturn}=require('../agents/production/openmontage-return');
async function main(){
 const folder=path.resolve(process.argv[2]||'engines/OpenMontage/dark-phys-handoff/return'),dest=path.resolve('uploads/review-queue/openmontage-return');
 await fs.mkdir(folder,{recursive:true});console.log('Watching OpenMontage return folder:',folder);console.log('New deliverables are copied to:',dest);
 let busy=false,pending=false,closed=false;
 const sync=async()=>{
  if(busy){pending=true;return;}busy=true;
  try{await new Promise(resolve=>setTimeout(resolve,900));const r=await ingestReturn({returnDir:folder,reviewDir:dest,waitForStableMs:900});const fresh=r.files.filter(x=>x.status==='copied');if(fresh.length)console.log('Returned files:',fresh.map(x=>x.file).join(', '));}
  catch(e){console.error('Return sync:',e.message);}
  finally{busy=false;if(pending&&!closed){pending=false;sync();}}
 };
 await sync();const watcher=require('node:fs').watch(folder,{persistent:true},()=>sync());
 process.on('SIGINT',()=>{closed=true;watcher.close();console.log('Return watcher stopped.');process.exit(0);});
}
main().catch(e=>{console.error(e.message);process.exit(1);});
