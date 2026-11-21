'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const app = path.resolve(__dirname, '..', 'engines', 'youtube-automation-agent');
const {productionExitCode}=require('../agents/production/exit-status');
assert.equal(productionExitCode({status:'held_for_monetization_review'}),42,'monetization hold must propagate the queue batch-stop exit code');
assert.equal(productionExitCode({status:'review',monetizationSafety:{autoHold:true}}),42,'an explicit auto-hold must stop the batch');
assert.equal(productionExitCode({status:'blocked'}),2,'production preflight blocks must remain non-zero');
assert.equal(productionExitCode({status:'ready'}),0,'a clean production run must preserve success');
function read(rel) { return fs.readFileSync(path.join(app, rel), 'utf8'); }
for (const rel of ['index.js','utils/generation-recovery-service.js','utils/autonomous-channel-operator.js','utils/operator-service.js','utils/logger.js','database/db.js','agents/production-management-agent.js']) {
  assert(fs.existsSync(path.join(app, rel)), 'Missing orchestration component: ' + rel);
}
const index=read('index.js'), recovery=read('utils/generation-recovery-service.js');
const cinematic=fs.readFileSync(path.resolve(__dirname,'cinematic-production.js'),'utf8');
assert(cinematic.includes('productionExitCode(result)'), 'cinematic production must propagate monetization hold to the queue runner');
const operator=read('utils/autonomous-channel-operator.js'), db=read('database/db.js');
const production=read('agents/production-management-agent.js'), logger=read('utils/logger.js');
assert(index.includes('new ContentStrategyAgent') && index.includes('new ScriptWriterAgent') && index.includes('new ProductionManagementAgent') && index.includes('new PublishingSchedulingAgent'), 'Main controller must initialize the existing agent set');
assert(index.includes('new GenerationRecoveryService') && index.includes('new AutonomousChannelOperator'), 'Main controller must wire recovery and operator');
assert(recovery.includes('GENERATION_STAGES') && recovery.includes('saveGenerationCheckpoint') && recovery.includes('isRetryable') && recovery.includes('resumePoint'), 'Recovery must checkpoint, retry transient errors and expose resume point');
assert(db.includes('generation_checkpoints') && db.includes('markInterruptedJobs'), 'Persistent checkpoints and interrupted-job recovery must exist');
assert(operator.includes('resumeGenerationJob') && operator.includes('resume('), 'Operator must resume failed/interrupted jobs');
assert(production.includes('calculateProgress') && production.includes('progress:'), 'Production must expose progress updates');
assert(logger.includes('createWinstonLogger') && logger.includes('createAgentLogger'), 'Shared structured logger must exist');
console.log('Agent coordination/recovery integration checks passed (7 groups).');
