const THEMES=[
 {id:'cinematic',bg:'#111827',accent:'#F59E0B',ink:'#FFFFFF',eyebrow:'THE BIG QUESTION'},
 {id:'editorial',bg:'#F3EBDD',accent:'#B45309',ink:'#171717',eyebrow:'BEHIND THE STORY'},
 {id:'bold-contrast',bg:'#0B0B0B',accent:'#E11D48',ink:'#FFFFFF',eyebrow:'WHAT YOU MISSED'}
];
function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function render(title,subtitle,theme,index){
 const lines=title.toUpperCase().split(/\s+/).reduce((a,w)=>{let i=a.length-1;if((a[i]+' '+w).trim().length>17)a.push(w);else a[i]=(a[i]+' '+w).trim();return a;},['']).slice(0,4);
 const text=lines.map((line,i)=>'<text x="76" y="'+(360+i*88)+'" font-family="Arial,sans-serif" font-size="76" font-weight="900" fill="'+theme.ink+'">'+esc(line)+'</text>').join('');
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="'+theme.bg+'"/><stop offset="1" stop-color="'+theme.accent+'" stop-opacity=".72"/></linearGradient><pattern id="p" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.4" fill="'+theme.ink+'" opacity=".16"/></pattern></defs><rect width="1280" height="720" fill="url(#g)"/><rect width="1280" height="720" fill="url(#p)"/><path d="M900 0 L1280 0 L1280 720 L1050 720 Z" fill="'+theme.accent+'" opacity=".22"/><rect x="76" y="86" width="12" height="92" rx="6" fill="'+theme.accent+'"/><text x="112" y="140" font-family="Arial,sans-serif" font-size="25" font-weight="700" letter-spacing="5" fill="'+theme.ink+'">'+esc(theme.eyebrow)+'</text>'+text+'<text x="80" y="655" font-family="Arial,sans-serif" font-size="25" fill="'+theme.ink+'" opacity=".8">'+esc(subtitle||'DOCUMENTARY • EXPLAINED')+'</text><circle cx="1120" cy="160" r="78" fill="none" stroke="'+theme.accent+'" stroke-width="10"/><text x="1120" y="171" text-anchor="middle" font-family="Arial" font-size="32" font-weight="900" fill="'+theme.ink+'">'+(index+1)+'</text></svg>';
 return svg;
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(request.method==='GET'&&url.pathname==='/health')return Response.json({ok:true,service:'dark-phys-thumbnail-worker',version:1});
  if(request.method!=='POST'||url.pathname!=='/v1/concepts')return new Response('Not found',{status:404});
  if(env.API_TOKEN&&request.headers.get('Authorization')!=='Bearer '+env.API_TOKEN)return new Response('Unauthorized',{status:401});
  let body;try{body=await request.json();}catch{return Response.json({error:'Expected JSON body'},{status:400});}
  const title=String(body.title||'').trim(),subtitle=String(body.subtitle||'').trim();
  if(title.length<4||title.length>90||subtitle.length>90)return Response.json({error:'title must be 4-90 chars; subtitle max 90'},{status:400});
  const concepts=THEMES.map((theme,index)=>({id:theme.id,width:1280,height:720,format:'svg',svg:render(title,subtitle,theme,index)}));
  return Response.json({concepts,requiresHumanSelection:true,disclaimer:'Concept drafts only. Check factual accuracy, rights, readability and advertiser suitability before use.'},{headers:{'Cache-Control':'no-store'}});
 }
};
