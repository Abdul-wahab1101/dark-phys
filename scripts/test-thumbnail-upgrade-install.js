'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {applyThumbnailUpgrade}=require('./apply-thumbnail-upgrade');

const root=path.resolve(__dirname,'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dark-phys-thumb-install-'));
try{
 const engine=path.join(temp,'engine'),agents=path.join(engine,'agents');
 fs.mkdirSync(agents,{recursive:true});
 fs.mkdirSync(path.join(engine,'utils'),{recursive:true});
 fs.writeFileSync(path.join(engine,'index.js'),'// fixture engine');
 const upstreamDesigner=path.join(agents,'thumbnail-designer-agent.js');
 const upstreamFamilies=path.join(agents,'thumbnail-families-extra.js');
 const production=path.join(agents,'production-management-agent.js');
 fs.writeFileSync(upstreamDesigner,'// original upstream designer\n');
 fs.writeFileSync(upstreamFamilies,'// pre-existing families\n');
 const originalProduction=[
  "'use strict';",
  "const path=require('node:path');",
  "const fs=require('node:fs/promises');",
  "class ProductionManagementAgent {",
  "  async processThumbnail(thumbnail, script) {",
  "    try { const aiThumbnail = await this.aiVideoGenerator.generateThumbnail(script); if (!aiThumbnail.simulated) return aiThumbnail; } catch (error) { this.logger.error(error); }",
  "    return { path: thumbnail.path };",
  "  }",
  "  calculatePublishTime(strategy) { return new Date().toISOString(); }",
  "}",
  "module.exports=ProductionManagementAgent;"
 ].join('\n')+'\n';
 fs.writeFileSync(production,originalProduction);
 const first=applyThumbnailUpgrade({root,engine});
 assert.equal(first.alreadyPatched,false);
 assert(fs.readFileSync(upstreamDesigner,'utf8').includes('async inspectThumbnailVisual'));
 assert(fs.readFileSync(upstreamFamilies,'utf8').includes('module.exports'));
 const patched=fs.readFileSync(production,'utf8');
 assert(patched.includes('DARK_PHYS_REVIEWED_THUMBNAIL_ENGINE'));
 assert(patched.includes("generatedWith: 'Dark Phys reviewed thumbnail engine'"));
 assert(!patched.includes('try { const aiThumbnail'));
 assert.equal(fs.readFileSync(first.backups[1],'utf8'),originalProduction);
 assert.equal(fs.readFileSync(first.backups[0],'utf8'),'// original upstream designer\n');
 const second=applyThumbnailUpgrade({root,engine});
 assert.equal(second.alreadyPatched,true);
 assert.equal(fs.readFileSync(first.backups[1],'utf8'),originalProduction);
 console.log('PASS pinned upstream thumbnail override, reviewed-output handoff, original backups and idempotent re-apply');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
