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
