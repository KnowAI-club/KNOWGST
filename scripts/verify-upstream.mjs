import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const manifest=JSON.parse(await readFile(new URL('../docs/UPSTREAM-MANIFEST.json',import.meta.url),'utf8'));
const reviewed=JSON.parse(await readFile(new URL('../docs/FINANCIAL-CHANGES.json',import.meta.url),'utf8'));
// These calculation/formatting modules must remain unchanged until a regression-backed migration.
const files=['src/utils.js','src/utils/itr.js','src/utils/clientCredit.js','src/utils/partyOutstanding.js','src/utils/bulkCsv.js','src/utils/products.js'];
for (const file of files) {
  const content=await readFile(new URL(`../apps/parity/${file}`,import.meta.url));
  assert.equal(createHash('sha256').update(content).digest('hex'),reviewed[file]?.sha256 ?? manifest.original_sha256[file],`Unreviewed financial logic modification: ${file}`);
}
console.log(`Verified ${files.length} financial/helper modules against upstream or regression-backed change records.`);
