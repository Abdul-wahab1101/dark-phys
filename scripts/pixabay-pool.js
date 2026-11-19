'use strict';
const {PixabayPool}=require('../agents/production/pixabay-pool');
async function main(){const q=process.argv.slice(2).join(' ');if(!q){console.log('Usage: node scripts/pixabay-pool.js <scene footage query>');process.exitCode=1;return;}const pool=new PixabayPool();const r=await pool.search(q,{perPage:10});console.log(JSON.stringify({status:r.status,keySlot:r.keySlot,totalHits:r.totalHits,items:(r.items||[]).map(({videoUrl,...x})=>x)},null,2));}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
