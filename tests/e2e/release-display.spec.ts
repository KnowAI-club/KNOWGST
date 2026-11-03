import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../../apps/parity/package.json',import.meta.url));
const { PDFDocument }=require('pdf-lib');
const profile={id:'release-display',businessName:'Release display',state:'Maharashtra',country:'India'};
test('services stay out of alerts and short batch invoices use one page each',async({page,request},testInfo)=>{
  test.setTimeout(90000);
  await request.post('/api/profile',{data:profile});
  await request.post('/api/local-prefs',{data:{set:{gst_printSettings:JSON.stringify({onboardingComplete:true}),freegstbill_onboarded:'true'}}});
  for(const product of [{id:'release-service',name:'Release support',unit:'service',hsn:'998313',stock:0},{id:'release-goods',name:'Release keyboard',unit:'Pcs',stock:2}])
    expect((await request.post('/api/products',{data:product})).ok()).toBe(true);
  const summary=await (await request.get('/api/dashboard?month=2026-11&currency=INR')).json();
  expect(summary.lowStock.map((p:any)=>p.name)).toEqual(['Release keyboard']);
  await page.goto('/?view=inventory');
  await expect(page.getByRole('row').filter({hasText:'Release support'}).first()).toContainText('Not tracked');
  for(let i=1;i<=2;i++){
    const id=`RELEASE-PDF-${i}`;
    const bill={id,invoiceNumber:id,invoiceType:'tax-invoice',invoiceDate:'2026-11-01',clientName:'Release client',totalAmount:118,totalTaxAmount:18,status:'unpaid',payments:[],data:{profile,client:{name:'Release client',state:'Maharashtra'},details:{invoiceNumber:id,invoiceDate:'2026-11-01'},items:[{name:'Support',hsn:'998313',quantity:1,rate:100,taxPercent:18}],totals:{subtotal:100,taxableAmount:100,cgst:9,sgst:9,igst:0,totalTaxAmount:18,total:118},invoiceType:'tax-invoice',customTerms:'For regression testing only.',invoiceOptions:{currency:'INR',paperSize:'a4',pdfStyle:'modern',showGST:true,showHSN:true}}};
    expect((await request.post('/api/bills',{data:bill})).ok()).toBe(true);
  }
  await page.goto('/?view=invoices');
  await expect(page.locator('.low-stock-ticker')).not.toContainText('Release support');
  const downloaded=page.waitForEvent('download');
  await page.getByRole('button',{name:'All shown (2)',exact:true}).click();
  const file=await downloaded;const output=testInfo.outputPath('batch.pdf');await file.saveAs(output);
  expect((await PDFDocument.load(await readFile(output))).getPageCount()).toBe(2);
  await page.screenshot({path:testInfo.outputPath('invoice-register.png'),fullPage:true});
});

test('offline startup instructions identify KnowGST only', async ({ page }) => {
  await page.route('**/api/profile', route=>route.abort());
  await page.goto('/');
  await expect(page.locator('.server-down-modal')).toBeVisible({timeout:20000});
  await expect(page.locator('.server-down-steps')).toContainText('"KnowGST"');
  await expect(page.locator('.server-down-steps')).not.toContainText('Free GST');
});
