#!/usr/bin/env node
'use strict';

/**
 * Split a SmartODL transfer JSON package into smaller import files.
 * Usage:
 *   node tools/jsonimport.js path\to\big-package.json 500
 */
const fs = require('fs');
const path = require('path');

const input = process.argv[2];
const chunkSize = Math.max(1, Number.parseInt(process.argv[3] || '500', 10) || 500);

if (!input) {
  console.error('Usage: node tools/jsonimport.js <package.json> [items-per-file]');
  process.exit(1);
}

const absoluteInput = path.resolve(input);
const raw = fs.readFileSync(absoluteInput, 'utf8');
const payload = JSON.parse(raw);
const hasWrapper = payload && payload.package && typeof payload.package === 'object' && !Array.isArray(payload.package);
const pack = hasWrapper ? payload.package : payload;

if (!pack || typeof pack !== 'object' || !Array.isArray(pack.items)) {
  throw new Error('Input is not a SmartODL transfer package with an items array.');
}
if (!pack.items.length) throw new Error('Package contains no items.');

const parsed = path.parse(absoluteInput);
const outDir = path.join(parsed.dir, `${parsed.name}-split`);
fs.mkdirSync(outDir, { recursive: true });

const totalParts = Math.ceil(pack.items.length / chunkSize);
const padWidth = String(totalParts).length;

for (let i = 0; i < totalParts; i += 1) {
  const items = pack.items.slice(i * chunkSize, (i + 1) * chunkSize);
  const output = hasWrapper
    ? { ...payload, package: { ...pack, items } }
    : { ...pack, items };
  const filename = `${parsed.name}-part-${String(i + 1).padStart(padWidth, '0')}.json`;
  fs.writeFileSync(path.join(outDir, filename), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
}

console.log(`Split ${pack.items.length} item(s) into ${totalParts} file(s).`);
console.log(`Output folder: ${outDir}`);
console.log(`Import the generated JSON files one by one if your current SmartODL build still has per-request limits.`);
