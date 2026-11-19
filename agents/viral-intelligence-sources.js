'use strict';
/**
 * Official YouTube Data API trend/competitor signal adapter.
 * No scraping, cookies, unofficial endpoints or hard-coded secrets.
 */
const API='https://www.googleapis.com/youtube/v3';
function safeText(v){return String(v||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();}
function parseVideo(item){
 const s=item.snippet||{},st=item.statistics||{};
 const views=Number(st.viewCount||0),likes=st.likeCount===undefined?null:Number(st.likeCount),comments=st.commentCount===undefined?null:Number(st.commentCount);\n const ageDays=s.publishedAt?Math.max(1,(Date.now()-Date.parse(s.publishedAt))/864e5):null;\n return {id:item.id,title:safeText(s.title),description:safeText(s.description).slice(0,500),channelId:s.channelId||'',channelTitle:s.channelTitle||'',publishedAt:s.publishedAt||null,thumbnail:(s.thumbnails?.high||s.thumbnails?.medium||s.thumbnails?.default||{}).url||null,views,likes,comments,ageDays:Number.isFinite(ageDays)?Number(ageDays.toFixed(2)):null,viewsPerDay:Number.isFinite(ageDays)?Math.round(views/ageDays):null,engagementRate:views>0&&likes!==null&&comments!==null?Number(((likes+comments)/views*100).toFixed(3)):null,url:item.id?'https://www.youtube.com/watch?v='+encodeURIComponent(item.id):null};
}
class YouTubeTrendSource{
 constructor({apiKey=process.env.YOUTUBE_DATA_API_KEY,regionCode='US',fetchImpl=globalThis.fetch}={}){this.apiKey=apiKey;this.regionCode=regionCode;this.fetch=fetchImpl;}
 async request(resource,params={}){
  if(!this.apiKey)throw new Error('YOUTUBE_DATA_API_KEY is not configured; add it only during final API setup');
  if(typeof this.fetch!=='function')throw new Error('Node.js fetch is unavailable; use Node 18+');
  const q=new URLSearchParams({...params,key:this.apiKey});
  const response=await this.fetch(API+'/'+resource+'?'+q.toString(),{headers:{accept:'application/json'}});
  if(!response.ok){const body=await response.json().catch(()=>({}));const reason=body.error?.errors?.[0]?.reason||body.error?.message||response.statusText;throw new Error('YouTube Data API '+response.status+' ('+reason+')');}
  return response.json();
 }
 async mostPopular({regionCode=this.regionCode,categoryId,maxResults=25}={}){
  const data=await this.request('videos',{part:'snippet,statistics,contentDetails',chart:'mostPopular',regionCode,maxResults:String(Math.min(50,Math.max(1,maxResults))),...(categoryId?{videoCategoryId:String(categoryId)}:{})});
  return {source:'YouTube Data API videos.list chart=mostPopular',regionCode,observedAt:new Date().toISOString(),items:(data.items||[]).map(parseVideo),nextPageToken:data.nextPageToken||null};
 }
 async search({query,regionCode=this.regionCode,days=7,maxResults=25,order='viewCount'}={}){
  if(!String(query||'').trim())throw new Error('query is required');
  const publishedAfter=new Date(Date.now()-Math.max(1,Math.min(30,days))*864e5).toISOString();
  const data=await this.request('search',{part:'snippet',type:'video',q:String(query).slice(0,200),regionCode,publishedAfter,order,maxResults:String(Math.min(50,Math.max(1,maxResults)))});
  const ids=(data.items||[]).map(x=>x.id?.videoId).filter(Boolean);
  if(!ids.length)return {source:'YouTube Data API search.list + videos.list',regionCode,query,observedAt:new Date().toISOString(),items:[]};
  const detail=await this.request('videos',{part:'snippet,statistics,contentDetails',id:ids.join(',')});
  return {source:'YouTube Data API search.list + videos.list',regionCode,query,observedAt:new Date().toISOString(),items:(detail.items||[]).map(parseVideo)};
 }
 async discover({queries=[],regionCode=this.regionCode,maxResults=25}={}){
  const [popular,...searches]=await Promise.all([this.mostPopular({regionCode,maxResults}),...queries.slice(0,5).map(query=>this.search({query,regionCode,maxResults}))]);
  const seen=new Map();
  for(const item of [...popular.items,...searches.flatMap(x=>x.items)])if(item.id)seen.set(item.id,item);
  return {schemaVersion:1,provider:'youtube-data-api-v3',regionCode,observedAt:new Date().toISOString(),popular,searches,items:[...seen.values()].sort((a,b)=>(b.viewsPerDay??b.views)-(a.viewsPerDay??a.views)),limitations:['Popularity is a platform snapshot, not proof of future virality','Search ranking and view counts are not comparable across all traffic sources, ages or niches','Review titles, channels, dates and source context before assigning editorial scores']};
 }
}
module.exports={YouTubeTrendSource,parseVideo};
