'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const roots=['agents','scripts','workers','utils'];
const files=[];
function walk(dir){
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const full=path.join(dir,entry.name);
  if(entry.isDirectory())walk(full);
  else if(entry.isFile()&&/\.(?:js|mjs)$/.test(entry.name))files.push(full);
 }
}
for(const dir of roots){const full=path.join(root,dir);if(fs.existsSync(full))walk(full);}
function resolveLocal(from,spec){
 const base=path.resolve(path.dirname(from),spec),candidates=[base,base+'.js',base+'.mjs',base+'.json',path.join(base,'index.js'),path.join(base,'index.mjs')];
 for(const candidate of candidates)if(fs.existsSync(candidate)&&fs.statSync(candidate).isFile())return candidate;
 const pkg=path.join(base,'package.json');
 if(fs.existsSync(pkg)){
  try{const data=JSON.parse(fs.readFileSync(pkg,'utf8'));if(data.main){const main=path.resolve(base,data.main);for(const candidate of [main,main+'.js',main+'.mjs',path.join(main,'index.js')])if(fs.existsSync(candidate)&&fs.statSync(candidate).isFile())return candidate;}}catch(_){}
 }
 return null;
}
const failures=[];
for(const file of files){
 const checked=spawnSync(process.execPath,['--check',file],{encoding:'utf8',timeout:20000});
 if(checked.error||checked.status!==0)failures.push({file:path.relative(root,file),kind:'syntax',detail:String(checked.stderr||checked.error||'node --check failed').slice(-1200)});
 const source=fs.readFileSync(file,'utf8');
 const pattern=/require\(\s*['"]((?:\.\.?\/)[^'"]+)['"]\s*\)/g;
 for(const match of source.matchAll(pattern)){
  const target=resolveLocal(file,match[1]);
  if(!target)failures.push({file:path.relative(root,file),kind:'broken-local-import',specifier:match[1]});
 }
}
if(failures.length){console.error(JSON.stringify({checkedFiles:files.length,failures},null,2));process.exit(1);}
console.log('PASS first-party JavaScript syntax and relative handoff imports: '+files.length+' files across '+roots.join(', '));
