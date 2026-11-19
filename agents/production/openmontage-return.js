'use strict';
const fs=require('node:fs/promises'); const path=require('node:path');
async function ingestReturn({returnDir,reviewDir}) {
 if(!returnDir||!reviewDir) throw new Error('returnDir and reviewDir are required');
 const root=path.resolve(returnDir),dest=path.resolve(reviewDir); await fs.mkdir(dest,{recursive:true});
 const allowed=new Set(['.mp4','.mov','.mkv','.webm','.srt','.vtt','.ass','.jpg','.jpeg','.png','.json','.md','.wav','.mp3']);
 const entries=await fs.readdir(root,{withFileTypes:true}); const copied=[];
 for(const entry of entries) {
  if(!entry.isFile()) continue;
  const ext=path.extname(entry.name).toLowerCase(); if(!allowed.has(ext)) continue;
  const src=path.join(root,entry.name),target=path.join(dest,entry.name);
  try { await fs.copyFile(src,target,require('node:fs').constants.COPYFILE_EXCL); copied.push({file:entry.name,status:'copied'}); }
  catch(e) { if(e.code==='EEXIST') copied.push({file:entry.name,status:'already_exists'}); else throw e; }
 }
 const report={createdAt:new Date().toISOString(),source:root,reviewQueue:dest,files:copied,approvalRequired:true,published:false};
 await fs.writeFile(path.join(dest,'return-manifest.json'),JSON.stringify(report,null,2)+'\n');
 return report;
}
module.exports={ingestReturn};
