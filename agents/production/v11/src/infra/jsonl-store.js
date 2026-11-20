'use strict';
const fs = require('fs');
const path = require('path');

/** Append-only JSON-lines file. A torn last line (crash during write) is ignored on read. */
class JsonlStore {
  constructor(file) { this.file = file; fs.mkdirSync(path.dirname(file), { recursive: true }); }
  append(record) { fs.appendFileSync(this.file, JSON.stringify(record) + '\n', 'utf8'); }
  readAll() {
    if (!fs.existsSync(this.file)) return [];
    const out = [];
    for (const line of fs.readFileSync(this.file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch (_) { /* skip torn line */ }
    }
    return out;
  }
}

class MemoryStore {
  constructor() { this.rows = []; }
  append(r) { this.rows.push(JSON.parse(JSON.stringify(r))); }
  readAll() { return this.rows.slice(); }
}

module.exports = { JsonlStore, MemoryStore };
