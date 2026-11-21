const THEMES=[
 {id:'cinematic',bg:'#111827',accent:'#F59E0B',ink:'#FFFFFF',eyebrow:'THE BIG QUESTION'},
 {id:'editorial',bg:'#F3EBDD',accent:'#B45309',ink:'#171717',eyebrow:'BEHIND THE STORY'},
 {id:'bold-contrast',bg:'#0B0B0B',accent:'#E11D48',ink:'#FFFFFF',eyebrow:'WHAT YOU MISSED'}
];
function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function wrapTitle(value){
 const words=String(value||'').trim().toUpperCase().split(/\s+/),lines=[];let line='';
 for(const word of words){
  if(word.length>17)return null;
  if(line&&line.length+1+word.length>17){lines.push(line);line=word;}
  else line=(line+' '+word).trim();
 }
 if(line)lines.push(line);
 return lines.length>=1&&lines.length<=4?lines:null;
}
function render(title,subtitle,theme,index){
 const lines=wrapTitle(title);
 const text=lines.map((line,i)=>'<text x="76" y="'+(350+i*78)+'" font-family="Arial,sans-serif" font-size="72" font-weight="900" fill="'+theme.ink+'">'+esc(line)+'</text>').join('');
 return '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="'+theme.bg+'"/><stop offset="1" stop-color="'+theme.accent+'" stop-opacity=".72"/></linearGradient><pattern id="p" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.4" fill="'+theme.ink+'" opacity=".16"/></pattern></defs><rect width="1280" height="720" fill="url(#g)"/><rect width="1280" height="720" fill="url(#p)"/><path d="M900 0 L1280 0 L1280 720 L1050 720 Z" fill="'+theme.accent+'" opacity=".22"/><rect x="76" y="86" width="12" height="92" rx="6" fill="'+theme.accent+'"/><text x="112" y="140" font-family="Arial,sans-serif" font-size="25" font-weight="700" letter-spacing="5" fill="'+theme.ink+'">'+esc(theme.eyebrow)+'</text>'+text+'<text x="80" y="655" font-family="Arial,sans-serif" font-size="25" fill="'+theme.ink+'" opacity=".8">'+esc(subtitle||'DOCUMENTARY • EXPLAINED')+'</text><circle cx="1120" cy="160" r="78" fill="none" stroke="'+theme.accent+'" stroke-width="10"/><text x="1120" y="171" text-anchor="middle" font-family="Arial" font-size="32" font-weight="900" fill="'+theme.ink+'">'+(index+1)+'</text></svg>';
}
function json(data,status=200){
 return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(request.method==='GET'&&url.pathname==='/health')return json({ok:true,service:'dark-phys-thumbnail-worker',version:2});
  if(request.method!=='POST'||url.pathname!=='/v1/concepts')return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  if(!env.API_TOKEN)return new Response('Worker secret API_TOKEN is not configured',{status:503,headers:{'Cache-Control':'no-store'}});
  if(request.headers.get('Authorization')!=='Bearer '+env.API_TOKEN)return new Response('Unauthorized',{status:401,headers:{'Cache-Control':'no-store'}});
  const declared=Number(request.headers.get('Content-Length')||0);
  if(declared>4096)return json({error:'Request body is too large' },413);
  let raw;try{raw=await request.text();}catch{return json({error:'Could not read request body'},400);}
  if(raw.length>4096)return json({error:'Request body is too large'},413);
  let body;try{body=JSON.parse(raw);}catch{return json({error:'Expected valid JSON body'},400);}
  if(!body||typeof body!=='object'||Array.isArray(body))return json({error:'Expected a JSON object'},400);
  if(typeof body.title!=='string'||(body.subtitle!==undefined&&typeof body.subtitle!=='string'))return json({error:'title and subtitle must be strings'},400);
  const title=body.title.trim(),subtitle=(body.subtitle||'').trim();
  if(title.length<4||title.length>72||subtitle.length>90)return json({error:'title must be 4-72 chars; subtitle max 90'},400);
  if(!wrapTitle(title))return json({error:'Title must fit four readable lines; avoid words longer than 17 characters'},400);
  const concepts=THEMES.map((theme,index)=>({id:theme.id,width:1280,height:720,format:'svg',svg:render(title,subtitle,theme,index)}));
  return json({concepts,requiresHumanSelection:true,disclaimer:'Concept drafts only. Check factual accuracy, rights, readability and advertiser suitability before use.'});
 }
};
