'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function ingestReturn({returnDir,reviewDir,waitForStableMs=0}) {
 if(!returnDir||!reviewDir)throw new Error('returnDir and reviewDir are required');
 const root=path.resolve(returnDir),dest=path.resolve(reviewDir);await fs.mkdir(dest,{recursive:true});
 const allowed=new Set(['.mp4','.mov','.mkv','.webm','.srt','.vtt','.ass','.jpg','.jpeg','.png','.json','.md','.wav','.mp3']);
 const entries=await fs.readdir(root,{withFileTypes:true}),copied=[];
 for(const entry of entries){
  if(!entry.isFile())continue;
  const ext=path.extname(entry.name).toLowerCase();if(!allowed.has(ext))continue;
  const src=path.join(root,entry.name),target=path.join(dest,entry.name);
  if(waitForStableMs>0){
   const before=await fs.stat(src);await wait(waitForStableMs);const after=await fs.stat(src);
   if(before.size!==after.size||before.mtimeMs!==after.mtimeMs){copied.push({file:entry.name,status:'still_writing'});continue;}
  }
  try{await fs.copyFile(src,target,require('node:fs').constants.COPYFILE_EXCL);copied.push({file:entry.name,status:'copied'});}
  catch(e){if(e.code==='EEXIST')copied.push({file:entry.name,status:'already_exists'});else throw e;}
 }
 const createdAt=new Date().toISOString(),manifestName='return-manifest-'+createdAt.replace(/[:.]/g,'-')+'-'+require('node:crypto').randomUUID()+'.json';
 const report={createdAt,source:root,reviewQueue:dest,files:copied,approvalRequired:true,published:false};
 await fs.writeFile(path.join(dest,manifestName),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 return report;
}
module.exports={ingestReturn};
