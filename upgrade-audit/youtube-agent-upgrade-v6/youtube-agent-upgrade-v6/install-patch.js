/**
 * Installer.  Usage (from this folder):
 *   node install-patch.js "C:\path\to\youtube-automation-agent"
 * - Backs up every file it replaces as <name>.bak_<timestamp>
 * - Only copies the files in ./files (never touches utils/logger or anything else)
 * - Syntax-checks each installed file; restores the backup automatically if a check fails
 */
const fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');
const target = process.argv[2];
if (!target) { console.log('Usage: node install-patch.js "<project root>"   (the folder that contains agents/ and utils/)'); process.exit(1); }
const root = path.resolve(target);
if (!fs.existsSync(path.join(root, 'agents'))) { console.error('ERROR: no "agents" folder in ' + root + '. Point to the project root.'); process.exit(1); }
if (!fs.existsSync(path.join(root, 'utils', 'logger.js'))) console.warn('WARNING: utils/logger.js not found in project; thumbnail agent requires it.');
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const src = path.join(__dirname, 'files');
const list = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); e.isDirectory() ? walk(f) : list.push(path.relative(src, f)); } })(src);
let failed = false;
for (const rel of list) {
  const dest = path.join(root, rel), bak = dest + '.bak_' + stamp;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const existed = fs.existsSync(dest);
  if (existed) fs.copyFileSync(dest, bak);
  fs.copyFileSync(path.join(src, rel), dest);
  try { fs.chmodSync(dest, 0o644); } catch (_) {}
  const chk = spawnSync(process.execPath, ['--check', dest], { encoding: 'utf8' });
  if (chk.status !== 0) {
    failed = true; console.error('SYNTAX CHECK FAILED for ' + rel + '\n' + chk.stderr);
    if (existed) { fs.copyFileSync(bak, dest); console.error('  restored backup'); } else fs.unlinkSync(dest);
  } else console.log('installed ' + rel + (existed ? '  (backup: ' + path.basename(bak) + ')' : ''));
}
if (failed) process.exit(1);
console.log('\nDone. Next:\n  node scripts/test-video-planner.js\n  node scripts/test-thumbnail-designer.js\n  node scripts/plan-video.js "7 Signs You Are Being Gaslighted"');
