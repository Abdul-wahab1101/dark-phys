'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { validateResearch, factCheck, buildWriterPrompt, generatePackage, writePackage } = require('../agents/original-content-studio');
let failed = 0;
const ok = (v, m) => { console.log((v ? 'PASS ' : 'FAIL ') + m); if (!v) failed++; };
const base = { topic: 'Why people doubt their own memory', sources: [
 { id: 's1', title: 'Research paper', publisher: 'Journal', url: 'https://example.org/paper', publishedAt: '2022-01-01', accessedAt: '2026-11-19' },
 { id: 's2', title: 'Official guidance', url: 'https://example.org/guidance' }
], claims: [
 { id: 'c1', text: 'Memory can be reconstructive.', sourceIds: ['s1'] },
 { id: 'c2', text: 'Context affects recall.', sourceIds: ['s1','s2'] }
], narration: {
 en: 'A memory can feel like a recording, but it is not. Each time we recall an event, details may be reconstructed. Context, questions and later information can shape what we remember. That does not mean every memory is false. It means confidence and accuracy are not always the same thing.',
 'ur-Latn': 'Yaad-dasht video recording ki tarah nahi hoti. Jab hum kisi waqye ko yaad karte hain to kuch tafseel dobara zehan mein banti hai. Sawal, mahaul aur baad mein milne wali maloomat yaad par asar daal sakti hain. Is ka matlab ye nahi ke har yaad ghalat hoti hai. Matlab sirf ye hai ke yaqeen aur durustgi hamesha aik jaisi nahi hotin.'
}};
ok(validateResearch(base).ok, 'accepts bilingual source-backed research package');
const bad = JSON.parse(JSON.stringify(base)); bad.claims[0].sourceIds = ['missing'];
ok(!validateResearch(bad).ok, 'rejects unknown source references');
const fc = factCheck(base); ok(fc.summary.total === 2 && fc.summary.unsupported === 0, 'builds claim-to-source evidence ledger');
const p = generatePackage(base); ok(p.structure.length === 8, 'creates long-form documentary structure');
ok(p.scripts.en && p.scripts['ur-Latn'], 'keeps English and Roman Urdu drafts separate');
ok(p.retentionReview.checkpoints.length === 8, 'creates retention checkpoints');
ok(buildWriterPrompt(base, 'en').includes('1,250–1,650 words'), 'creates long-form evidence-bound English writer prompt');
ok(buildWriterPrompt(base, 'ur-Latn').includes('Pakistani Roman Urdu'), 'creates native-style Roman Urdu writer prompt');
ok(p.shorts.length === 2 && p.shorts.every(s => s.targetDurationSec === 45), 'plans language-specific Shorts from long-form source');
ok(p.approval.status === 'draft_requires_review', 'keeps human approval gates');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'darkphys-studio-'));
const files = writePackage(p, out);
ok(fs.existsSync(files.package) && fs.existsSync(files.references), 'writes package and source references');
ok(fs.existsSync(path.join(out, 'writer-prompt-en.md')) && fs.existsSync(path.join(out, 'writer-prompt-roman-urdu.md')), 'exports both language writer prompts');
fs.rmSync(out, { recursive: true, force: true });
console.log(failed ? failed + ' failure(s)' : 'ALL CONTENT STUDIO CHECKS PASSED');
process.exit(failed ? 1 : 0);
