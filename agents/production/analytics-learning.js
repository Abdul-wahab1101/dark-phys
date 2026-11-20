'use strict';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function normalizeVideo(row){
 return {videoId:String(row.videoId||row.video_id||''),title:String(row.title||''),views:num(row.views),impressions:num(row.impressions),ctr:num(row.ctr??row.impressionsCtr??row.impressions_ctr),averageViewDurationSeconds:num(row.averageViewDurationSeconds??row.average_view_duration),averageViewPercentage:num(row.averageViewPercentage??row.average_view_percentage),retention:Array.isArray(row.retention)?row.retention:[],publishedAt:row.publishedAt||row.published_at||null};
}
function mapDropoffs(retention=[],beats=[]){
 const rows=retention.map(r=>({timeRatio:num(r.elapsedVideoTimeRatio??r.timeRatio),watchRatio:num(r.audienceWatchRatio??r.watchRatio)})).filter(r=>r.timeRatio!==null&&r.watchRatio!==null).sort((a,b)=>a.timeRatio-b.timeRatio);
 const drops=[];
 for(let i=1;i<rows.length;i++){const delta=rows[i].watchRatio-rows[i-1].watchRatio;if(delta<=-0.08){const ratio=rows[i].timeRatio;const beat=beats.find(b=>ratio>=Number(b.startRatio??0)&&ratio<=Number(b.endRatio??1))||null;drops.push({timeRatio:ratio,drop:Number(delta.toFixed(3)),scriptBeat:beat?String(beat.title||beat.name||'Untitled beat'):null,beatStartRatio:beat?Number(beat.startRatio??0):null});}}
 return drops;
}
function analyzeAnalytics({videos=[],scriptBeatsByVideo={},minimumVideos=15}={}){
 const byId=new Map();
 for (const row of videos.map(normalizeVideo)) {
  if (!row.videoId) continue;
  const usable = row.views !== null || row.impressions !== null || row.ctr !== null ||
    row.averageViewDurationSeconds !== null || row.averageViewPercentage !== null || row.retention.length > 0;
  if (usable) byId.set(row.videoId, row);
 }
 const normalized=[...byId.values()];
 const count=normalized.length,eligible=count>=minimumVideos;
 const mean=key=>{const values=normalized.map(v=>v[key]).filter(v=>v!==null);return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;};
 const rows=normalized.map(v=>({videoId:v.videoId,title:v.title,views:v.views,impressions:v.impressions,ctr:v.ctr,averageViewDurationSeconds:v.averageViewDurationSeconds,averageViewPercentage:v.averageViewPercentage,dropoffs:mapDropoffs(v.retention,scriptBeatsByVideo[v.videoId]||[])}));
 const totalImpressions=normalized.reduce((s,v)=>s+(v.impressions||0),0);
 const weightedCtr=totalImpressions>0?normalized.reduce((s,v)=>s+(v.ctr||0)*(v.impressions||0),0)/totalImpressions:null;
 const metrics={videoCount:count,meanCtr:mean('ctr'),weightedCtr,meanAverageViewDurationSeconds:mean('averageViewDurationSeconds'),meanAverageViewPercentage:mean('averageViewPercentage'),totalViews:normalized.reduce((s,v)=>s+(v.views||0),0),totalImpressions};
 const dropoffCounts={};for(const v of rows)for(const d of v.dropoffs)if(d.scriptBeat)dropoffCounts[d.scriptBeat]=(dropoffCounts[d.scriptBeat]||0)+1;
 const recurringDropoffs=Object.entries(dropoffCounts).map(([scriptBeat,videosAffected])=>({scriptBeat,videosAffected,share:Number((videosAffected/Math.max(1,count)).toFixed(3))})).sort((a,b)=>b.videosAffected-a.videosAffected);
 return {version:1,source:'owner-supplied-youtube-analytics-data',metrics,videos:rows,recurringDropoffs,learningGate:{minimumVideos,observedVideos:count,eligible,ruleChangesAllowed:false,reason:eligible?'Evidence threshold met; recommendations remain advisory and require owner approval.':'Insufficient sample. Do not change channel strategy, title rules, pacing or publishing cadence before at least '+minimumVideos+' videos.'},recommendations:eligible?recurringDropoffs.slice(0,5).map(x=>({type:'investigate_script_beat_dropoff',...x,automaticChange:false,approvalRequired:true})):[]};
}
module.exports={normalizeVideo,mapDropoffs,analyzeAnalytics};
