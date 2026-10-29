import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVerifiedBackup, verifyBackup } from '../verified-backup.mjs';
test('verified backups refresh existing dates and detect damage before restore',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'knowgst-backup-'));
  try {
    const data=path.join(root,'data');const backup=path.join(data,'backups','2026-10-29');
    fs.mkdirSync(path.join(data,'bills'),{recursive:true});
    fs.writeFileSync(path.join(data,'bills','invoice.json'),'{"total":118}');
    createVerifiedBackup(data,backup);
    assert.equal(verifyBackup(backup).scope,'application-data');
    fs.writeFileSync(path.join(data,'bills','invoice.json'),'{"total":236}');
    createVerifiedBackup(data,backup);
    assert.equal(fs.readFileSync(path.join(backup,'bills','invoice.json'),'utf8'),'{"total":236}');
    fs.writeFileSync(path.join(backup,'bills','invoice.json'),'corrupted');
    assert.throws(()=>verifyBackup(backup),/integrity/);
    assert.equal(fs.readFileSync(path.join(data,'bills','invoice.json'),'utf8'),'{"total":236}');
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('complete backups restore PDFs, PDF trash and exact data; failures roll back both generations',async()=>{
  const {restoreVerifiedBackup,recoverInterruptedRestore}=await import('../verified-backup.mjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'knowgst-full-backup-'));
  const data=path.join(root,'data'),pdfDir=path.join(root,'Saved Invoices'),trashDir=path.join(root,'Trash');
  const options={pdfDir,trashDir};
  const backup=path.join(data,'backups','2026-10-29');
  try {
    for(const dir of [data,pdfDir,trashDir]) fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(data,'profile.json'),'original');
    fs.mkdirSync(path.join(pdfDir,'Client','October'),{recursive:true});
    const pdf=path.join(pdfDir,'Client','October','INV.pdf');
    fs.writeFileSync(pdf,'%PDF-1.7 archived invoice');
    fs.writeFileSync(path.join(trashDir,'old.pdf'),'%PDF-1.7 trashed invoice');
    const manifest=createVerifiedBackup(data,backup,options);
    assert.equal(manifest.scope,'application-data-and-pdfs');
    assert.ok(manifest.files['saved-invoices/Client/October/INV.pdf']);
    fs.writeFileSync(path.join(data,'profile.json'),'new');
    fs.writeFileSync(path.join(data,'extra.json'),'new extra');
    fs.writeFileSync(pdf,'new PDF');
    assert.throws(()=>restoreVerifiedBackup(data,backup,{...options,beforeInstall(index){if(index===2) throw new Error('Simulated disk failure');}}),/disk failure/);
    assert.equal(fs.readFileSync(path.join(data,'profile.json'),'utf8'),'new');
    assert.equal(fs.readFileSync(pdf,'utf8'),'new PDF');
    assert.equal(fs.readFileSync(path.join(data,'extra.json'),'utf8'),'new extra');
    restoreVerifiedBackup(data,backup,options);
    assert.equal(fs.readFileSync(pdf,'utf8'),'%PDF-1.7 archived invoice');
    assert.equal(fs.readFileSync(path.join(data,'profile.json'),'utf8'),'original');
    assert.equal(fs.existsSync(path.join(data,'extra.json')),false);
    assert.equal(fs.readFileSync(path.join(trashDir,'old.pdf'),'utf8'),'%PDF-1.7 trashed invoice');
    fs.writeFileSync(path.join(backup,'saved-invoices','Client','October','INV.pdf'),'damaged');
    assert.throws(()=>restoreVerifiedBackup(data,backup,options),/integrity/);
    assert.equal(fs.readFileSync(pdf,'utf8'),'%PDF-1.7 archived invoice');
    assert.equal(recoverInterruptedRestore(data),false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('process interruption during restore recovers on startup; legacy backup keeps PDFs',async()=>{
  const {spawnSync}=await import('node:child_process');
  const {restoreVerifiedBackup,recoverInterruptedRestore}=await import('../verified-backup.mjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'knowgst-crash-backup-'));
  const data=path.join(root,'data'),pdfDir=path.join(root,'Saved Invoices'),trashDir=path.join(root,'Trash'),backup=path.join(root,'backup');
  try {
    for(const dir of [data,pdfDir,trashDir]) fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(data,'record.json'),'old');fs.writeFileSync(path.join(pdfDir,'invoice.pdf'),'old pdf');
    createVerifiedBackup(data,backup,{pdfDir,trashDir});
    fs.writeFileSync(path.join(data,'record.json'),'new');fs.writeFileSync(path.join(pdfDir,'invoice.pdf'),'new pdf');
    const moduleUrl=new URL('../verified-backup.mjs',import.meta.url).href;
    const code=`import {restoreVerifiedBackup} from ${JSON.stringify(moduleUrl)}; restoreVerifiedBackup(${JSON.stringify(data)},${JSON.stringify(backup)},{pdfDir:${JSON.stringify(pdfDir)},trashDir:${JSON.stringify(trashDir)},beforeInstall(index){if(index===1) process.exit(99);}});`;
    assert.equal(spawnSync(process.execPath,['--input-type=module','-e',code]).status,99);
    assert.equal(recoverInterruptedRestore(data),true);
    assert.equal(fs.readFileSync(path.join(data,'record.json'),'utf8'),'new');
    assert.equal(fs.readFileSync(path.join(pdfDir,'invoice.pdf'),'utf8'),'new pdf');
    const legacy=path.join(root,'legacy');createVerifiedBackup(data,legacy);
    fs.writeFileSync(path.join(data,'record.json'),'after');
    restoreVerifiedBackup(data,legacy,{pdfDir,trashDir});
    assert.equal(fs.readFileSync(path.join(data,'record.json'),'utf8'),'new');
    assert.equal(fs.readFileSync(path.join(pdfDir,'invoice.pdf'),'utf8'),'new pdf');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('backup rejects nested symbolic links without replacing a verified snapshot',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'knowgst-link-backup-'));
 try {const data=path.join(root,'data'),backup=path.join(root,'backup');fs.mkdirSync(data);fs.writeFileSync(path.join(data,'record'),'good');createVerifiedBackup(data,backup);
 fs.mkdirSync(path.join(data,'nested'));fs.symlinkSync(path.join(data,'record'),path.join(data,'nested','link'));
 assert.throws(()=>createVerifiedBackup(data,backup),/links/);assert.equal(verifyBackup(backup).format,1);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('partial staging copy failure leaves live data and the previous backup intact',async()=>{
 const {restoreVerifiedBackup}=await import('../verified-backup.mjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'knowgst-full-disk-')),originalCopy=fs.cpSync;
 try {
  const data=path.join(root,'data'),backup=path.join(root,'backup');fs.mkdirSync(data);fs.writeFileSync(path.join(data,'record'),'old');createVerifiedBackup(data,backup);fs.writeFileSync(path.join(data,'record'),'new');
  fs.cpSync=(source,destination)=>{fs.writeFileSync(destination,'partial');throw new Error('ENOSPC simulated');};
  assert.throws(()=>createVerifiedBackup(data,backup),/ENOSPC/);
  assert.equal(fs.readFileSync(path.join(backup,'record'),'utf8'),'old');
  assert.throws(()=>restoreVerifiedBackup(data,backup),/ENOSPC/);
  assert.equal(fs.readFileSync(path.join(data,'record'),'utf8'),'new');
  assert.equal(verifyBackup(backup).format,1);
 } finally {fs.cpSync=originalCopy;fs.rmSync(root,{recursive:true,force:true});}
});

test('secondary backup folder rejects another installation and unowned legacy dates',async()=>{
 const {claimBackupFolder}=await import('../verified-backup.mjs');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'knowgst-owner-'));
 try{claimBackupFolder(dir,'first');claimBackupFolder(dir,'first');fs.mkdirSync(path.join(dir,'2026-10-29'));fs.writeFileSync(path.join(dir,'2026-10-29','sentinel'),'keep');assert.throws(()=>claimBackupFolder(dir,'second'),/another installation/);assert.equal(fs.readFileSync(path.join(dir,'2026-10-29','sentinel'),'utf8'),'keep');fs.unlinkSync(path.join(dir,'.knowgst-owner'));assert.throws(()=>claimBackupFolder(dir,'second'),/no recorded owner/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
