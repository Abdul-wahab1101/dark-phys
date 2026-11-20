'use strict';
const fs = require('fs');
const crypto = require('crypto');

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', d => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

function writeFileAtomic(file, data) {
  const tmp = file + '.' + process.pid + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

/**
 * Replace a completed render safely on Windows and POSIX. Windows rename cannot
 * reliably replace an existing destination; keep a rollback copy until the new
 * file is in place so a failed replacement never destroys the previous render.
 */
function replaceFileSync(source, destination) {
  try {
    fs.renameSync(source, destination);
    return destination;
  } catch (error) {
    if (!['EEXIST', 'EPERM', 'ENOTEMPTY'].includes(error.code) || !fs.existsSync(destination)) throw error;
  }
  const backup = destination + '.backup-' + process.pid + '-' + crypto.randomBytes(6).toString('hex');
  fs.renameSync(destination, backup);
  try {
    fs.renameSync(source, destination);
  } catch (error) {
    try { if (!fs.existsSync(destination)) fs.renameSync(backup, destination); } catch (_) { /* retain backup for recovery */ }
    throw error;
  }
  try { fs.unlinkSync(backup); } catch (_) { /* replacement succeeded; stale backup is safer than losing output */ }
  return destination;
}

function isPidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function safeName(s) { return String(s).replace(/[^\w.-]+/g, '_').slice(0, 60); }

module.exports = { hashFile, writeFileAtomic, replaceFileSync, isPidAlive, safeName };
