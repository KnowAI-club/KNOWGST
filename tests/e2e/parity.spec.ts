import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../../apps/parity/package.json',import.meta.url));
const {PDFDocument}=require('pdf-lib');
const profile={id:'parity-suite',businessName:'Parity Studio',address:'Pune',state:'Maharashtra',country:'India',gstin:''};
test.beforeEach(async({request})=>{
  await request.post('/api/profile',{data:profile});
  await request.post('/api/local-prefs',{data:{set:{gst_printSettings:JSON.stringify({onboardingComplete:true}),freegstbill_onboarded:'true'}}});
});
const types=[
 ['tax-invoice','Tax Invoice','INV',118],['quotation','Quotation','QUO',118],['proforma','Proforma / Estimate','EST',118],
 ['bill-of-supply','Bill of Supply (No GST)','BOS',100],['composition','Composition (Bill of Supply)','COMP',100],
 ['credit-note','Credit Note','CN',118],['delivery-challan','Delivery Challan','DC',100],
] as const;
for(const [type,label,prefix,total] of types) test(`${type}: create, PDF, persisted particulars`,async({page,request})=>{
  await page.goto('/?view=new');
  await page.locator('.type-selector').getByRole('button',{name:label,exact:true}).click();
  await page.getByPlaceholder('Type client name to search or add new').fill(`Parity ${type}`);
  await page.getByPlaceholder('Street address, locality',{exact:true}).fill('Mumbai');
  await page.locator('.form-group').filter({has:page.locator('label').filter({hasText:/^State$/})}).locator('select').selectOption({label:'Maharashtra'});
  await page.getByPlaceholder('Item',{exact:true}).fill('Parity service');
  await page.locator('.line-item-field').filter({has:page.locator('label').filter({hasText:/^Rate$/})}).locator('input').fill('100');
  if(type==='credit-note') await page.getByPlaceholder('e.g. INV/2025-26/0001').fill('INV/26-27/0001');
  const download=page.waitForEvent('download');
  const archive=page.waitForResponse(r=>r.url().includes('/api/save-pdf')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Save & Download',exact:true}).click();
  const file=await download; expect(file.suggestedFilename()).toContain(prefix);
  const pdf=await PDFDocument.load(await readFile((await file.path())!)); expect(pdf.getPageCount()).toBeGreaterThan(0);
  expect((await archive).status()).toBe(200);
  const bills=await (await request.get('/api/bills')).json();
  const bill=bills.find((b:any)=>b.clientName===`Parity ${type}`);
  expect(bill.totalAmount).toBe(total);expect(bill.data.invoiceType).toBe(type);
  expect(bill.data.items[0].name).toBe('Parity service');
  if(type==='credit-note') expect(bill.data.details.originalInvoiceRef).toBe('INV/26-27/0001');
  await page.reload(); await page.goto('/?view=dashboard');
  await expect(page.locator('.main-content')).toContainText(`Parity ${type}`);
});

test('reports reconcile signed sales, expenses, currency, cancelled and non-sale documents; export CSV and Excel',async({page})=>{
  const today=new Date().toISOString().slice(0,10);
  const bill=(id:string,type:string,total:number,tax:number,extra:any={})=>({id,invoiceNumber:id,invoiceDate:today,clientName:'Report Client',invoiceType:type,totalAmount:total,totalTaxAmount:tax,status:'unpaid',paidAmount:0,currency:'INR',data:{profile,invoiceType:type,invoiceOptions:{currency:'INR'},details:{invoiceDate:today},items:[{name:'Report service',quantity:1,rate:total-tax,taxPercent:18}],totals:{total,totalTaxAmount:tax}},...extra});
  const bills=[bill('SALE','tax-invoice',1180,180),bill('CREDIT','credit-note',118,18),bill('QUOTE','quotation',11800,1800),bill('EST','proforma',11800,1800),bill('DC','delivery-challan',10000,0),bill('CANCEL','tax-invoice',11800,1800,{status:'cancelled'}),bill('USD','tax-invoice',118,18,{currency:'USD',data:{profile,invoiceType:'tax-invoice',invoiceOptions:{currency:'USD'},totals:{}}})];
  await page.route('**/api/bills',r=>r.fulfill({json:bills}));
  await page.route('**/api/expenses',r=>r.fulfill({json:[{id:'EXP',date:today,amount:236,gstAmount:36,currency:'INR',profile}]}));
  await page.route('**/api/products',r=>r.fulfill({json:[{id:'stock-fixture',name:'Stock fixture',stock:10,purchasePrice:50,sellingPrice:100,unit:'Nos'}]}));
  await page.route('**/api/purchases',r=>r.fulfill({json:[]}));
  await page.goto('/?view=reports');
  await expect(page.locator('.stat-card').filter({hasText:'Revenue (ex. tax)'})).toContainText('900.00');
  await expect(page.locator('.stat-card').filter({hasText:'Expenses (ex. GST)'})).toContainText('200.00');
  await expect(page.locator('.stat-card').filter({hasText:'Net Profit'})).toContainText('700.00');
  const csvEvent=page.waitForEvent('download');await page.getByRole('button',{name:'CSV',exact:true}).first().click();
  const csv=await readFile((await (await csvEvent).path())!,'utf8');expect(csv).toContain('900');expect(csv).toContain('700');expect(csv).not.toContain('11800');
  const excelEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Excel',exact:true}).first().click();
  const excel=await readFile((await (await excelEvent).path())!);expect(excel.subarray(0,2).toString()).toBe('PK');
  for(const tab of ['Outstanding & Aging','Party Outstanding','Client Analytics','Product Performance','Stock']) {
    await page.getByRole('button',{name:tab,exact:true}).click();await expect(page.locator('.main-content')).not.toContainText('NaN');
    const exported=page.waitForEvent('download');await page.getByRole('button',{name:'CSV',exact:true}).first().click();
    const content=await readFile((await (await exported).path())!,'utf8');
    expect(content).toContain(tab==='Stock'?'Stock fixture':tab==='Product Performance'?'Report service':'Report Client');
    expect(content).not.toContain('NaN');
    if(tab==='Client Analytics') expect(content).toContain('1062');
    if(tab==='Product Performance') expect(content).toContain('900');
    if(tab==='Stock') expect(content).toContain('500');
  }
});

test('OCR reads a synthetic invoice using only bundled local assets',async({page})=>{
  test.setTimeout(90000);
  const external:string[]=[];
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/,route=>{external.push(route.request().url());return route.abort();});
  await page.goto('/?view=purchases');
  const data=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=1400;canvas.height=700;
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,1400,700);ctx.fillStyle='black';ctx.font='40px Arial';
    ['EXAMPLE SUPPLIER','Invoice No: TEST-123','Date: 29/10/2026','Taxable Amount: 1000.00','CGST: 90.00','SGST: 90.00','Grand Total: 1180.00'].forEach((line,i)=>ctx.fillText(line,50,70+i*80));
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await page.getByRole('button',{name:'Import from image (OCR)',exact:true}).click();
  await page.locator('input[type=file][accept="image/*"]').setInputFiles({name:'synthetic-invoice.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
  await page.getByRole('button',{name:'Extract fields',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Extracted fields',exact:true})).toBeVisible({timeout:60000});
  await expect(page.locator('.modal-overlay label').filter({hasText:/^Invoice No\.$/}).locator('..').locator('input')).toHaveValue('TEST-123');
  await expect(page.locator('.modal-overlay label').filter({hasText:/^Grand total$/}).locator('..').locator('input')).toHaveValue('1180');
  expect(external).toEqual([]);
});

test('GST exports reconcile taxable sales and exclude estimates and cancelled invoices',async({page})=>{
  const today=new Date().toISOString().slice(0,10);
  const gstProfile={...profile,gstin:'27AAPFU0939F1ZV'};
  const bill=(id:string,type:string,status='unpaid')=>({id,invoiceNumber:id,invoiceDate:today,clientName:'GST Fixture',invoiceType:type,status,totalAmount:1180,totalTaxAmount:180,data:{profile:gstProfile,client:{name:'GST Fixture',state:'Maharashtra',country:'India',gstin:''},details:{invoiceDate:today,placeOfSupply:'Maharashtra'},invoiceType:type,items:[{name:'Service',hsn:'998314',unit:'NOS',quantity:1,rate:1000,taxPercent:18}],totals:{subtotal:1000,taxableAmount:1000,total:1180,totalTaxAmount:180,cgst:90,sgst:90,igst:0},invoiceOptions:{currency:'INR'}}});
  await page.route('**/api/profile',r=>r.fulfill({json:gstProfile}));
  await page.route('**/api/bills',r=>r.fulfill({json:[bill('INV-1','tax-invoice'),bill('QUO-1','quotation'),bill('EST-1','proforma'),bill('INV-2','tax-invoice','cancelled')]}));
  await page.route('**/api/expenses',r=>r.fulfill({json:[]}));
  await page.route('**/api/purchases',r=>r.fulfill({json:[]}));
  await page.goto('/?view=filing');
  const first=page.waitForEvent('download');await page.getByRole('button',{name:'JSON Export',exact:true}).click();
  const gstr1=JSON.parse(await readFile((await (await first).path())!,'utf8'));
  expect(gstr1.gstin).toBe(gstProfile.gstin);expect(gstr1.b2cs).toHaveLength(1);
  expect(gstr1.b2cs[0]).toMatchObject({txval:1000,camt:90,samt:90,iamt:0});
  await page.getByRole('button',{name:'GSTR-3B',exact:true}).click();
  const second=page.waitForEvent('download');await page.getByRole('button',{name:'3B JSON',exact:true}).click();
  const gstr3b=JSON.parse(await readFile((await (await second).path())!,'utf8'));
  expect(gstr3b.sup_details.osup_det).toMatchObject({txval:1000,camt:90,samt:90,iamt:0});
});

test('GSTR-2B import distinguishes matched, mismatch, books-only and portal-only entries',async({page})=>{
  const today=new Date().toISOString().slice(0,10),supplier='27AAPFU0939F1ZV';
  const purchases=['MATCH','MISMATCH','BOOKONLY'].map(id=>({id,invoiceNumber:id,date:today,supplierName:'Supplier',supplierGstin:supplier,profile,items:[{name:'Service',quantity:1,rate:1000,taxPercent:18}]}));
  await page.route('**/api/bills',r=>r.fulfill({json:[]}));
  await page.route('**/api/purchases',r=>r.fulfill({json:purchases}));
  await page.goto('/?view=filing');await page.getByRole('button',{name:'GSTR-2B Reconciliation',exact:true}).click();
  const payload={data:{docdata:{b2b:[{ctin:supplier,trdnm:'Supplier',inv:['MATCH','MISMATCH','PORTALONLY'].map(inum=>({inum,dt:today,val:inum==='MISMATCH'?2360:1180,itcavl:'Y',items:[{txval:1000,cgst:90,sgst:90,igst:0}]}))}]}}};
  await page.locator('input[type=file]').setInputFiles({name:'gstr2b.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(payload))});
  for(const [number,status] of [['MATCH','Matched'],['MISMATCH','Amount mismatch'],['BOOKONLY','Books only'],['PORTALONLY','2B only']] as const) {
    await expect(page.locator('tbody tr').filter({has:page.getByText(number,{exact:true})})).toContainText(status);
  }
});

test('recurring UI creates, pauses and generates a persisted invoice',async({page,request})=>{
 await page.goto('/?view=recurring');await page.getByRole('button',{name:'New Template',exact:true}).click();
 const field=(name:RegExp)=>page.locator('.modal-content label').filter({hasText:name}).locator('..').locator('input');
 await field(/^Client Name/).fill('Browser recurring client');
 await field(/^Description$/).fill('Retainer');await field(/^Rate$/).fill('100');
 await page.getByRole('button',{name:'Save',exact:true}).click();
 const row=page.locator('tbody tr').filter({hasText:'Browser recurring client'});
 await row.getByTitle('Pause',{exact:true}).click();await expect(row).toContainText('Paused');
 await row.getByTitle('Generate Now',{exact:true}).click();
 await expect.poll(async()=> (await (await request.get('/api/bills')).json()).filter((b:any)=>b.clientName==='Browser recurring client').length).toBe(1);
 const bills=await (await request.get('/api/bills')).json();expect(bills.find((b:any)=>b.clientName==='Browser recurring client').totalAmount).toBe(118);
 await page.reload();await expect(page.locator('tbody tr').filter({hasText:'Browser recurring client'})).toContainText('Paused');
});
