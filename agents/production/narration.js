'use strict';
require('../local-secrets').loadLocalSecrets();
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const API = 'https://api.elevenlabs.io/v1/text-to-speech/';
const DEFAULT_DIRECTIONS = Object.freeze({
  hook: { stability: 0.36, similarity_boost: 0.78, style: 0.38, use_speaker_boost: true },
  story: { stability: 0.48, similarity_boost: 0.78, style: 0.22, use_speaker_boost: true },
  evidence: { stability: 0.58, similarity_boost: 0.82, style: 0.12, use_speaker_boost: true },
  payoff: { stability: 0.40, similarity_boost: 0.80, style: 0.32, use_speaker_boost: true }
});
function applyPronunciationDictionary(text, dictionary = {}) {
  let output = String(text || '');
  const applied = [];
  for (const [term, spoken] of Object.entries(dictionary).sort((a, b) => b[0].length - a[0].length)) {
    if (!term.trim() || !String(spoken).trim()) continue;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp('\\b' + escaped + '\\b', 'gi');
    if (pattern.test(output)) {
      output = output.replace(pattern, String(spoken));
      applied.push({ term, spokenForm: String(spoken) });
    }
  }
  return { text: output, applied };
}
function run(bin, args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = '', stderr = '', timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout?.on('data', d => { stdout += d; });
    child.stderr?.on('data', d => { stderr += d; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(bin + ' exited with ' + code + ': ' + stderr.slice(-1200)));
      resolve({ stdout, stderr });
    });
  });
}
class ElevenLabsNarration {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.ELEVENLABS_API_KEY || '';
    this.voiceId = options.voiceId || process.env.ELEVENLABS_VOICE_ID || '';
    this.modelId = options.modelId || process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';
    this.fetch = options.fetch || globalThis.fetch;
    this.ffmpeg = options.ffmpeg || process.env.FFMPEG_PATH || 'ffmpeg';
  }
  async synthesize(text, outputPath, options = {}) {
    const original = String(text || '').trim();
    if (!original) throw new Error('Narration text is required.');
    if (!this.apiKey || !this.voiceId) throw new Error('Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID locally.');
    if (typeof this.fetch !== 'function') throw new Error('Node fetch is unavailable; use Node.js 18 or newer.');
    if (!outputPath) throw new Error('An output audio path is required.');
    const pronunciation = applyPronunciationDictionary(original, options.pronunciationDictionary || {});
    const direction = options.direction || 'story';
    const voiceSettings = { ...(DEFAULT_DIRECTIONS[direction] || DEFAULT_DIRECTIONS.story), ...(options.voiceSettings || {}) };
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), options.timeoutMs || 120000);
    let response;
    try {
      response = await this.fetch(API + encodeURIComponent(this.voiceId) + '?output_format=mp3_44100_128', {
        method: 'POST', headers: { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text: pronunciation.text, model_id: this.modelId, voice_settings: voiceSettings }),
        signal: controller.signal
      });
    } finally { clearTimeout(timeout); }
    if (!response.ok) throw new Error('ElevenLabs narration failed with HTTP ' + response.status + '. Check voice access, quota and API configuration.');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 256) throw new Error('ElevenLabs returned an empty or invalid narration audio payload.');
    const destination = path.resolve(outputPath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes, { flag: 'w' });
    return { provider: 'ElevenLabs', modelId: this.modelId, voiceId: this.voiceId, output: destination,
      bytes: bytes.length, format: 'mp3', direction, pronunciationApplied: pronunciation.applied, reviewRequired: true };
  }
  async synthesizeSections(sections, outputPath, options = {}) {
    if (!Array.isArray(sections) || !sections.length) throw new Error('Narration sections are required.');
    const destination = path.resolve(outputPath), workDir = destination + '.sections';
    await fs.mkdir(workDir, { recursive: true });
    const outputs = [];
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const name = String(section.id || 'section-' + (i + 1)).replace(/[^a-z0-9_-]/gi, '-');
      const file = path.join(workDir, String(i + 1).padStart(3, '0') + '-' + name + '.mp3');
      const result = await this.synthesize(section.text || section.narration, file, {
        ...options, direction: section.direction || (i === 0 ? 'hook' : i === sections.length - 1 ? 'payoff' : section.kind || 'story'),
        voiceSettings: section.voiceSettings || options.voiceSettings
      });
      outputs.push({ id: section.id || name, file, direction: result.direction, pronunciationApplied: result.pronunciationApplied });
    }
    const list = path.join(workDir, 'concat.txt');
    const quote = value => path.resolve(value).replace(/\\/g, '/').replace(/'/g, "'\\''");
    await fs.writeFile(list, outputs.map(x => "file '" + quote(x.file) + "'").join('\n') + '\n', 'utf8');
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await run(this.ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', destination]);
    const loudness = await this.normalizeLoudness(destination, options.targetLufs == null ? -14 : Number(options.targetLufs));
    return { provider: 'ElevenLabs', output: destination, format: 'mp3', sections: outputs,
      loudness, targetIntegratedLufs: options.targetLufs == null ? -14 : Number(options.targetLufs),
      reviewRequired: true };
  }
  async normalizeLoudness(file, target = -14) {
    if (!Number.isFinite(target) || target < -24 || target > -10) throw new Error('Target LUFS must be between -24 and -10.');
    const base = ['-i', file, '-af', 'loudnorm=I=' + target + ':TP=-1.0:LRA=11:print_format=json', '-f', 'null', '-'];
    const analysis = await run(this.ffmpeg, base);
    const matches = [...analysis.stderr.matchAll(/\{[\s\S]*?\}/g)];
    if (!matches.length) throw new Error('FFmpeg loudness analysis did not return measurements.');
    const measured = JSON.parse(matches[matches.length - 1][0]);
    const keys = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'];
    if (['input_i', 'input_tp', 'input_thresh', 'target_offset'].some(k => !Number.isFinite(Number(measured[k])))) throw new Error('FFmpeg loudness measurements are incomplete.');
    const measuredLra = Number.isFinite(Number(measured.input_lra)) ? Number(measured.input_lra) : 0;
    const filter = 'loudnorm=I=' + target + ':TP=-1.0:LRA=11:measured_I=' + measured.input_i +
      ':measured_TP=' + measured.input_tp + ':measured_LRA=' + measuredLra +
      ':measured_thresh=' + measured.input_thresh + ':offset=' + measured.target_offset + ':linear=true:print_format=summary';
    const temp = file + '.normalized.mp3';
    await run(this.ffmpeg, ['-y', '-i', file, '-af', filter, '-c:a', 'libmp3lame', '-b:a', '192k', temp]);
    await fs.copyFile(temp, file);
    await fs.unlink(temp);
    return { targetIntegratedLufs: target, truePeakLimitDbtp: -1, measuredInputI: measured.input_i,
      measuredInputTruePeak: measured.input_tp, measuredInputLra: measured.input_lra, twoPass: true };
  }
}

