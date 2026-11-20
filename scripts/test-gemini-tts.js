'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { GeminiTTS, pcmToWav, stylePrompt } = require('../agents/production/gemini-tts');
const { NarrationEngine } = require('../agents/production/narration');
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dark-phys-gemini-'));
  try {
    const pcm = Buffer.alloc(24000, 7);
    const wav = pcmToWav(pcm, 24000);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt32LE(24), 24000);
    assert.match(stylePrompt('A serious narration.', 'evidence'), /credible/);
    let request;
    const client = new GeminiTTS({
      apiKey: 'test-key',
      fetch: async (url, options) => {
        request = { url, options };
        return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: pcm.toString('base64') } }] } }] }) };
      }
    });
    const output = path.join(dir, 'voice.wav');
    const result = await client.synthesize('A carefully paced documentary narration.', output, { direction: 'evidence' });
    assert.equal(result.provider, 'Gemini');
    assert.equal(result.voiceId, 'Charon');
    assert.equal(result.reviewRequired, true);
    assert.match(request.url, /gemini-2\.5-flash-preview-tts:generateContent/);
    assert.equal(request.options.headers['x-goog-api-key'], 'test-key');
    assert.match(JSON.parse(request.options.body).contents[0].parts[0].text, /N A S A/);
    const saved = await fs.readFile(output);
    assert.equal(saved.toString('ascii', 0, 4), 'RIFF');
    assert.equal(saved.length, pcm.length + 44);
    await assert.rejects(() => new GeminiTTS({ fetch: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'quota exceeded' } }) }), apiKey: 'x' }).synthesize('text', output), /HTTP 429: quota exceeded/);
    await assert.rejects(() => new GeminiTTS({ fetch: async () => ({ ok: true, json: async () => ({ candidates: [] }) }), apiKey: 'x' }).synthesize('text', output), /did not contain audio/);
    await assert.rejects(() => new GeminiTTS({ fetch: async () => ({ ok: true }), apiKey: '' }).synthesize('text', output), /GEMINI_API_KEY/);
    let engineRequest;
    const engine = new NarrationEngine({ geminiOptions: { apiKey: 'engine-key', fetch: async (url, options) => { engineRequest = { url, options }; return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: pcm.toString('base64') } }] } }] }) }; } } });
    const engineOutput = path.join(dir, 'engine.wav');
    const engineResult = await engine.synthesize('NASA released a report.', engineOutput, { direction: 'hook', pronunciationDictionary: { NASA: 'N A S A' } });
    assert.match(JSON.parse(engineRequest.options.body).contents[0].parts[0].text, /N A S A/);
    assert.equal(engineResult.provider, 'Gemini');
    assert.equal(engine.provider(), 'Gemini');
    assert.equal((await fs.readFile(engineOutput)).toString('ascii', 0, 4), 'RIFF');
    console.log('PASS Gemini TTS audio decoding, WAV writing, request config and failure handling');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
