'use strict';
const crypto = require('crypto');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(value) {
  return parseInt(crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8), 16);
}

module.exports = { mulberry32, seedFrom };
