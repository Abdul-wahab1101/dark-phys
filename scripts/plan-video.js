/**
 * Usage:
 *   node scripts/plan-video.js "7 Signs You Are Being Gaslighted"
 *   node scripts/plan-video.js "Title" --format=myth-buster
 *   node scripts/plan-video.js "Title" --short
 * Writes video-plan.json, shot-list.csv, chapters.txt into uploads/video-plans/<slug>/
 */
const path = require('path');
const { VideoFormatPlanner } = require('../agents/video-format-planner');
const args = process.argv.slice(2);
const title = args.find(a => !a.startsWith('--'));
if (!title) { console.log('Usage: node scripts/plan-video.js "Video title" [--format=signs-list|story-case|myth-buster|direct-address|case-study|short] [--short]'); process.exit(1); }
const fmtArg = (args.find(a => a.startsWith('--format=')) || '').split('=')[1];
const planner = new VideoFormatPlanner();
const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
const outDir = path.join(__dirname, '..', 'uploads', 'video-plans', slug);
const { plan, files } = planner.generateAssets({ title, short: args.includes('--short') }, outDir, { format: fmtArg });
console.log(`Format: ${plan.format.name} (${plan.format.id})  | length ${plan.durationLabel} | ~${plan.scriptWordTarget} words | ${plan.shotCount} shots (avg ${plan.averageShotSec}s)`);
console.log('Hook style:', plan.hook.style); plan.hook.options.forEach(h => console.log('  - ' + h));
console.log('Title options:'); plan.titleOptions.forEach(t => console.log('  - ' + t));
console.log('Music:', plan.music.mood, '| tags:', plan.music.searchTags.join(', '), '| gain', plan.music.musicGainDb + ' dB');
console.log('Captions:', plan.captions.style, '| thumbnails prefer:', plan.thumbnailFamilies.join(', '));
if (plan.warnings.length) plan.warnings.forEach(w => console.log('WARNING:', w));
console.log('Files:', files);
