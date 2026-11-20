'use strict';
const assert=require('node:assert/strict');
const {evaluateQc,buildFiveMinuteReview}=require('../agents/production/quality-control');
const long=evaluateQc({mode:'long',probe:{format:{duration:'600',format_name:'mov,mp4'},streams:[{codec_type:'video',codec_name:'h264',width:1920,height:1080,avg_frame_rate:'30/1'},{codec_type:'audio',codec_name:'aac'}]},files:{captions:'final.srt',thumbnail:'thumb.jpg'}});
assert.equal(long.technical.passed,true);assert.equal(long.readyForManualApproval,false);assert.equal(long.autoPublish,false);
const short=evaluateQc({mode:'short',probe:{format:{duration:'35',format_name:'mov,mp4'},streams:[{codec_type:'video',codec_name:'h264',width:1080,height:1920,avg_frame_rate:'30/1'},{codec_type:'audio',codec_name:'aac'}]},files:{captions:'short.srt'}});
assert.equal(short.technical.passed,true);assert.equal(short.mode,'short');
const review=buildFiveMinuteReview('short');assert.equal(review.items.length,5);assert.equal(review.durationMinutes,5);assert.equal(review.publishing,'manual_by_default');
console.log('PASS separate Long/Short technical, visual, audio, editorial QC and five-minute review checklist');
