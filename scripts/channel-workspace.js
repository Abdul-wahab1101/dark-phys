'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
function slug(value){return String(value||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40);}
function createWorkspace({id,name,port,sourceEngine=path.join(ROOT,'engines','youtube-automation-agent'),workspaceRoot=path.join(ROOT,'channel-workspaces')}){
 const key=slug(id),label=String(name||'').trim(),number=Number(port);
 if(!key||!label)throw new Error('A valid --id and --name are required');
 if(!Number.isInteger(number)||number<1024||number>65535)throw new Error('Port must be an integer between 1024 and 65535');
 if(!fs.existsSync(path.join(sourceEngine,'index.js'))||!fs.existsSync(path.join(sourceEngine,'node_modules')))throw new Error('Install the primary YouTube engine first with .\\setup-dark-phys.ps1');
 fs.mkdirSync(workspaceRoot,{recursive:true});
 const dest=path.join(workspaceRoot,key,'engine');
 if(fs.existsSync(dest))throw new Error('Workspace already exists: '+key);
 for(const item of fs.readdirSync(workspaceRoot)){const file=path.join(workspaceRoot,item,'channel.json');if(fs.existsSync(file)){const other=JSON.parse(fs.readFileSync(file,'utf8'));if(Number(other.port)===number)throw new Error('Port '+number+' is already assigned to '+item);}}
 fs.mkdirSync(path.dirname(dest),{recursive:true});
 const excluded=new Set(['node_modules','data','config','uploads','logs','.git']);
 fs.cpSync(sourceEngine,dest,{recursive:true,filter:src=>{const rel=path.relative(sourceEngine,src).split(path.sep);return !rel.some(part=>excluded.has(part))&&path.basename(src)!=='.env'&&!/\\.db$/.test(src);}});
 fs.mkdirSync(path.join(dest,'config'),{recursive:true});
 fs.mkdirSync(path.join(dest,'data'),{recursive:true});
 fs.symlinkSync(path.resolve(sourceEngine,'node_modules'),path.join(dest,'node_modules'),process.platform==='win32'?'junction':'dir');
 const record={id:key,name:label,port:number,createdAt:new Date().toISOString(),enginePath:dest};
 fs.writeFileSync(path.join(path.dirname(dest),'channel.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx'});
 fs.writeFileSync(path.join(dest,'.env'),['HOST=127.0.0.1','PORT='+number,'DEFAULT_PRIVACY_STATUS=private','ANONYMOUS_TELEMETRY_ENABLED=false',''].join('\n'),{flag:'wx'});
 return record;
}
function listWorkspaces(workspaceRoot=path.join(ROOT,'channel-workspaces')){
 if(!fs.existsSync(workspaceRoot))return [];
 return fs.readdirSync(workspaceRoot,{withFileTypes:true}).filter(x=>x.isDirectory()).flatMap(x=>{const file=path.join(workspaceRoot,x.name,'channel.json');if(!fs.existsSync(file))return [];try{return[JSON.parse(fs.readFileSync(file,'utf8'))];}catch(_){return[];}});
}
function startWorkspace({id,workspaceRoot=path.join(ROOT,'channel-workspaces'),node=process.execPath}){
 const key=slug(id),record=listWorkspaces(workspaceRoot).find(x=>x.id===key);
 if(!record)throw new Error('Unknown channel workspace: '+key+' (run create first)');
 const engine=record.enginePath;
 if(!fs.existsSync(path.join(engine,'index.js'))||!fs.existsSync(path.join(engine,'node_modules')))throw new Error('Workspace engine/dependencies are missing');
 const child=spawn(node,['index.js'],{cwd:engine,env:{...process.env,HOST:'127.0.0.1',PORT:String(record.port),DARK_PHYS_CHANNEL_ID:key},stdio:'inherit'});
 return child;
}
function arg(args,key){const i=args.indexOf('--'+key);return i<0?'':args[i+1]||'';}
async function main(argv=process.argv.slice(2)){
 const cmd=argv[0];
 if(cmd==='create'){const r=createWorkspace({id:arg(argv,'id'),name:arg(argv,'name'),port:arg(argv,'port')});console.log('Created isolated channel workspace:',JSON.stringify(r,null,2));console.log('Run the workspace once and complete its own credentials: npm run walkthrough');return;}
 if(cmd==='list'){console.log(JSON.stringify(listWorkspaces(),null,2));return;}
 if(cmd==='start'){const child=startWorkspace({id:arg(argv,'id')});child.on('exit',code=>{process.exitCode=code||0;});child.on('error',e=>{console.error(e.message);process.exitCode=1;});return;}
 console.log('Usage:\n  node scripts/channel-workspace.js create --id dark-phys-en --name "Dark Phys English" --port 3457\n  node scripts/channel-workspace.js list\n  node scripts/channel-workspace.js start --id dark-phys-en');
 process.exitCode=2;
}
if(require.main===module)main().catch(e=>{console.error('Channel workspace:',e.message);process.exitCode=1;});
module.exports={createWorkspace,listWorkspaces,startWorkspace,slug};