const { GeminiTTS } = require('./gemini-tts');
class NarrationEngine {
  constructor(options = {}) {
    this.gemini = options.gemini || new GeminiTTS(options.geminiOptions || options);
    this.legacy = options.legacy || new ElevenLabsNarration(options.elevenLabsOptions || options);
    this.ffmpeg = options.ffmpeg || process.env.FFMPEG_PATH || 'ffmpeg';
  }
  provider() {
    if (this.gemini.apiKey) return 'Gemini';
    if (this.legacy.apiKey && this.legacy.voiceId) return 'ElevenLabs';
    throw new Error('No TTS credentials found. Configure GEMINI_API_KEY locally; ElevenLabs is optional.');
  }
  async synthesize(text, outputPath, options = {}) {
    const selected = this.provider();
    if (selected === 'ElevenLabs') return this.legacy.synthesize(text, outputPath, options);
    const ext = path.extname(outputPath).toLowerCase();
    const pronunciation = applyPronunciationDictionary(text, options.pronunciationDictionary || {});
    const tempWav = ext === '.wav' ? outputPath : outputPath + '.gemini-source.wav';
    const result = await this.gemini.synthesize(pronunciation.text, tempWav, options);
    result.pronunciationApplied = pronunciation.applied;
    if (ext === '.wav') return result;
    const destination = path.resolve(outputPath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await run(this.ffmpeg, ['-y', '-i', tempWav, '-c:a', 'libmp3lame', '-b:a', '192k', destination]);
    await fs.unlink(tempWav).catch(() => {});
    return { ...result, output: destination, format: ext.replace('.', '') || 'mp3' };
  }
  async synthesizeSections(sections, outputPath, options = {}) {
    if (!Array.isArray(sections) || !sections.length) throw new Error('Narration sections are required.');
    const destination = path.resolve(outputPath), workDir = destination + '.sections';
    await fs.mkdir(workDir, { recursive: true });
    const outputs = [];
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const name = String(section.id || 'section-' + (i + 1)).replace(/[^a-z0-9_-]/gi, '-');
      const file = path.join(workDir, String(i + 1).padStart(3, '0') + '-' + name + '.mp3');
      const direction = section.direction || (i === 0 ? 'hook' : i === sections.length - 1 ? 'payoff' : section.kind || 'story');
      const result = await this.synthesize(section.text || section.narration, file, {
        ...options, direction, voice: section.voice || options.voice,
        language: section.language || options.language
      });
      outputs.push({ id: section.id || name, file, direction, provider: result.provider });
    }
    const list = path.join(workDir, 'concat.txt');
    const quote = value => path.resolve(value).replace(/\\/g, '/').replace(/'/g, "'\\''");
    await fs.writeFile(list, outputs.map(x => "file '" + quote(x.file) + "'").join('\n') + '\n', 'utf8');
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await run(this.ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'libmp3lame', '-b:a', '192k', destination]);
    const loudness = await this.legacy.normalizeLoudness(destination, options.targetLufs == null ? -14 : Number(options.targetLufs));
    return { provider: this.provider(), output: destination, format: 'mp3', sections: outputs,
      loudness, targetIntegratedLufs: options.targetLufs == null ? -14 : Number(options.targetLufs),
      reviewRequired: true };
  }
  async normalizeLoudness(file, target = -14) { return this.legacy.normalizeLoudness(file, target); }
}
module.exports = { ElevenLabsNarration, NarrationEngine, applyPronunciationDictionary, DEFAULT_DIRECTIONS };
