'use strict';
const {loadLocalEnv}=require('../agents/production/local-env');
loadLocalEnv();

const fs=require('node:fs/promises'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {PixabayPool}=require('../agents/production/pixabay-pool');
const {buildMotionFilters}=require('../agents/production/motion-graphics');
const {getRenderProfile}=require('../agents/production/render-profile');
function run(bin,args){const r=spawnSync(bin,args,{stdio:'inherit',windowsHide:true});if(r.error)throw r.error;if(r.status!==0)throw new Error(bin+' exited with '+r.status);}
async function discover(file){const p=JSON.parse(await fs.readFile(file,'utf8')),pool=new PixabayPool();if(!pool.configured)throw new Error('Set PIXABAY_API_KEY and PIXABAY_API_KEY_2 locally.');
 const scenes=[];for(const s of p.scenes){const r=await pool.search(s.footageQuery,{perPage:10});scenes.push({...s,provider:'Pixabay',keySlot:r.keySlot,shortlist:r.items.map(x=>({id:x.id,creator:x.creator,pageUrl:x.pageUrl,durationSeconds:x.durationSeconds,width:x.width,height:x.height,quality:x.quality,tags:x.tags,license:x.license,previewUrl:x.previewUrl})),selectedAssetId:null,rightsApproved:false});}
 const dest=path.join(path.dirname(path.resolve(file)),'asset-selection.json');await fs.writeFile(dest,JSON.stringify({...p,approvalRequired:true,scenes},null,2)+'\n');console.log('Shortlist:',dest,'— select asset IDs and confirm rights manually.');}
async function download(file){const p=JSON.parse(await fs.readFile(file,'utf8')),pool=new PixabayPool(),dir=path.join(path.dirname(path.resolve(file)),'footage');await fs.mkdir(dir,{recursive:true});const manifest=[];
 for(const s of p.scenes){if(!s.selectedAssetId||s.rightsApproved!==true)throw new Error(s.id+' requires selectedAssetId and rightsApproved=true');const r=await pool.search(s.footageQuery,{perPage:20}),item=r.items.find(x=>x.id===Number(s.selectedAssetId));if(!item)throw new Error('Selected ID is no longer in current results: '+s.selectedAssetId);const d=await pool.download(item,{filename:s.id});manifest.push({...d.record,sceneId:s.id,rightsApprovedByUser:true,sourceCredit:s.sourceCredit||{required:true},visualIntent:s.visualIntent||s.visual||'',footageQuery:s.footageQuery||'',shotType:s.shotType||'',movement:s.movement||'',colourGrade:s.colourGrade||''});}
 await fs.writeFile(path.join(dir,'approved-assets.json'),JSON.stringify(manifest,null,2)+'\n');
 const credits=['# Footage source credits','','Review each source page and applicable license before publication.','',...manifest.map(x=>'- **'+x.sceneId+'** — '+(x.creator||'Creator not recorded')+' — '+(x.provider||'Pixabay')+' — '+(x.sourcePage||'Source URL missing')+' — '+(x.license||'License requires review')),''];
 await fs.writeFile(path.join(dir,'source-credits.md'),credits.join('\n'),'utf8');
 console.log('Approved real video clips downloaded:',manifest.length,'| source credits:',manifest.length);}
async function render(file,voice,music,out){
 const base=path.dirname(path.resolve(file)),p=JSON.parse(await fs.readFile(file,'utf8')),manifest=JSON.parse(await fs.readFile(path.join(base,'footage','approved-assets.json'),'utf8'));
 if(!manifest.length)throw new Error('No approved footage manifest');
 if(process.env.DARK_PHYS_PRODUCTION_ENGINE!=='legacy'){
  const {runApprovedProduction}=require('../agents/production/v11-integration');
  const result=await runApprovedProduction({plan:p,manifest,narrationPath:voice,musicPath:music,outputPath:out,projectDir:base});
  console.log('v11 production result:',result.status,'| resumed stages:',(result.resumed||[]).join(', ')||'none','|',result.renderProfile.reason);
  const {productionExitCode}=require('../agents/production/exit-status');
  const exitCode=productionExitCode(result);
  if(exitCode===42)console.error('BATCH HOLD: monetization safety review is required; queued sibling jobs will be held.');
  if(exitCode!==0)process.exitCode=exitCode;
  return;
 }

 const profile=getRenderProfile(),list=path.join(base,'footage','concat-list.txt'),rows=[];
 let totalDuration=0;
 for(const asset of manifest){
  const scene=(p.scenes||[]).find(s=>s.id===asset.sceneId);if(!scene)throw new Error('Approved footage references unknown scene: '+asset.sceneId);
  const f=path.resolve(asset.downloadedFile);await fs.access(f);
  const duration=Math.max(1,Number(scene.durationSeconds)||8);totalDuration+=duration;
  rows.push("file '"+f.replace(/'/g,"'\\''")+"'","duration "+duration.toFixed(3));
 }
 if(rows.length)rows.push(rows[rows.length-2]);
 await fs.writeFile(list,rows.join('\n')+'\n');
 const silent=path.join(base,'footage','picture-track.mp4'),ff=process.env.FFMPEG_PATH||'ffmpeg',graphics=buildMotionFilters(p.scenes,{width:profile.width,height:profile.height}),assFile=path.join(base,'footage','motion-graphics.ass');
 await fs.writeFile(assFile,graphics.ass,'utf8');const subtitlePath=assFile.replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"\\'");
 const videoFilters=['scale='+profile.width+':'+profile.height+':force_original_aspect_ratio=increase','crop='+profile.width+':'+profile.height,'fps='+profile.fps,'format=yuv420p',graphics.filter,"subtitles=filename='"+subtitlePath+"':charenc=UTF-8"].filter(Boolean).join(',');
 run(ff,['-y','-filter_threads',String(profile.filterThreads),'-f','concat','-safe','0','-i',list,'-t',String(totalDuration),'-vf',videoFilters,'-an','-c:v','libx264','-preset',profile.preset,'-crf',String(profile.crf),'-threads',String(profile.threads),silent]);
 const {ffmpegArgs,buildAudioFilter}=require('../agents/production/audio-mix'),sfxFile=process.env.DARK_PHYS_SFX_FILE,sfx=sfxFile?[{path:sfxFile,atSeconds:0,gainDb:-12}]:[];
 run(ff,ffmpegArgs({video:silent,voice,music,output:out,sfx,profile,filter:buildAudioFilter({sfx}).filter}));
 console.log('Draft rendered:',out,'|',profile.mode,profile.width+'x'+profile.height,'|',totalDuration+'s — human review required.');
}
(async()=>{const [cmd,...a]=process.argv.slice(2);if(cmd==='discover')await discover(a[0]);else if(cmd==='download-approved')await download(a[0]);else if(cmd==='render')await render(a[0],a[1],a[2],a[3]);else console.log('Usage: cinematic-production.js discover scene-plan.json | download-approved asset-selection.json | render asset-selection.json narration.wav music.mp3 output.mp4');})().catch(e=>{console.error(e.message);process.exit(1);});
