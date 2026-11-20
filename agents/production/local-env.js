'use strict';
const fs=require('node:fs');
const path=require('node:path');

/**
 * Load local project/provider settings without printing values.
 * Existing process environment always wins; root .env is preferred over the
 * pinned upstream engine .env when both define the same key.
 */
function loadLocalEnv({root=path.resolve(__dirname,'../..'),env=process.env,readFile=fs.readFileSync,exists=fs.existsSync}={}){
 const files=[path.join(root,'.env'),path.join(root,'engines','youtube-automation-agent','.env')];
 const loaded=[];
 for(const file of files){
  if(!exists(file))continue;
  let source;
  try{source=String(readFile(file,'utf8'));}catch(_){continue;}
  for(const raw of source.split(/\r?\n/)){
   const line=raw.trim();
   if(!line||line.startsWith('#'))continue;
   const match=line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
   if(!match)continue;
   const key=match[1];
   if(Object.prototype.hasOwnProperty.call(env,key))continue;
   let value=match[2].trim();
   if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
   if(!value.trim())continue;
   env[key]=value;
  }
  loaded.push(file);
 }
 return {loadedFiles:loaded};
}
module.exports={loadLocalEnv};
