import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

test('documentation topics, screenshots, search and contextual help work',async({page,request})=>{
 await page.goto('/docs/?topic=purchases');
 await expect(page.getByRole('heading',{name:'Record purchase bills',exact:true})).toBeVisible();
 for(const image of await page.locator('main img').all()) {
  await expect(image).toBeVisible();
  await expect.poll(()=>image.evaluate((el:HTMLImageElement)=>el.complete&&el.naturalWidth>0)).toBe(true);
 }
 await page.getByLabel('Find a topic').fill('back up');
 await expect(page.getByRole('navigation').getByRole('link',{name:'Back up and restore',exact:true})).toBeVisible();
 await page.getByRole('navigation').getByRole('link',{name:'Back up and restore',exact:true}).click();
 await expect(page.locator('h1')).toHaveText('Back up and restore');
 await page.getByLabel('Find a topic').fill('zzzz-no-match');
 await expect(page.getByRole('status')).toHaveText('0 topics found');
 await page.getByLabel('Find a topic').fill('');
 const links=await page.getByRole('navigation').getByRole('link').evaluateAll(els=>els.map(el=>(el as HTMLAnchorElement).href));
 for(const link of links){
  await page.goto(link);await expect(page.locator('h1')).toBeVisible();
  for(const image of await page.locator('main img').all()) expect((await request.get((await image.getAttribute('src'))!.replace('./','/docs/'))).ok()).toBe(true);
  for(const href of await page.locator('.contents a').evaluateAll(els=>els.map(e=>e.getAttribute('href')!))) await expect(page.locator(href)).toHaveCount(1);
 }
 await request.post('/api/local-prefs',{data:{set:{gst_printSettings:JSON.stringify({onboardingComplete:true}),freegstbill_onboarded:'true'}}});
 await page.goto('/?view=purchases');await page.getByTitle('How to use this section').click();
 await expect(page.getByRole('link',{name:'Read the full guide'})).toHaveAttribute('href','/docs/?topic=purchases');
});

test('documentation mobile navigation, theme and layout',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/docs/?topic=purchases');
 await page.getByRole('button',{name:'Topics',exact:true}).click();
 await page.getByRole('navigation').getByRole('link',{name:'Record expenses',exact:true}).click();
 await expect(page.locator('h1')).toHaveText('Record expenses');
 await page.getByRole('button',{name:'Switch to dark theme'}).click();
 await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'docs/verification/guide-mobile.png',fullPage:true});
});

