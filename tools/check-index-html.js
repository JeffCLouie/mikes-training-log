#!/usr/bin/env node
/*
 * check-index-html.js — CI guard for the single-file app.
 *
 * The whole site is index.html + data.json with no build step, so the inline
 * <script> is shipped verbatim. The "Validate data" workflow only checks
 * data.json, which means a UI-only PR (index.html) passes "green" without its
 * JavaScript ever being looked at — and with auto-merge on, a syntax error could
 * ship straight to the live (phone-first) site. This parses every inline script
 * block so a broken one fails CI instead.
 *
 * Scope: syntax only (does the JS parse?). It does not execute the app, so it
 * won't catch runtime/logic errors — a headless smoke test could be added later
 * for that. Cheap, no browser, no dependencies.
 *
 *   node tools/check-index-html.js   # exit 1 if any inline <script> fails to parse
 */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const blocks = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(m => m[1])
  .filter(s => s.trim());

let bad = 0;
blocks.forEach((code, i) => {
  try {
    new Function(code); // parse-only; never runs the code
  } catch (e) {
    bad++;
    console.error(`FAIL  index.html <script> block #${i + 1}: ${e.message}`);
  }
});

if (bad) {
  console.error(`\n${bad} inline script block(s) failed to parse.`);
  process.exit(1);
}
console.log(`OK    index.html: ${blocks.length} inline script block(s) parse cleanly.`);
