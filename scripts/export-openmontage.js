#!/usr/bin/env node
'use strict';

/**
 * Build a portable handoff from the Dark Phys YouTube Agent to OpenMontage.
 *
 * Usage:
 *   node scripts/export-openmontage.js --title "Why People Manipulate You" --script uploads/script.txt --mode long
 *   node scripts/export-openmontage.js --title "Why People Manipulate You" --source-video uploads/final.mp4 --mode shorts
 *
 * This creates a project brief and stage checklist. OpenMontage remains agent-driven:
 * the handoff does not pretend to run its creative pipeline or render without its tools.
 */
const fs = require('fs');
const path = require('path');

function arg(name, fallback = '') {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function safeSlug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 56) || 'dark-phys-video';
}
function readOptional(file) {
  if (!file) return '';
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) throw new Error('File not found: ' + resolved);
  return fs.readFileSync(resolved, 'utf8');
}
function main() {
  const title = arg('title');
  const mode = arg('mode', 'long');
  const scriptPath = arg('script');
  const sourceVideo = arg('source-video');
  const outputRoot = path.resolve(arg('output', path.join(__dirname, '..', 'engines', 'OpenMontage', 'dark-phys-handoff')));
  if (!title) throw new Error('Required: --title "Video title"');
  if (!['long', 'shorts'].includes(mode)) throw new Error('--mode must be long or shorts');
  if (mode === 'long' && !scriptPath) throw new Error('Long-form handoff requires --script <script.txt>');
  if (mode === 'shorts' && !sourceVideo) throw new Error('Shorts handoff requires --source-video <video.mp4>');
  const scriptText = readOptional(scriptPath);
  const sourcePath = sourceVideo ? path.resolve(sourceVideo) : '';
  if (sourcePath && !fs.existsSync(sourcePath)) throw new Error('Source video not found: ' + sourcePath);
  const slug = safeSlug(title);
  const projectDir = path.join(outputRoot, slug);
  fs.mkdirSync(projectDir, { recursive: true });
  const config = mode === 'long'
    ? { pipeline: 'animated-explainer', target_duration_seconds: 600, acceptable_duration_seconds: [480, 720], aspect_ratio: '16:9', resolution: '1920x1080', fps: 30, narration: true, music: true, captions: true, style: 'dark psychology documentary; cinematic b-roll; restrained motion graphics; evidence-led narration' }
    : { pipeline: 'clip-factory', target_clip_count: 5, clip_duration_seconds: [20, 60], aspect_ratio: '9:16', resolution: '1080x1920', fps: 30, captions: true, hook_seconds: [0, 3], source_video: sourcePath, export_individual_files: true };
  const brief = {
    schema_version: '1.0',
    project: 'Dark Phys',
    title,
    slug,
    mode,
    created_at: new Date().toISOString(),
    handoff_only: true,
    production: config,
    source: { script_file: scriptPath ? path.resolve(scriptPath) : null, source_video: sourcePath || null },
    approvals_required: ['creative_proposal', 'script_or_clip_selection', 'scene_plan', 'asset_manifest', 'final_render'],
    publishing: { enabled: false, note: 'Return rendered deliverables to the YouTube Agent review queue. Do not publish from OpenMontage.' }
  };
  fs.writeFileSync(path.join(projectDir, 'dark-phys-brief.json'), JSON.stringify(brief, null, 2));
  if (scriptText) fs.writeFileSync(path.join(projectDir, 'approved-script.md'), scriptText);
  const prompt = mode === 'long'
    ? `# OpenMontage production brief — Dark Phys\n\nProduce an 8–12 minute (target 10:00) 16:9 narrated Dark Psychology / Human Behavior explainer.\n\nTitle: **${title}**\n\nUse the \`animated-explainer\` pipeline. Read AGENT_GUIDE.md and every required stage-director skill before execution. Research claims and retain source URLs. Preserve the supplied approved script; flag factual gaps rather than inventing evidence. Build a scene plan with varied real footage, symbolic inserts, restrained diagrams, kinetic typography and chapter transitions. Narration must remain intelligible; duck music under voice. Add accurate captions, chapter markers, and a clear opening hook and ending.\n\nTarget 480–720 seconds, 1920x1080, 30 fps. Render a 10–15 second sample first, then wait for human approval before full generation. Present all available render runtimes and tradeoffs before selecting one. Export MP4 plus SRT, thumbnail stills, project manifest and render report. Do not publish.\n`
    : `# OpenMontage production brief — Dark Phys Shorts\n\nCreate 5 independent vertical Shorts from the supplied source video.\n\nTitle/theme: **${title}**\nSource: ${sourcePath}\n\nUse the \`clip-factory\` pipeline. Transcribe with timestamps, rank self-contained segments, and choose 5 strong moments. Each clip should be 20–60 seconds, 1080x1920 (9:16), 30 fps, with a compelling hook in the first 1–3 seconds, clean sentence boundaries, readable burned-in captions, normalized speech audio and distinct title/metadata. Do not crop important faces/text. Review each clip independently and export five separate MP4s plus SRTs, timestamps, title/description suggestions and a contact sheet. Do not publish.\n`;
  fs.writeFileSync(path.join(projectDir, 'OPENMONTAGE-PROMPT.md'), prompt);
  fs.writeFileSync(path.join(projectDir, 'RETURN-TO-DARK-PHYS.md'),
    '# Return package\n\nCopy approved final MP4(s), subtitle files, thumbnail stills, render report and source/license manifest into this folder. Review them in Dark Phys before any upload. Publishing is intentionally disabled here.\n');
  console.log('OpenMontage handoff created:', projectDir);
  console.log('Pipeline:', config.pipeline);
  console.log('Next: open OPENMONTAGE-PROMPT.md with your OpenMontage-capable coding agent and follow AGENT_GUIDE.md.');
}
try { main(); } catch (e) { console.error('Handoff error:', e.message); process.exit(1); }
