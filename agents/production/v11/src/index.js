'use strict';
const os = require('os');
const path = require('path');
const { ProcessSupervisor } = require('./infra/process-supervisor');
const { FfmpegRunner } = require('./infra/ffmpeg-runner');
const { CheckpointStore } = require('./infra/checkpoint-store');
const { TempManager } = require('./infra/temp-manager');
const { JsonlStore } = require('./infra/jsonl-store');
const { LicenseLedger } = require('./core/license-ledger');
const { AudioService } = require('./app/audio-service');
const { ProductionPipeline } = require('./app/pipeline');

/** Wires the default production setup. All state lives under `root` (default: a short folder in the OS temp dir). */
function createProductionSystem({ root = path.join(os.tmpdir(), 'yt-production'), logger = null, config = {}, ffmpeg, ffprobe } = {}) {
  const supervisor = new ProcessSupervisor({ logger });
  supervisor.installExitHandlers();
  const runner = new FfmpegRunner({ supervisor, ...(ffmpeg ? { ffmpeg } : {}), ...(ffprobe ? { ffprobe } : {}) });
  const temp = new TempManager({ baseDir: path.join(root, 'work') });
  const checkpoints = new CheckpointStore(path.join(root, 'checkpoints'));
  const ledger = new LicenseLedger(new JsonlStore(path.join(root, 'ledger.jsonl')));
  const audio = new AudioService(runner);
  const pipeline = new ProductionPipeline({ runner, audio, checkpoints, temp, ledger, logger, config });
  return { pipeline, runner, supervisor, temp, checkpoints, ledger, audio };
}

module.exports = {
  createProductionSystem,
  ...require('./core/hook'), ...require('./core/interrupts'), ...require('./core/pacing'), ...require('./core/loudness'),
  ...require('./core/thumbnail-geometry'), ...require('./core/reuse-risk'), ...require('./core/license-ledger'),
  ProcessSupervisor, FfmpegRunner, CheckpointStore, TempManager, JsonlStore, ProductionPipeline, AudioService
};
