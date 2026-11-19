'use strict';
function esc(value) {
 return String(value == null ? '' : value).replace(/\\/g,'\\\\').replace(/:/g,'\\:').replace(/'/g,"\\'").replace(/%/g,'\\%').replace(/,/g,'\\,').replace(/\[/g,'\\[').replace(/\]/g,'\\]');
}
function time(value){return Math.max(0,Number(value)||0).toFixed(3);}
/** Animated lower-thirds, timed callouts and schematic route-map overlays for FFmpeg. */
function buildMotionFilters(scenes,options={}) {
 if(!Array.isArray(scenes))throw new Error('scenes must be an array');
 const width=Math.max(320,Number(options.width)||1920),height=Math.max(180,Number(options.height)||1080),filters=[];let cursor=0;
 for(const scene of scenes){
  const duration=Math.max(1,Number(scene.durationSeconds)||8),start=cursor,end=cursor+duration;
  const title=String(scene.title||scene.visual||scene.footageQuery||'').trim();
  if(title){
   const alpha="if(lt(t\\,"+time(start+.45)+")\\,max(0\\,(t-"+time(start)+")/.45)\\,if(lt(t\\,"+time(end-.35)+")\\,1\\,max(0\\,("+time(end)+"-t)/.35)))";
   filters.push("drawbox=x=0:y=h-"+Math.round(height*.19)+":w=w:h="+Math.round(height*.19)+":color=black@0.48:t=fill:enable='between(t,"+time(start)+","+time(end)+")'");
   filters.push("drawtext=text='"+esc(title.slice(0,100))+"':x="+Math.round(width*.055)+"+(1-"+alpha+")*36:y=h-"+Math.round(height*.105)+":fontsize="+Math.round(height*.043)+":fontcolor=white:shadowcolor=black@0.8:shadowx=2:shadowy=2:alpha='"+alpha+"':enable='between(t,"+time(start)+","+time(end)+")'");
  }
  for(const overlay of (Array.isArray(scene.overlays)?scene.overlays:[])){
   if(!overlay||!String(overlay.text||'').trim())continue;
   const y=overlay.position==='top'?Math.round(height*.09):Math.round(height*.82);
   filters.push("drawtext=text='"+esc(String(overlay.text).slice(0,120))+"':x=(w-text_w)/2:y="+y+":fontsize="+Math.round(height*.032)+":fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=18:enable='between(t,"+time(start)+","+time(end)+")'");
  }
  const map=scene.map;
  if(map&&Array.isArray(map.points)&&map.points.length>=2){
   const cw=Math.round(width*.29),ch=Math.round(height*.21),left=Math.round(width*.055),top=Math.round(height*.07);
   filters.push("drawbox=x="+left+":y="+top+":w="+cw+":h="+ch+":color=0x101827@0.88:t=fill:enable='between(t,"+time(start)+","+time(end)+")'");
   filters.push("drawtext=text='"+esc(String(map.title||'LOCATION').slice(0,40))+"':x="+(left+22)+":y="+(top+18)+":fontsize="+Math.round(height*.021)+":fontcolor=0x67e8f9:enable='between(t,"+time(start)+","+time(end)+")'");
   const pts=map.points.slice(0,6).map(p=>({x:left+28+Math.round(Math.max(0,Math.min(1,Number(p.x)||0))*(cw-56)),y:top+62+Math.round(Math.max(0,Math.min(1,Number(p.y)||0))*(ch-88)),label:String(p.label||'').slice(0,28)}));
   pts.forEach((p,i)=>{
    const reveal=start+Math.min(duration*.7,i*.55);
    filters.push("drawbox=x="+(p.x-6)+":y="+(p.y-6)+":w=12:h=12:color=0x22d3ee:t=fill:enable='between(t,"+time(reveal)+","+time(end)+")'");
    if(p.label)filters.push("drawtext=text='"+esc(p.label)+"':x="+(p.x+10)+":y="+(p.y-10)+":fontsize="+Math.round(height*.017)+":fontcolor=white:enable='between(t,"+time(reveal)+","+time(end)+")'");
    if(i>0){const prev=pts[i-1];filters.push("drawbox=x="+Math.min(prev.x,p.x)+":y="+(prev.y-2)+":w="+Math.max(1,Math.abs(p.x-prev.x))+":h=4:color=0x22d3ee:t=fill:enable='between(t,"+time(reveal)+","+time(end)+")'");filters.push("drawbox=x="+(p.x-2)+":y="+Math.min(prev.y,p.y)+":w=4:h="+Math.max(1,Math.abs(p.y-prev.y))+":color=0x22d3ee:t=fill:enable='between(t,"+time(reveal)+","+time(end)+")'");}
   });
  }
  cursor=end;
 }
 return {filter:filters.join(','),durationSeconds:cursor,overlayCount:filters.length};
}
module.exports={buildMotionFilters,esc};
