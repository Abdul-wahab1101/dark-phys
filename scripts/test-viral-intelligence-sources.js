'use strict';
const assert=require('node:assert/strict');
const {YouTubeTrendSource,parseVideo}=require('../agents/viral-intelligence-sources');
const calls=[];
const fetchImpl=async url=>{
 const u=new URL(url);calls.push(u);
 if(u.pathname.endsWith('/search'))return {ok:true,json:async()=>({items:[{id:{videoId:'v1'}}]})};
 if(u.searchParams.get('chart')==='mostPopular')return {ok:true,json:async()=>({items:[{id:'v2',snippet:{title:'Popular title',channelId:'c',thumbnails:{}},statistics:{viewCount:'1200'}}]})};
 if(u.searchParams.get('id')==='v1')return {ok:true,json:async()=>({items:[{id:'v1',snippet:{title:'Fresh result',publishedAt:'2026-11-19T00:00:00Z',thumbnails:{}},statistics:{viewCount:'500'}}]})};
 return {ok:true,json:async()=>({items:[]})};
};
(async()=>{
 assert.throws(()=>new YouTubeTrendSource({apiKey:''}).mostPopular(),/not configured/);
 const api=new YouTubeTrendSource({apiKey:'test-key',regionCode:'PK',fetchImpl});
 const popular=await api.mostPopular({maxResults:4});assert.equal(popular.items[0].views,1200);
 const result=await api.discover({queries:['documentary storytelling'],maxResults:5});
 assert.equal(result.items.length,2);assert.ok(calls.every(x=>x.searchParams.get('key')==='test-key'));
 assert.ok(result.limitations.length>=3);
 assert.equal(parseVideo({id:'x',snippet:{title:'<b>safe</b> title'},statistics:{viewCount:'5'}}).title,'safe title');
 console.log('PASS official YouTube trend source: API-key guard, popular/search requests, statistics normalization and safety notes');
})().catch(e=>{console.error(e);process.exitCode=1;});
