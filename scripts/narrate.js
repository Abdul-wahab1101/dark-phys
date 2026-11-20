'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { ElevenLabsNarration } = require('../agents/production/narration');
async function main() {
  const [inputFile, output] = process.argv.slice(2);
  if (!inputFile || !output || process.argv.includes('--help')) {
    console.log('Usage: node scripts/narrate.js approved-narration.txt narration.mp3 [pronunciation-dictionary.json]');
    console.log('Or provide a JSON file with sections:[{id,text,direction,voiceSettings}] to synthesize each section separately and master to -14 LUFS.');
    process.exitCode = inputFile ? 0 : 1; return;
  }
  const raw = await fs.readFile(inputFile, 'utf8');
  const dictionaryPath = process.argv[4];
  const dictionary = dictionaryPath ? JSON.parse(await fs.readFile(path.resolve(dictionaryPath), 'utf8')) : {};
  const engine = new ElevenLabsNarration();
  let result;
  try {
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.sections)) {
      result = await engine.synthesizeSections(data.sections, output, {
        pronunciationDictionary: dictionary, targetLufs: data.targetLufs == null ? -14 : data.targetLufs
      });
    } else {
      result = await engine.synthesize(raw, output, { pronunciationDictionary: dictionary, direction: 'story' });
      result.loudness = await engine.normalizeLoudness(output, -14);
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      result = await engine.synthesize(raw, output, { pronunciationDictionary: dictionary, direction: 'story' });
    } else throw error;
  }
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error('Narration error:', error.message); process.exit(1); });
