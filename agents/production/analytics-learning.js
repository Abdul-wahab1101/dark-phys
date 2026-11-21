'use strict';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function num(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function rate(v){if(typeof v==='string'&&v.trim().endsWith('%')){const n=Number(v.trim().slice(0,-1));return Number.isFinite(n)?n/100:null;}const n=num(v);return n===null?null:(n>1&&n<=100?n/100:n);}
function normalizeRetention(retention=[]){
 return (Array.isArray(retention)?retention:[]).map(r=>{
  let timeRatio=num(r.elapsedVideoTimeRatio??r.timeRatio),watchRatio=rate(r.audienceWatchRatio??r.watchRatio);
  if(timeRatio!==null&&timeRatio>1&&timeRatio<=100)timeRatio/=100;
  return {timeRatio,watchRatio};
 }).filter(r=>r.timeRatio!==null&&r.watchRatio!==null&&r.timeRatio>=0&&r.timeRatio<=1)
 .sort((a,b)=>a.timeRatio-b.timeRatio);
}
function normalizeVideo(row){
 const status=String(row.status||row.privacyStatus||row.privacy_status||'').toLowerCase();
 return {videoId:String(row.videoId||row.video_id||''),title:String(row.title||''),views:num(row.views),impressions:num(row.impressions),
  ctr:rate(row.ctr??row.impressionsCtr??row.impressions_ctr??row.impressionsClickThroughRate),
  averageViewDurationSeconds:num(row.averageViewDurationSeconds??row.average_view_duration??row.averageViewDuration),
  averageViewPercentage:num(row.averageViewPercentage??row.average_view_percentage),
  retention:normalizeRetention(row.retention),publishedAt:row.publishedAt||row.published_at||row.publishTime||null,
  published:row.published===false||['private','unlisted','draft','scheduled','unpublished'].includes(status)?false:true};
}
function mapDropoffs(retention=[],beats=[]){
 const rows=normalizeRetention(retention),drops=[];
 for(let i=1;i<rows.length;i++){
  const delta=rows[i].watchRatio-rows[i-1].watchRatio;
  if(delta<=-0.08){
   const ratio=rows[i].timeRatio;
   const beat=beats.find(b=>ratio>=Number(b.startRatio??0)&&ratio<=Number(b.endRatio??1))||null;
   drops.push({timeRatio:ratio,drop:Number(delta.toFixed(3)),dropPercentagePoints:Number((delta*100).toFixed(1)),
    scriptBeat:beat?String(beat.title||beat.name||'Untitled beat'):null,
    beatStartRatio:beat?Number(beat.startRatio??0):null,beatEndRatio:beat?Number(beat.endRatio??1):null});
  }
 }
 return drops;
}
function median(values){const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!sorted.length)return null;const m=Math.floor(sorted.length/2);return sorted.length%2?sorted[m]:(sorted[m-1]+sorted[m])/2;}
function aggregateRetention(videos,bins=10){
 return Array.from({length:bins+1},(_,i)=>{
  const timeRatio=i/bins,values=[];
  for(const video of videos){
   const nearest=video.retention.reduce((best,p)=>!best||Math.abs(p.timeRatio-timeRatio)<Math.abs(best.timeRatio-timeRatio)?p:best,null);
   if(nearest&&Math.abs(nearest.timeRatio-timeRatio)<=0.075)values.push(nearest.watchRatio);
  }
  return {timeRatio:Number(timeRatio.toFixed(2)),medianAudienceWatchRatio:median(values),sampleVideos:values.length};
 });
}
function analyzeAnalytics({videos=[],scriptBeatsByVideo={},minimumVideos=15}={}){
 const threshold=Math.max(15,Number(minimumVideos)||15),byId=new Map();
 for(const source of videos){
  const row=normalizeVideo(source);if(!row.videoId||!row.published)continue;
  const usable=row.views!==null||row.impressions!==null||row.ctr!==null||row.averageViewDurationSeconds!==null||row.averageViewPercentage!==null||row.retention.length>0;
  if(!usable)continue;
  const prior=byId.get(row.videoId);
  if(!prior){byId.set(row.videoId,row);continue;}
  const merged={...prior};
  for(const key of ['title','views','impressions','ctr','averageViewDurationSeconds','averageViewPercentage','publishedAt'])if((merged[key]===null||merged[key]==='')&&row[key]!==null&&row[key]!=='')merged[key]=row[key];
  if(row.retention.length>merged.retention.length)merged.retention=row.retention;
  byId.set(row.videoId,merged);
 }
 const normalized=[...byId.values()],count=normalized.length,eligible=count>=threshold;
 const mean=key=>{const values=normalized.map(v=>v[key]).filter(v=>v!==null);return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;};
 const sumKnown=key=>{const values=normalized.map(v=>v[key]).filter(v=>v!==null);return values.length?values.reduce((a,b)=>a+b,0):null;};
 const rows=normalized.map(v=>({videoId:v.videoId,title:v.title,views:v.views,impressions:v.impressions,ctr:v.ctr,
  averageViewDurationSeconds:v.averageViewDurationSeconds,averageViewPercentage:v.averageViewPercentage,
  retentionCurve:v.retention,retentionPoints:v.retention.length,dropoffs:mapDropoffs(v.retention,scriptBeatsByVideo[v.videoId]||[])}));
 const ctrRows=normalized.filter(v=>v.ctr!==null&&v.impressions!==null&&v.impressions>0),weightedImpressions=ctrRows.reduce((s,v)=>s+v.impressions,0);
 const weightedCtr=weightedImpressions>0?ctrRows.reduce((s,v)=>s+v.ctr*v.impressions,0)/weightedImpressions:null;
 const metrics={videoCount:count,meanCtr:mean('ctr'),medianCtr:median(normalized.map(v=>v.ctr)),weightedCtr,
  meanAverageViewDurationSeconds:mean('averageViewDurationSeconds'),medianAverageViewDurationSeconds:median(normalized.map(v=>v.averageViewDurationSeconds)),
  meanAverageViewPercentage:mean('averageViewPercentage'),totalViews:sumKnown('views'),totalImpressions:sumKnown('impressions')};
 const dropoffCounts={};for(const v of rows)for(const d of v.dropoffs)if(d.scriptBeat)dropoffCounts[d.scriptBeat]=(dropoffCounts[d.scriptBeat]||0)+1;
 const recurringDropoffs=Object.entries(dropoffCounts).map(([scriptBeat,videosAffected])=>({scriptBeat,videosAffected,share:Number((videosAffected/Math.max(1,count)).toFixed(3))})).sort((a,b)=>b.videosAffected-a.videosAffected);
 return {version:2,source:'owner-supplied-youtube-analytics-data',metrics,videos:rows,
  retentionSummary:aggregateRetention(normalized),recurringDropoffs,
  learningGate:{minimumVideos:threshold,observedVideos:count,eligible,ruleChangesAllowed:eligible,automaticChangesAllowed:false,
   reason:eligible?'15+ unique published videos observed; recommendations are advisory and every change requires owner approval.':'Insufficient published-video sample. Do not change channel strategy, title rules, pacing or publishing cadence before at least '+threshold+' videos.'},
  recommendations:eligible?recurringDropoffs.slice(0,5).map(x=>({type:'investigate_script_beat_dropoff',...x,automaticChange:false,approvalRequired:true})):[]};
}
module.exports={normalizeVideo,normalizeRetention,mapDropoffs,aggregateRetention,analyzeAnalytics,rate};