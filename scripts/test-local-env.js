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
const {parseEnv}=require('../agents/local-secrets');
const parsedSecrets=parseEnv('GEMINI_API_KEY=gemini-one\nGEMINI_API_KEY_2=gemini-two\nPIXABAY_API_KEY=pix-one\nPIXABAY_API_KEY_2=pix-two\nCLOUDFLARE_WORKER_URL=https://worker.example\nCLOUDFLARE_WORKER_TOKEN=cf-token\nNOT_ALLOWED=ignore');
assert.deepEqual(Object.keys(parsedSecrets).sort(),['CLOUDFLARE_WORKER_TOKEN','CLOUDFLARE_WORKER_URL','GEMINI_API_KEY','GEMINI_API_KEY_2','PIXABAY_API_KEY','PIXABAY_API_KEY_2'].sort());
assert.equal(parsedSecrets.NOT_ALLOWED,undefined);
console.log('PASS local environment loading: process precedence, root/upstream files, export syntax, quoted values and blank-key rejection');

for (const cli of ['stock-footage.js','pixabay-pool.js','viral-trends.js']) {
  const source=fs.readFileSync(path.join(__dirname,cli),'utf8');
  assert(source.includes("require('../agents/production/local-env')")&&source.includes('loadLocalEnv();'),cli+' must load local project API keys before provider initialization');
  if(cli==='viral-trends.js')assert(/^#!\/usr\/bin\/env node\r?\n/.test(source), 'viral-trends executable shebang must remain the first line');
  if(cli==='viral-trends.js')assert.equal((source.match(/'use strict';/g)||[]).length,1,'viral-trends should retain exactly one strict-mode directive');
}
const pythonCli=fs.readFileSync(path.join(__dirname,'channel-intelligence.py'),'utf8');
assert(pythonCli.includes('def load_project_env():')&&pythonCli.includes('load_project_env()'),'Python research CLI must load root/upstream .env keys before importing research providers');
console.log('PASS provider CLI environment handoff for Pixabay, YouTube trends and Python channel research');
