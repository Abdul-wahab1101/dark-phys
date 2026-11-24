'use strict';
require('../local-secrets').loadLocalSecrets();
const fs = require('node:fs/promises');
const path = require('node:path');

const MODEL = 'gemini-3.8-flash-lite-tts';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';
const VOICES = Object.freeze({
  documentary: 'Charon',
  authoritative: 'Orus',
  warm: 'Kore',
  neutral: 'Schedar'
});
const DIRECTIONS = Object.freeze({
  hook: 'Deliver this like a premium investigative documentary opening: controlled urgency, confident low-register delivery, deliberate pauses, crisp consonants, and restrained emphasis. Never shout or sound like an advertisement.',
  story: 'Use a mature, intimate documentary narrator style: calm, natural conversational rhythm, measured pace, subtle emotional variation, and clear phrasing. Keep the listener curious.',
  evidence: 'Sound precise, credible, composed, and intellectually serious. Slow slightly around important facts, pronounce names and numbers clearly, and avoid dramatic exaggeration.',
  payoff: 'Build quiet conviction and emotional weight. Use a deliberate pace, meaningful pauses, and a firm, memorable final sentence without theatrical overacting.'
});

function pcmToWav(pcm, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  if (!Buffer.isBuffer(pcm) || pcm.length < 128) throw new Error('Gemini returned an empty or invalid PCM audio payload.');
  const blockAlign = channels * bitsPerSample / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22); header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28); header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
function cleanText(value) {
  return String(value || '').replace(/\r/g, '').trim();
}
function stylePrompt(text, direction, language) {
  const directionText = DIRECTIONS[direction] || DIRECTIONS.story;
  const lang = language ? ' Language and accent: ' + language + '.' : '';
  return directionText + lang + ' Read ONLY the narration after the separator. Do not read these instructions. Preserve every word; do not paraphrase, summarize, add words, or announce the task. Use natural breaths and short pauses at punctuation.\nNARRATION:\n' + text;
}
class GeminiTTS {
  constructor(options = {}) {
    const llmIsGoogle = /generativelanguage\.googleapis\.com/i.test(process.env.DARK_PHYS_LLM_BASE_URL || '') || String(process.env.DARK_PHYS_LLM_PROVIDER || '').toLowerCase() === 'gemini';
    this.apiKeys = [...new Set([options.apiKey, process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2, process.env.GOOGLE_API_KEY, (llmIsGoogle ? process.env.DARK_PHYS_LLM_API_KEY : '')].filter(Boolean))];
    this.apiKey = this.apiKeys[0] || '';
    this.keyCursor = 0;
    this.model = options.model || process.env.GEMINI_TTS_MODEL || MODEL;
    this.voice = options.voice || process.env.GEMINI_TTS_VOICE || VOICES.documentary;
    this.fetch = options.fetch || globalThis.fetch;
    this.timeoutMs = options.timeoutMs || 120000;
  }
  async synthesize(text, outputPath, options = {}) {
    const narration = cleanText(text);
    if (!narration) throw new Error('Narration text is required.');
    if (!outputPath) throw new Error('An output audio path is required.');
    if (!this.apiKey) throw new Error('Gemini TTS key missing. Add GEMINI_API_KEY to the local .env file; never commit the key.');
    if (typeof this.fetch !== 'function') throw new Error('Node.js 18+ fetch is required for Gemini TTS.');
    const voice = options.voice || this.voice;
    const direction = options.direction || 'story';
    let response, payload;
    const failures = [];
    const keys = this.apiKeys.length ? this.apiKeys : (this.apiKey ? [this.apiKey] : []);
    for (let attempt = 0; attempt < keys.length; attempt++) {
      const keyIndex = (this.keyCursor + attempt) % keys.length;
      const key = keys[keyIndex];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs || this.timeoutMs);
      try {
        response = await this.fetch(ENDPOINT + encodeURIComponent(this.model) + ':generateContent', {
          method: 'POST',
          headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: stylePrompt(narration, direction, options.language) }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
            }
          }),
          signal: controller.signal
        });
        if (!response.ok) {
          let detail = '';
          try { const errorPayload = await response.json(); detail = errorPayload?.error?.message || ''; } catch (_) {}
          const failure = 'Gemini TTS failed with HTTP ' + response.status + (detail ? ': ' + detail : '.');
          failures.push(failure);
          if (response.status === 429 || response.status === 403 || response.status >= 500) continue;
          throw new Error(failure);
        }
        payload = await response.json();
        this.keyCursor = (keyIndex + 1) % keys.length;
        break;
      } catch (error) {
        if (controller.signal.aborted) throw new Error('Gemini TTS request timed out after ' + (options.timeoutMs || this.timeoutMs) + ' ms.');
        failures.push(error.message);
        if (attempt === keys.length - 1) throw new Error('All configured Gemini TTS keys failed: ' + failures.join(' | '));
      } finally { clearTimeout(timer); }
    }
    if (!payload) throw new Error('All configured Gemini TTS keys failed: ' + failures.join(' | '));
    const parts = payload?.candidates?.[0]?.content?.parts || [];
    const audioPart = parts.find(part => part.inlineData?.data || part.inline_data?.data);
    const encoded = audioPart?.inlineData?.data || audioPart?.inline_data?.data;
    if (!encoded) throw new Error('Gemini TTS response did not contain audio data.');
    const mimeType = audioPart.inlineData?.mimeType || audioPart.inline_data?.mime_type || 'audio/pcm;rate=24000';
    const match = mimeType.match(/rate=(\d+)/i);
    const sampleRate = match ? Number(match[1]) : 24000;
    const pcm = Buffer.from(encoded, 'base64');
    const wav = pcmToWav(pcm, sampleRate);
    const destination = path.resolve(outputPath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, wav);
    return { provider: 'Gemini', modelId: this.model, voiceId: voice, output: destination,
      bytes: wav.length, format: 'wav', sampleRate, channels: 1, direction, reviewRequired: true };
  }
}
module.exports = { GeminiTTS, pcmToWav, DIRECTIONS, VOICES, stylePrompt };
