#!/usr/bin/env node
/**
 * analyze.js — quick keystroke-dynamics summary over a captured .jsonl session.
 *
 * Usage:
 *   node tools/analyze.js path/to/session_XXXX.jsonl
 *
 * Reports:
 *   - event counts
 *   - inter-key interval (IKI) stats from keystroke events (mean/median/p95)
 *   - typing bursts vs. pauses
 *   - net characters inserted vs. deleted (from change events)
 *
 * Works with any capturePolicy — it only relies on timing (dt) and lengths.
 */

const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node tools/analyze.js <session.jsonl>');
  process.exit(1);
}

const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
const events = lines.map((l) => {
  try {
    return JSON.parse(l);
  } catch {
    return null;
  }
}).filter(Boolean);

const counts = {};
const keystrokes = [];
let inserted = 0;
let deleted = 0;

for (const e of events) {
  counts[e.type] = (counts[e.type] || 0) + 1;
  if (e.type === 'keystroke') {
    keystrokes.push(e.dt);
  }
  if (e.type === 'change' && Array.isArray(e.changes)) {
    for (const c of e.changes) {
      inserted += c.insLen || 0;
      deleted += c.rangeLen || 0;
    }
  }
}

// Inter-key intervals from consecutive keystroke timestamps (ms).
const ikis = [];
for (let i = 1; i < keystrokes.length; i++) {
  const d = keystrokes[i] - keystrokes[i - 1];
  if (d >= 0) ikis.push(d);
}

function stats(arr) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return {
    n: s.length,
    mean: +(sum / s.length).toFixed(1),
    median: +q(0.5).toFixed(1),
    p95: +q(0.95).toFixed(1),
    min: +s[0].toFixed(1),
    max: +s[s.length - 1].toFixed(1),
  };
}

const PAUSE_MS = 1000;
const pauses = ikis.filter((d) => d >= PAUSE_MS).length;
const iki = stats(ikis);

const header = events.find((e) => e.type === 'session_start');
const spanMs = events.length ? events[events.length - 1].dt : 0;

console.log('File:            ', file);
console.log('Session:         ', header ? header.sessionId : '(unknown)');
console.log('Capture policy:  ', header ? header.capturePolicy : '(unknown)');
console.log('Duration:        ', (spanMs / 1000).toFixed(1), 's');
console.log('Event counts:    ', JSON.stringify(counts));
console.log('Keystrokes:      ', keystrokes.length);
console.log('Chars inserted:  ', inserted);
console.log('Chars deleted:   ', deleted);
console.log('Net chars:       ', inserted - deleted);
if (iki) {
  console.log('Inter-key interval (ms):', JSON.stringify(iki));
  console.log(`Pauses >= ${PAUSE_MS}ms:   `, pauses);
  const activeSec = ikis.filter((d) => d < PAUSE_MS).reduce((a, b) => a + b, 0) / 1000;
  if (activeSec > 0) {
    const cps = keystrokes.length / activeSec;
    console.log('Typing speed:    ', (cps * 60).toFixed(0), 'chars/min (active time),',
      (cps * 60 / 5).toFixed(0), 'WPM approx');
  }
}
