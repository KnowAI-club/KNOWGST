import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

test('compatibility service: module persistence, isolation and recovery', async t => {
  const runtime = await mkdtemp(join(tmpdir(), 'knowgst-parity-'));
  const secret = randomBytes(32).toString('hex');
  let child;
  async function start() {
    child = fork(resolve('server.js'), [], { env: { ...process.env, KNOWGST_RUNTIME: runtime, KNOWGST_PORT: '0', KNOWGST_LOCAL_SECRET: secret }, stdio: ['ignore','ignore','pipe','ipc'] });
    return await new Promise((resolvePort, reject) => {
      const timeout = setTimeout(() => reject(new Error('Startup timeout')), 10000);
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`Service exited ${code}`)));
      child.on('message', data => { if (data.type === 'ready') { clearTimeout(timeout); resolvePort(data.port); } });
    });
  }
  async function stop() { const exited = new Promise(done => child.once('exit', done)); child.kill('SIGTERM'); await exited; }
  let port = await start();
  async function call(path, method = 'GET', body) {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { method, headers: { 'x-knowgst-key': secret, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  try {
    await t.test('rejects unauthenticated requests and cross-origin requests', async () => {
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/profile`)).status, 401);
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/profile`, { headers: { 'x-knowgst-key': secret, Origin: 'https://example.com' } })).status, 403);
      assert.equal((await call('/control-panel/launch-script','POST',{ action:'update' })).status,409);
      assert.equal((await call('/check-update')).body.updateAvailable,false);
      assert.equal((await call('/health')).body.errorsTail,undefined);
    });
    const profile = { id: 'biz-test', businessName: 'Test Studio', state: 'Maharashtra', country: 'India', address: 'Pune', gstin: '' };
    await t.test('business profile and multiple profile directory round-trip', async () => {
      assert.equal((await call('/profile','POST',profile)).status,200);
      assert.deepEqual((await call('/profile')).body,profile);
      await call('/profiles','POST',profile);
      assert.equal((await call('/profiles')).body[0].businessName,'Test Studio');
    });
    const records = {
      clients: { id: 'client-test', name:'Example Client', address:'Mumbai', country:'India', state:'Maharashtra', gstin:'', email:'client@example.com' },
      products: { id:'product-test', name:'Service', rate:1000, sellingPrice:1000, purchasePrice:500, stock:10, unit:'Nos', taxPercent:18, hsn:'9983' },
      expenses: { id:'expense-test', date:'2026-10-29', category:'Office', description:'Stationery', amount:100, taxAmount:18, profile },
      purchases: { id:'purchase-test', date:'2026-10-29', supplierName:'Example Supplier', invoiceNumber:'SUP-1', taxableAmount:500, cgst:45, sgst:45, igst:0, totalAmount:590, profile },
      receipts: { id:'receipt-test', date:'2026-10-29', receiptNumber:'REC-1', receivedFrom:'Example Client', amount:100, paymentMode:'Cash', profile },
      recurring: { id:'recurring-test', clientName:'Example Client', frequency:'monthly', nextDate:'2099-01-01', enabled:false, active:false, items:[{name:'Service',qty:1,rate:100,taxPercent:18}], profile },
      templates: { id:'terms-test', name:'Test terms', content:'Payment due in 15 days.' },
    };
    for (const [module, record] of Object.entries(records)) await t.test(`${module}: create, update and list preserve fields`, async () => {
      assert.equal((await call(`/${module}`,'POST',record)).status,200);
      assert.deepEqual((await call(`/${module}`)).body.find(x=>x.id===record.id),record);
      const updated={...record, note:'Updated in KNOWGST'};
      assert.equal((await call(`/${module}`,'POST',updated)).status,200);
      assert.deepEqual((await call(`/${module}`)).body.find(x=>x.id===record.id),updated);
    });
    const bill = { id:'INV-TEST-1', invoiceNumber:'INV-TEST-1', invoiceDate:'2026-10-29', clientName:'Example Client', totalAmount:118, totalTaxAmount:18, status:'unpaid', paidAmount:0, payments:[], data:{profile, client:records.clients, details:{invoiceNumber:'INV-TEST-1',invoiceDate:'2026-10-29'},items:[{name:'Service',qty:1,rate:100,taxPercent:18}],totals:{total:118,totalTaxAmount:18},invoiceType:'tax-invoice'} };
    await t.test('sales duplicate protection, trash and restore', async () => {
      assert.equal((await call('/bills','POST',bill)).status,200);
      assert.equal((await call('/bills','POST',bill)).status,409);
      assert.equal((await call(`/bills/${bill.id}`,'DELETE')).status,200);
      assert.equal((await call('/bills')).body.length,0);
      assert.equal((await call(`/trash/${bill.id}/restore`,'POST',{})).status,200);
      assert.equal((await call('/bills')).body[0].invoiceNumber,bill.invoiceNumber);
    });
    await t.test('parallel numbering increments are unique', async () => {
      const results=await Promise.all(Array.from({length:20},()=>call('/meta/testCounter/increment','POST',{})));
      assert.equal(new Set(results.map(r=>r.body.value)).size,20);
    });
    await t.test('selective export/import does not erase unrelated modules', async () => {
      const exported=(await call('/export')).body;
      assert.equal(exported.bills.length,1);
      assert.equal(exported.purchases.length,1);
      assert.equal(exported.meta.appLock,undefined);
      assert.equal((await call('/import','POST',{clients:[{id:'imported-client',name:'Imported client'}]})).status,200);
      assert.equal((await call('/clients')).body.some(x=>x.id==='imported-client'),true);
      assert.equal((await call('/products')).body.length,1);
      assert.equal((await call('/bills')).body.length,1);
    });
    await t.test('settings mirroring and PIN internals stay separate', async () => {
      await call('/local-prefs','POST',{set:{freegstbill_theme:'dark'}});
      assert.equal((await call('/local-prefs')).body.value.freegstbill_theme,'dark');
      assert.equal((await call('/meta/appLock')).status,403);
    });
    await t.test('verified snapshot restores records and rejects damaged snapshots without changing live data', async () => {
      assert.equal((await call('/backups/now','POST',{})).status,200);
      const snapshots=(await call('/backups')).body;
      const date=snapshots[0].date;
      await call('/profile','POST',{...profile,businessName:'Changed after backup'});
      assert.equal((await call(`/backups/${date}/restore`,'POST',{})).status,200);
      assert.equal((await call('/profile')).body.businessName,'Test Studio');
      const manifestPath=join(runtime,'data','backups',date,'knowgst-backup-manifest.json');
      const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
      const file=Object.keys(manifest.files)[0];
      await writeFile(join(runtime,'data','backups',date,file),'damaged');
      assert.equal((await call(`/backups/${date}/restore`,'POST',{})).status,500);
      assert.equal((await call('/profile')).body.businessName,'Test Studio');
      assert.equal((await call('/bills')).body.length,1);
    });
    await t.test('data survives process restart', async () => {
      await stop(); port=await start();
      assert.equal((await call('/profile')).body.businessName,'Test Studio');
      assert.equal((await call('/bills')).body.length,1);
      assert.equal((await call('/meta/testCounter')).body.value,20);
    });
    await t.test('all module records can be removed without touching unrelated records', async () => {
      for (const [module, record] of Object.entries(records)) {
        assert.equal((await call(`/${module}/${record.id}`,'DELETE')).status,200);
        assert.equal((await call(`/${module}`)).body.some(x=>x.id===record.id),false);
      }
      assert.equal((await call('/bills')).body.length,1);
    });
  } finally { await stop(); await rm(runtime,{recursive:true,force:true}); }
});
