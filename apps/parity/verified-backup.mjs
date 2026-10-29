import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const MANIFEST = 'knowgst-backup-manifest.json';
export function fileManifest(root) {
  const files = {};
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (relative === MANIFEST) continue;
      if (entry.isSymbolicLink()) throw new Error('Backup cannot contain symbolic links');
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) files[relative] = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
      else throw new Error('Unsupported backup entry');
    }
  };
  walk(root);
  return Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)));
}
export function verifyBackup(root) {
  const manifestPath = path.join(root, MANIFEST);
  if (!fs.existsSync(manifestPath)) throw new Error('Backup has no integrity manifest. Import a legacy export through Settings instead.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.format !== 1 || JSON.stringify(manifest.files) !== JSON.stringify(fileManifest(root))) throw new Error('Backup integrity verification failed');
  return manifest;
}
export function replaceDirectory(staging, target) {
  const previous = `${target}.previous`;
  // Preserve the last known-good target until the complete staging folder is ready.
  if (fs.existsSync(previous) && !fs.existsSync(target)) fs.renameSync(previous,target);
  if (fs.existsSync(previous)) fs.rmSync(previous,{recursive:true,force:true});
  const existed = fs.existsSync(target);
  if (existed) fs.renameSync(target,previous);
  try { fs.renameSync(staging,target); }
  catch (error) { if (existed) fs.renameSync(previous,target); throw error; }
  if (existed) fs.rmSync(previous,{recursive:true,force:true});
}
export function createVerifiedBackup(dataDir, target) {
  const staging = `${target}.partial`;
  fs.rmSync(staging,{recursive:true,force:true});
  fs.mkdirSync(staging,{recursive:true,mode:0o700});
  for (const entry of fs.readdirSync(dataDir,{withFileTypes:true})) {
    if (['backups','errors.log','port.txt',MANIFEST].includes(entry.name)) continue;
    if (entry.isSymbolicLink()) throw new Error('Data directory contains a symbolic link');
    fs.cpSync(path.join(dataDir,entry.name),path.join(staging,entry.name),{recursive:true});
  }
  const manifest = { format:1, scope:'application-data', createdAt:new Date().toISOString(), files:fileManifest(staging) };
  fs.writeFileSync(path.join(staging,MANIFEST),JSON.stringify(manifest,null,2));
  verifyBackup(staging);
  replaceDirectory(staging,target);
  return manifest;
}
