'use strict';
const {loadLocalEnv}=require('../agents/production/local-env');
loadLocalEnv();

const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {evaluateQc}=require('../agents/production/quality-control');
const args=process.argv.slice(2),get=k=>{const i=args.indexOf('--'+k);return i<0?'':args[i+1];};
const video=get('video'),mode=get('mode')||'long',captions=get('captions'),thumbnail=get('thumbnail'),out=get('output'),reviewFile=get('review');
function validateReview(file,videoPath,expectedMode){
 if(!file)return null;
 const review=JSON.parse(fs.readFileSync(file,'utf8'));
 const actual=review.video?path.resolve(review.video):'';
 if(review.mode!==expectedMode||actual!==path.resolve(videoPath)||review.decision!=='manual_review_required'||
  review.autoPublish!==false||review.allConfirmed!==true||!Array.isArray(review.checks)||review.checks.length!==5||
  review.checks.some(x=>x.confirmed!==true))throw new Error('Human review report is incomplete or does not match this video and QC mode.');
 return {
  audio:{voiceClear:true,musicDucked:true,noClipping:true,noDistractingNoise:true,levelsConsistent:true,pronunciationVerified:true},
  visual:{continuity:true,captionSync:true,safeMargins:true,noBlackOrFrozenFrames:true,visualsMatchNarration:true},
  editorial:{factsVerified:true,rightsCleared:true,originalValue:true,metadataMatches:true,communityGuidelinesReviewed:true,advertiserSuitabilityReviewed:true}
 };
}
if(!video||!['long','short'].includes(mode)){
 console.log('Usage: node scripts/quality-control.js --video final.mp4 --mode long|short [--captions file.srt] [--thumbnail file.jpg] [--review qc-review.json] [--output report.json]');
 process.exitCode=2;
}else if(!fs.existsSync(video)){
 console.error('Video not found:',video);process.exitCode=2;
}else{
 const bin=process.env.FFPROBE_PATH||'ffprobe';
 const r=spawnSync(bin,['-v','error','-show_streams','-show_format','-of','json',video],{encoding:'utf8'});
 if(r.error||r.status!==0)throw new Error('ffprobe failed: '+(r.stderr||r.error?.message));
 const manual=validateReview(reviewFile,video,mode);
 const report=evaluateQc({mode,probe:JSON.parse(r.stdout),files:{
  captions:captions&&fs.existsSync(captions)?captions:'',
  thumbnail:thumbnail&&fs.existsSync(thumbnail)?thumbnail:''
 },...(manual||{})});
 report.video=path.resolve(video);report.createdAt=new Date().toISOString();
 report.humanReviewReport=manual?{file:path.resolve(reviewFile),verified:true,allFiveSectionsConfirmed:true}:null;
 const target=out||video.replace(/\.[^.]+$/,'')+'.qc-report.json';
 fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');
 for(const x of report.checks)console.log((x.passed?'PASS ':'REVIEW ')+x.category+' / '+x.name+' — '+x.detail);
 console.log(report.technical.passed?'TECHNICAL QC PASSED':'TECHNICAL QC FAILED');
 console.log(report.readyForManualApproval?'HUMAN REVIEW CONFIRMED — ready for separate manual approval':'HUMAN REVIEW STILL REQUIRED — publishing remains manual');
 console.log('QC report:',path.resolve(target));
 if(!report.technical.passed)process.exitCode=2;
}
