'use strict';
class Logger {
  constructor(scope = 'DarkPhys') { this.scope = scope; }
  info(message, meta) { console.log('[INFO][' + this.scope + ']', message, meta || ''); }
  warn(message, meta) { console.warn('[WARN][' + this.scope + ']', message, meta || ''); }
  error(message, meta) { console.error('[ERROR][' + this.scope + ']', message, meta || ''); }
  debug(message, meta) { if (process.env.DEBUG) console.debug('[DEBUG][' + this.scope + ']', message, meta || ''); }
}
module.exports = { Logger };
