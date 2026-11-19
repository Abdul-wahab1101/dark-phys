'use strict';
const fs=require('node:fs/promises');
const {ElevenLabsNarration}=require('../agents/production/narration');
async function main(){const [textFile,output]=process.argv.slice(2);if(!textFile||!output){console.log('Usage: node scripts/narrate.js approved-narration.txt uploads/narration.mp3');process.exitCode=1;return;}const text=await fs.readFile(textFile,'utf8');const result=await new ElevenLabsNarration().synthesize(text,output);console.log(JSON.stringify(result,null,2));}
main().catch(e=>{console.error(e.message);process.exit(1);});
