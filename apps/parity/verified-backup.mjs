import {recordFs as fs} from './sqlite-storage.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
const MANIFEST='knowgst-backup-manifest.json';
const excluded=new Set(['backups','errors.log','port.txt',MANIFEST]);
export function fileManifest(root) {
  const files={};
  function walk(dir) {
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
      const absolute=path.join(dir,entry.name),relative=path.relative(root,absolute).split(path.sep).join('/');
      if(relative===MANIFEST) continue;
      if(entry.isSymbolicLink()) throw new Error('Backup cannot contain symbolic links');
      if(entry.isDirectory()) walk(absolute);
      else if(entry.isFile()) files[relative]=crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
      else throw new Error('Unsupported backup entry');
    }
  }
  walk(root);return Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)));
}
export function verifyBackup(root) {
  if(fs.lstatSync(root).isSymbolicLink()) throw new Error('Backup root cannot be a symbolic link');
  const manifestPath=path.join(root,MANIFEST);
  if(!fs.existsSync(manifestPath)) throw new Error('Backup has no integrity manifest. Import a legacy export through Settings instead.');
  if(fs.lstatSync(manifestPath).isSymbolicLink()) throw new Error('Invalid manifest');
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  const expectedScope=manifest.format===2?'application-data-and-pdfs':'application-data';
  if(![1,2].includes(manifest.format)||manifest.scope!==expectedScope||JSON.stringify(manifest.files)!==JSON.stringify(fileManifest(root))) throw new Error('Backup integrity verification failed');
  if(manifest.format===2 && ['data','saved-invoices','pdf-trash'].some(name=>!fs.statSync(path.join(root,name)).isDirectory())) throw new Error('Incomplete backup');
  return manifest;
}
export function replaceDirectory(staging,target) {
  const previous=`${target}.previous`;
  if(fs.existsSync(previous)&&!fs.existsSync(target)) fs.renameSync(previous,target);
  if(fs.existsSync(previous)) fs.rmSync(previous,{recursive:true,force:true});
  const existed=fs.existsSync(target);
  if(existed) fs.renameSync(target,previous);
  try {fs.renameSync(staging,target);} catch(error) {if(existed) fs.renameSync(previous,target);throw error;}
  if(existed) fs.rmSync(previous,{recursive:true,force:true});
}
function checkedCopy(source,target) {
  if(fs.lstatSync(source).isSymbolicLink()) throw new Error('Symbolic links are not supported');
  // Validate before copying, including nested links (cp otherwise preserves links).
  if(fs.statSync(source).isDirectory()) fileManifest(source);
  fs.cpSync(source,target,{recursive:true});
}
export function createVerifiedBackup(dataDir,target,options={}) {
  const full=!!options.pdfDir;
  const staging=`${target}.partial`;
  fs.rmSync(staging,{recursive:true,force:true});fs.mkdirSync(staging,{recursive:true,mode:0o700});
  const dataTarget=full?path.join(staging,'data'):staging;
  fs.mkdirSync(dataTarget,{recursive:true});
  for(const entry of fs.readdirSync(dataDir,{withFileTypes:true})) {
    if(!excluded.has(entry.name)) checkedCopy(path.join(dataDir,entry.name),path.join(dataTarget,entry.name));
  }
  if(full) for(const [source,name] of [[options.pdfDir,'saved-invoices'],[options.trashDir,'pdf-trash']]) {
    const destination=path.join(staging,name);fs.mkdirSync(destination,{recursive:true});
    if(source&&fs.existsSync(source)) checkedCopy(source,destination);
  }
  const manifest={format:full?2:1,scope:full?'application-data-and-pdfs':'application-data',createdAt:new Date().toISOString(),files:fileManifest(staging)};
  fs.writeFileSync(path.join(staging,MANIFEST),JSON.stringify(manifest,null,2));
  verifyBackup(staging);replaceDirectory(staging,target);return manifest;
}
const transactionPath=dataDir=>path.join(path.dirname(dataDir),'.restore-transaction');
// Journal is written before any rename. On restart, restore the previous generation.
export function recoverInterruptedRestore(dataDir) {
  const transaction=transactionPath(dataDir),journal=path.join(transaction,'journal.json');
  if(!fs.existsSync(journal)) {fs.rmSync(transaction,{recursive:true,force:true});return false;}
  const {entries,committed}=JSON.parse(fs.readFileSync(journal,'utf8'));
  if(!committed) for(const entry of [...entries].reverse()) {
    const target=path.resolve(path.dirname(dataDir),entry.relative);
    if(!target.startsWith(path.dirname(dataDir)+path.sep)||target===transaction) throw new Error('Invalid restore journal');
    const saved=path.join(transaction,'saved',String(entry.index));
    if(fs.existsSync(saved)) {fs.rmSync(target,{recursive:true,force:true});fs.renameSync(saved,target);}
    else if(!entry.existed) fs.rmSync(target,{recursive:true,force:true});
  }
  fs.rmSync(transaction,{recursive:true,force:true});return !committed;
}
export function restoreVerifiedBackup(dataDir,source,options={}) {
  const manifest=verifyBackup(source);
  recoverInterruptedRestore(dataDir);
  const transaction=transactionPath(dataDir),staged=path.join(transaction,'staged');
  fs.mkdirSync(staged,{recursive:true,mode:0o700});fs.mkdirSync(path.join(transaction,'saved'));
  const sourceData=manifest.format===2?path.join(source,'data'):source;
  const names=new Set([...fs.readdirSync(dataDir),...fs.readdirSync(sourceData)].filter(n=>!excluded.has(n)));
  const targets=[...names].map(name=>({target:path.join(dataDir,name),source:path.join(sourceData,name)}));
  if(manifest.format===2) {
    if(!options.pdfDir||!options.trashDir) throw new Error('PDF restore destinations are required');
    targets.push({target:options.pdfDir,source:path.join(source,'saved-invoices')},{target:options.trashDir,source:path.join(source,'pdf-trash')});
  }
  const entries=targets.map((entry,index)=>({...entry,index,relative:path.relative(path.dirname(dataDir),entry.target),existed:fs.existsSync(entry.target)}));
  try {
    for(const entry of entries) if(fs.existsSync(entry.source)) checkedCopy(entry.source,path.join(staged,String(entry.index)));
    // Preserve this installation's lock and backup location without changing archived data.
    options.prepare?.(entries,staged);
    const journal=path.join(transaction,'journal.json');
    fs.writeFileSync(journal,JSON.stringify({entries,committed:false}));
    for(const entry of entries) {
      if(entry.existed) fs.renameSync(entry.target,path.join(transaction,'saved',String(entry.index)));
      options.beforeInstall?.(entry.index);
      const replacement=path.join(staged,String(entry.index));
      if(fs.existsSync(replacement)) fs.renameSync(replacement,entry.target);
    }
    fs.writeFileSync(path.join(transaction,'commit.tmp'),JSON.stringify({entries,committed:true}));
    fs.renameSync(path.join(transaction,'commit.tmp'),journal);
    fs.rmSync(transaction,{recursive:true,force:true});
    return manifest;
  } catch(error) {recoverInterruptedRestore(dataDir);throw error;}
}

// Keep installation identity outside restored data so a restore cannot impersonate another PC.
export function claimBackupFolder(dir,installationId){
 fs.mkdirSync(dir,{recursive:true});const marker=path.join(dir,'.knowgst-owner');
 if(!fs.existsSync(marker)){
  if(fs.readdirSync(dir).some(n=>/^\d{4}-\d{2}-\d{2}$/.test(n)))throw new Error('This folder contains backups with no recorded owner. Choose a new empty backup folder; existing copies remain available to restore.');
  try{fs.writeFileSync(marker,installationId,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
 }
 if(fs.readFileSync(marker,'utf8').trim()!==installationId)throw new Error('This backup folder belongs to another installation. Choose a separate folder so its backups are not replaced.');
}
