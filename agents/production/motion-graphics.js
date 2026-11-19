'use strict';
function time(value){const t=Math.max(0,Number(value)||0),h=Math.floor(t/3600),m=Math.floor((t%3600)/60),s=t%60;return h+':'+String(m).padStart(2,'0')+':'+String(Math.floor(s)).padStart(2,'0')+'.'+String(Math.floor((s%1)*100)).padStart(2,'0');}
function assText(value){return String(value==null?'':value).replace(/\\/g,'\\\\').replace(/{/g,'\\{').replace(/}/g,'\\}').replace(/\r?\n/g,'\\N').slice(0,180);}
function buildMotionFilters(scenes,options={}){
 if(!Array.isArray(scenes))throw new Error('scenes must be an array');
 const width=Math.max(320,Number(options.width)||1920),height=Math.max(180,Number(options.height)||1080),filters=[],events=[];let cursor=0;
 const add=(start,end,style,text,effect='')=>{if(String(text||'').trim())events.push('Dialogue: 0,'+time(start)+','+time(end)+','+style+',,0,0,0,,'+effect+assText(text));};
 for(const scene of scenes){
  const duration=Math.max(1,Number(scene.durationSeconds)||8),start=cursor,end=cursor+duration;
  const title=String(scene.title||scene.visual||scene.footageQuery||'').trim();
  if(title){
   const y=Math.round(height*.84),x1=Math.round(width*.055),x2=Math.round(width*.07);
   filters.push("drawbox=x=0:y=ih-"+Math.round(height*.19)+":w=iw:h="+Math.round(height*.19)+":color=black@0.48:t=fill:enable='between(t,"+start.toFixed(3)+","+end.toFixed(3)+")'");
   add(start,end,'LowerThird',title,'{\\fad(450,350)\\move('+x1+','+y+','+x2+','+y+',0,450)}');
  }
  for(const overlay of (Array.isArray(scene.overlays)?scene.overlays:[])){
   if(!overlay||!String(overlay.text||'').trim())continue;
   const x=Math.round(width*.5),y=overlay.position==='top'?Math.round(height*.12):Math.round(height*.78);
   add(start,end,'Callout',overlay.text,'{\\an8\\fad(250,250)\\pos('+x+','+y+')}');
  }
  const map=scene.map;
  if(map&&Array.isArray(map.points)&&map.points.length>=2){
   const cw=Math.round(width*.29),ch=Math.round(height*.21),left=Math.round(width*.055),top=Math.round(height*.07);
   filters.push("drawbox=x="+left+":y="+top+":w="+cw+":h="+ch+":color=0x101827@0.88:t=fill:enable='between(t,"+start.toFixed(3)+","+end.toFixed(3)+")'");
   add(start,end,'MapTitle',map.title||'LOCATION','{\\fad(200,200)\\pos('+(left+22)+','+(top+16)+')}');
   const pts=map.points.slice(0,6).map(p=>({x:left+28+Math.round(Math.max(0,Math.min(1,Number(p.x)||0))*(cw-56)),y:top+62+Math.round(Math.max(0,Math.min(1,Number(p.y)||0))*(ch-88)),label:String(p.label||'').slice(0,28)}));
   pts.forEach((p,i)=>{
    const reveal=start+Math.min(duration*.7,i*.55);
    filters.push("drawbox=x="+(p.x-6)+":y="+(p.y-6)+":w=12:h=12:color=0x22d3ee:t=fill:enable='between(t,"+reveal.toFixed(3)+","+end.toFixed(3)+")'");
    if(p.label)add(reveal,end,'MapLabel',p.label,'{\\fad(150,150)\\pos('+(p.x+12)+','+(p.y-14)+')}');
    if(i>0){const prev=pts[i-1];filters.push("drawbox=x="+Math.min(prev.x,p.x)+":y="+(prev.y-2)+":w="+Math.max(1,Math.abs(p.x-prev.x))+":h=4:color=0x22d3ee:t=fill:enable='between(t,"+reveal.toFixed(3)+","+end.toFixed(3)+")'");filters.push("drawbox=x="+(p.x-2)+":y="+Math.min(prev.y,p.y)+":w=4:h="+Math.max(1,Math.abs(p.y-prev.y))+":color=0x22d3ee:t=fill:enable='between(t,"+reveal.toFixed(3)+","+end.toFixed(3)+")'");}
   });
  }
  cursor=end;
 }
 const ass=['[Script Info]','ScriptType: v4.00+','WrapStyle: 2','ScaledBorderAndShadow: yes','PlayResX: '+width,'PlayResY: '+height,'',
 '[V4+ Styles]','Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
 'Style: LowerThird,Arial,'+Math.round(height*.043)+',&H00FFFFFF,&H0000FFFF,&H80000000,&H70000000,-1,0,0,0,100,100,0,0,3,1,1,7,24,24,12,1',
 'Style: Callout,Arial,'+Math.round(height*.034)+',&H00FFFFFF,&H0000FFFF,&H80000000,&H70000000,-1,0,0,0,100,100,0,0,1,2,1,8,24,24,12,1',
 'Style: MapTitle,Arial,'+Math.round(height*.022)+',&H0000E8FF,&H0000FFFF,&H80000000,&H00000000,-1,0,0,0,100,100,0,0,1,1,0,7,10,10,10,1',
 'Style: MapLabel,Arial,'+Math.round(height*.017)+',&H00FFFFFF,&H0000FFFF,&H80000000,&H00000000,-1,0,0,0,100,100,0,0,1,1,0,7,10,10,10,1','',
 '[Events]','Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',...events].join('\n')+'\n';
 return {filter:filters.join(','),ass,durationSeconds:cursor,overlayCount:filters.length+events.length};
}
module.exports={buildMotionFilters,assText,time};
