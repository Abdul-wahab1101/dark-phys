'use strict';
function getRenderProfile(options={}) {
 const totalBytes=Number(options.totalMemoryBytes)||require('node:os').totalmem();
 const mode=String(options.mode||process.env.DARK_PHYS_RENDER_QUALITY||'').toLowerCase();
 const preview=mode?mode!=='final':totalBytes<=8*1024*1024*1024;
 return {mode:preview?'preview':'final',width:preview?1280:1920,height:preview?720:1080,fps:30,preset:'ultrafast',crf:preview?28:24,threads:Math.max(1,Math.min(2,Number(options.threads)||2)),filterThreads:1,reason:preview?'Low-memory profile: 720p preview, ultrafast encode and two threads':'Final profile: 1080p H.264, ultrafast encode and two threads'};
}
module.exports={getRenderProfile};
