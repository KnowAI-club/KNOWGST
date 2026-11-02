import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {credentialStore} from '../integration-vault.mjs';

test('credential durability failure preserves the previous disk and memory generation', t => {
  const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'kg-vault-'));
  t.after(()=>fs.rmSync(runtime,{recursive:true,force:true}));
  const store=credentialStore(runtime);
  store.update(value=>{value.active='first-test-account';});
  const prior=store.get();
  const failure=t.mock.method(fs,'fsyncSync',()=>{throw Object.assign(new Error('Simulated flush failure'),{code:'EIO'});});
  assert.throws(()=>store.update(value=>{value.active='replacement-test-account';}),/flush failure/);
  failure.mock.restore();
  assert.deepEqual(store.get(),prior);
  assert.deepEqual(credentialStore(runtime).get(),prior);
  assert.deepEqual(fs.readdirSync(path.join(runtime,'.credentials')),['integrations.json']);
  store.update(value=>{value.active='replacement-test-account';});
  assert.equal(credentialStore(runtime).get().active,'replacement-test-account');
});
