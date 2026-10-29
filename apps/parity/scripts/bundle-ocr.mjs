import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { mkdir, readdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
const require = createRequire(import.meta.url);
const workerRoot=dirname(require.resolve('tesseract.js/package.json'));
// Resolve the core from Tesseract itself so worker/core versions cannot drift.
const workerRequire=createRequire(join(workerRoot,'package.json'));
const coreRoot=dirname(workerRequire.resolve('tesseract.js-core/package.json'));
const language=require('@tesseract.js-data/eng');
const output=new URL('../public/tesseract/',import.meta.url);
await mkdir(new URL('core/',output),{recursive:true});
await mkdir(new URL('lang/',output),{recursive:true});
await copyFile(join(workerRoot,'dist/worker.min.js'),new URL('worker.min.js',output));
const cores=(await readdir(coreRoot)).filter(name=>name.startsWith('tesseract-core') && /\.(js|wasm)$/.test(name));
if (!cores.some(name=>name.endsWith('.wasm.js'))) throw new Error('Missing OCR core');
for(const name of cores) await copyFile(join(coreRoot,name),new URL(`core/${name}`,output));
await writeFile(new URL('lang/eng.traineddata',output),gunzipSync(await readFile(join(language.langPath,'eng.traineddata.gz'))));
console.log('Bundled pinned OCR worker, matching WASM core and English data. No runtime CDN is required.');

for (const [label, root] of [['worker', workerRoot], ['core', coreRoot], ['english', dirname(require.resolve('@tesseract.js-data/eng/package.json'))]]) {
  for (const name of (await readdir(root)).filter(n => /^(license|copying|notice)/i.test(n))) {
    await copyFile(join(root,name),new URL(`${label}-${name}`,output));
  }
}