test('capture actual app screens for the published guide',async({page,request})=>{
 test.skip(process.env.CAPTURE_DOCS!=='1','Explicit screenshot refresh only');test.setTimeout(120000);
 const profile={id:'guide-demo',businessName:'Sample Studio',address:'Pune, Maharashtra',state:'Maharashtra',country:'India',gstin:'',email:'studio@example.com'};
 await request.post('/api/profile',{data:profile});
 await request.post('/api/local-prefs',{data:{set:{gst_printSettings:JSON.stringify({onboardingComplete:true}),freegstbill_onboarded:'true'}}});
 const today=new Date().toISOString().slice(0,10);
 await page.route('**/api/clients',r=>r.fulfill({json:[{id:'guide-client',name:'Sample Client',email:'client@example.com',address:'Mumbai',state:'Maharashtra',country:'India'}]}));
 await page.route('**/api/products',r=>r.fulfill({json:[{id:'guide-product',name:'Design services',hsn:'998314',unit:'Nos',purchasePrice:2500,sellingPrice:5000,taxPercent:18,stock:10}]}));
 await page.route('**/api/purchases',r=>r.fulfill({json:[{id:'guide-purchase',invoiceNumber:'SUP-2026-001',date:today,supplierName:'Sample Supplier',supplierAddress:'Pune',paymentStatus:'Unpaid',interstate:false,ownerName:profile.businessName,profile,items:[{name:'Office supplies',quantity:2,rate:500,taxPercent:18}]}]}));
 await page.route('**/api/expenses',r=>r.fulfill({json:[{id:'guide-expense',description:'Workspace subscription',date:today,amount:1200,gstAmount:0,category:'Office',ownerName:profile.businessName,profile,currency:'INR'}]}));
 await page.route('**/api/receipts',r=>r.fulfill({json:[]}));
 await page.route('**/api/recurring',r=>r.fulfill({json:[]}));
 await page.route('**/api/bills',r=>r.fulfill({json:[{id:'guide-invoice',invoiceNumber:'INV/26-27/0001',invoiceDate:today,clientName:'Sample Client',invoiceType:'tax-invoice',totalAmount:5900,totalTaxAmount:900,status:'unpaid',paidAmount:0,currency:'INR',data:{profile,client:{name:'Sample Client',state:'Maharashtra',country:'India'},details:{invoiceDate:today},invoiceType:'tax-invoice',invoiceOptions:{currency:'INR'},items:[{name:'Design services',quantity:1,rate:5000,taxPercent:18}],totals:{subtotal:5000,taxableAmount:5000,total:5900,totalTaxAmount:900,cgst:450,sgst:450,igst:0}}}]}));
 const dir='apps/parity/public/docs/screenshots';await mkdir(dir,{recursive:true});
 const screens=[['dashboard','dashboard'],['invoice','new'],['clients','clients'],['products','inventory'],['purchases','purchases'],['expenses','expenses'],['receipts','receipts'],['recurring','recurring'],['reports','reports'],['gst','filing'],['income-tax','incometax'],['settings','settings'],['control-panel','controlpanel']];
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 for(const [name,view] of screens){
  await page.goto(`/?view=${view}`);await expect(page.locator('.main-content')).toBeVisible();
  await expect(page.getByText('Loading…',{exact:true})).toHaveCount(0);await page.evaluate(()=>document.fonts.ready);
  const loaded:Record<string,string>={dashboard:'INV/26-27/0001',clients:'Sample Client',inventory:'Design services',purchases:'SUP-2026-001',expenses:'Workspace subscription'};
  if(loaded[view!]) await expect(page.locator('.main-content')).toContainText(loaded[view!]!);
  if(view==='new'){
   await page.getByPlaceholder('Type client name to search or add new').fill('Sample Client');
   await page.getByPlaceholder('Item',{exact:true}).fill('Design services');
   await page.locator('.line-item-field').filter({has:page.locator('label').filter({hasText:/^Rate$/})}).locator('input').fill('5000');
   await page.getByTitle('Fit preview to the pane width').click();
   await page.getByPlaceholder('Type client name to search or add new').scrollIntoViewIfNeeded();
   await page.evaluate(()=>{for(const el of document.querySelectorAll('*')) if(el instanceof HTMLElement && el.scrollTop) el.scrollTop=0;});
  }
  await page.screenshot({path:`${dir}/${name}.png`});
 }
 await page.goto('/?view=purchases');await page.getByRole('button',{name:'Add Purchase',exact:true}).first().click();
 await page.getByPlaceholder(/^(Vendor \/ Supplier name|Type or pick a previous supplier)$/).fill('Sample Supplier');
 await page.getByPlaceholder('Supplier invoice no.').fill('SUP-2026-002');
 await page.getByPlaceholder(/^(Item name|Type or pick a previous item)$/).fill('Office supplies');
 await page.locator('.form-group').filter({has:page.locator('label').filter({hasText:/^Rate$/})}).locator('input').fill('500');
 await page.getByRole('heading',{name:'Add Purchase Bill'}).click();
 await page.screenshot({path:`${dir}/purchase-form.png`});
 expect(errors).toEqual([]);
 await page.goto('/docs/?topic=purchases');await expect(page.locator('h1')).toHaveText('Record purchase bills');await expect.poll(()=>page.locator('main img').evaluateAll(els=>els.every(el=>(el as HTMLImageElement).complete))).toBe(true);await page.screenshot({path:'docs/verification/guide-desktop.png',fullPage:true});
});
