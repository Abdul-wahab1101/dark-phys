'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
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

for (const cli of ['stock-footage.js','pixabay-pool.js','viral-trends.js']) {
  const source=fs.readFileSync(path.join(__dirname,cli),'utf8');
  assert(source.includes("require('../agents/production/local-env')")&&source.includes('loadLocalEnv();'),cli+' must load local project API keys before provider initialization');
}
const pythonCli=fs.readFileSync(path.join(__dirname,'channel-intelligence.py'),'utf8');
assert(pythonCli.includes('def load_project_env():')&&pythonCli.includes('load_project_env()'),'Python research CLI must load root/upstream .env keys before importing research providers');
console.log('PASS provider CLI environment handoff for Pixabay, YouTube trends and Python channel research');
