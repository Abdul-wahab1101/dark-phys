'use strict';
const crypto=require('node:crypto');
function slug(s){return String(s||'scene').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,45)||'scene';}
function planScenes(input={}) {
 const title=String(input.title||'').trim(); if(!title) throw new Error('title is required');
 const beats=Array.isArray(input.beats)?input.beats:[];
 if(!beats.length) throw new Error('beats must contain at least one approved narrative beat');
 const scenes=beats.map((b,i)=>{
  const narration=String(b.narration||'').trim(); if(!narration) throw new Error('Each beat needs narration');
  const visual=String(b.visual||b.description||'').trim();
  const query=String(b.footageQuery||visual||title).trim();
  const duration=Math.min(18,Math.max(4,Number(b.durationSeconds)||8));
  return {id:'scene-'+String(i+1).padStart(3,'0'),beat:i+1,narration,visual:visual||query,footageQuery:query,durationSeconds:duration,
   shotType:b.shotType||['wide','medium','detail','tracking'][i%4],movement:b.movement||['slow-push','pan','static','parallax'][i%4],
   overlays:Array.isArray(b.overlays)?b.overlays:[],map:b.map||null,asset:null,needsHumanSelection:true};
 });
 const id=crypto.createHash('sha256').update(title+'\n'+scenes.map(s=>s.narration).join('\n')).digest('hex').slice(0,16);
 return {schemaVersion:1,projectId:id,title,createdAt:new Date().toISOString(),format:{aspectRatio:'16:9',width:1920,height:1080,fps:30},scenes,workflow:{realFootageRequired:true,stillImageSlideshow:false,approvalRequired:['scene-plan','asset-rights','sample-render','final-render'],humanRightsReview:true}};
}
module.exports={planScenes,slug};
