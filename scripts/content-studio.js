#!/usr/bin/env node
'use strict';
const fs = require('fs'), path = require('path');
const { generatePackage, writePackage } = require('../agents/original-content-studio');
const args = process.argv.slice(2);
if (args.includes('--help') || args.length < 1) {
 console.log('Usage: node scripts/content-studio.js research-package.json [--short] [--duration=600]');
 console.log('Input must include topic, sources[{id,title,url}], claims[{text,sourceIds}], narration{en,ur-Latn}.');
 process.exit(args.length < 1 && !args.includes('--help') ? 1 : 0);
}
const input = JSON.parse(fs.readFileSync(args[0], 'utf8'));
const duration = Number((args.find(x => x.startsWith('--duration=')) || '').split('=')[1]) || 600;
const pkg = generatePackage(input, { format: args.includes('--short') ? 'short' : 'long', durationSec: duration });
const out = path.join(__dirname, '..', 'uploads', 'content-studio', pkg.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60));
console.log(JSON.stringify(writePackage(pkg, out), null, 2));
console.log('Draft created. Verify sources, claims, native-language narration and originality before approval.');
