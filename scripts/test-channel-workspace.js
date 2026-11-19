'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createWorkspace,listWorkspaces,slug}=require('./channel-workspace');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'dark-phys-channels-'));
try{
 const source=path.join(root,'source');fs.mkdirSync(path.join(source,'node_modules'),{recursive:true});fs.writeFileSync(path.join(source,'index.js'),'// engine');fs.writeFileSync(path.join(source,'package.json'),'{}');fs.writeFileSync(path.join(source,'.env'),'SECRET=do-not-copy');fs.mkdirSync(path.join(source,'config'));fs.writeFileSync(path.join(source,'config','tokens.json'),'{"token":"private"}');fs.mkdirSync(path.join(source,'data'));fs.writeFileSync(path.join(source,'data','db.sqlite'),'db');
 const workspaces=path.join(root,'workspaces');
 const en=createWorkspace({id:'dark-phys-en',name:'Dark Phys English',port:3457,sourceEngine:source,workspaceRoot:workspaces});
 const ur=createWorkspace({id:'dark-phys-ur',name:'Dark Phys Roman Urdu',port:3458,sourceEngine:source,workspaceRoot:workspaces});
 assert.equal(en.id,'dark-phys-en');assert.equal(ur.port,3458);assert.equal(listWorkspaces(workspaces).length,2);assert.throws(()=>createWorkspace({id:'duplicate',name:'Duplicate',port:3457,sourceEngine:source,workspaceRoot:workspaces}),/already assigned/);
 const enEngine=en.enginePath,urEngine=ur.enginePath;
 assert(fs.existsSync(path.join(enEngine,'index.js')));assert(fs.existsSync(path.join(enEngine,'node_modules')));
 assert(!fs.existsSync(path.join(enEngine,'.env')));assert(!fs.existsSync(path.join(enEngine,'config','tokens.json')));assert(!fs.existsSync(path.join(enEngine,'data','db.sqlite')));
 assert.notEqual(enEngine,urEngine);assert.equal(fs.readFileSync(path.join(enEngine,'.env'),'utf8').includes('PORT=3457'),true);assert.equal(fs.readFileSync(path.join(urEngine,'.env'),'utf8').includes('PORT=3458'),true);
 assert.equal(slug('../Hello Channel'),'hello-channel');console.log('PASS isolated per-channel workspaces, credentials/data separation, port collision guard');
}finally{fs.rmSync(root,{recursive:true,force:true});}
