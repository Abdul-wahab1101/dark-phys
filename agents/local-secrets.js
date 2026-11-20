'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const KEYS = new Set([
  'DARK_PHYS_LLM_API_KEY','DARK_PHYS_LLM_MODEL','DARK_PHYS_LLM_BASE_URL',
  'CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN','CLOUDFLARE_TEXT_MODEL',
  'GEMINI_API_KEY','GOOGLE_API_KEY','GEMINI_TTS_MODEL','GEMINI_TTS_VOICE','ELEVENLABS_API_KEY','ELEVENLABS_VOICE_ID','ELEVENLABS_MODEL_ID','FFMPEG_PATH'
]);
function parseEnv(text) {
  const values = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || !KEYS.has(match[1])) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}
function loadLocalSecrets(options = {}) {
  const channelId = String(options.channelId || process.env.DARK_PHYS_CHANNEL_ID || 'hidden-mind-lab').replace(/[^a-z0-9-]/gi, '');
  const candidates = [
    process.env.DARK_PHYS_CHANNEL_ENV,
    path.join(ROOT, 'channel-workspaces', channelId, 'engine', '.env'),
    path.join(process.cwd(), '.env'),
    path.join(ROOT, 'engines', 'youtube-automation-agent', '.env'),
    path.join(ROOT, '.env')
  ].filter(Boolean);
  const loaded = [];
  for (const file of [...new Set(candidates)]) {
    try {
      const values = parseEnv(fs.readFileSync(file, 'utf8'));
      for (const [key, value] of Object.entries(values)) if (process.env[key] === undefined && value) process.env[key] = value;
      if (Object.keys(values).length) loaded.push(file);
    } catch (_) { /* optional local configuration file */ }
  }
  return { loadedFiles: loaded, keysLoaded: KEYS.size };
}
module.exports = { parseEnv, loadLocalSecrets };
