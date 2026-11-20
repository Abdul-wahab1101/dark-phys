'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {loadLocalEnv}=require('../agents/production/local-env');
const root='/fake/dark-phys';
const files=new Map([
 [path.join(root,'.env'),'ROOT_SHARED=root-value\nROOT_ONLY=from-root\nEMPTY=\nQUOTED="quoted value"\n'],
 [path.join(root,'engines','youtube-automation-agent','.env'),'ROOT_SHARED=engine-value\nENGINE_ONLY=from-engine\nexport PIXABAY_API_KEY=private-key\n']
]);
const env={ROOT_SHARED:'process-value',PROCESS_ONLY:'keep-me'};
const result=loadLocalEnv({root,env,exists:file=>files.has(file),readFile:file=>files.get(file)});
assert.equal(env.ROOT_SHARED,'process-value');
assert.equal(env.ROOT_ONLY,'from-root');
assert.equal(env.ENGINE_ONLY,'from-engine');
assert.equal(env.PIXABAY_API_KEY,'private-key');
assert.equal(env.QUOTED,'quoted value');
assert.equal(env.EMPTY,undefined);
assert.equal(env.PROCESS_ONLY,'keep-me');
assert.equal(result.loadedFiles.length,2);
console.log('PASS local environment loading: process precedence, root/upstream files, export syntax, quoted values and blank-key rejection');
