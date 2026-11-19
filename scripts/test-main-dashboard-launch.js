#!/usr/bin/env node
'use strict';

// Starts the actual pinned YouTube Automation Agent in setup-required mode,
// then verifies its dashboard and health endpoint without API credentials.
const { spawn } = require('node:child_process');
const path = require('node:path');

const appDir = path.resolve(__dirname, '..', 'engines', 'youtube-automation-agent');
const port = 3567;
const child = spawn(process.execPath, ['index.js'], {
  cwd: appDir,
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
child.stdout.on('data', chunk => { output += chunk.toString(); });
child.stderr.on('data', chunk => { output += chunk.toString(); });
let stopping = false;

async function stop() {
  if (stopping) return;
  stopping = true;
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 4000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function main() {
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 25000;
  try {
    let health;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Agent exited early (code ${child.exitCode}).\n${output}`);
      try {
        const response = await fetch(base + '/health');
        if (response.ok) { health = await response.json(); break; }
      } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    if (!health) throw new Error(`Agent did not become healthy before timeout.\n${output}`);
    if (health.status !== 'setup_required' || health.initialized !== true) {
      throw new Error(`Expected safe setup_required state; got ${JSON.stringify(health)}`);
    }
    const pageResponse = await fetch(base + '/');
    const html = await pageResponse.text();
    if (!pageResponse.ok || !html.toLowerCase().includes('<html')) {
      throw new Error('Dashboard root did not return an HTML page.');
    }
    console.log('PASS real YouTube Automation Agent starts without credentials in setup-required mode');
    console.log('PASS main dashboard HTML and /health endpoint');
  } finally {
    await stop();
  }
}

main().catch(async error => {
  console.error(error.stack || error);
  await stop();
  process.exitCode = 1;
});
