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
 // Playwright starts this test in its isolated KNOWGST_RUNTIME. Persist the
 // fictional records through normal APIs so screenshots and dashboard totals
 // describe the same saved business, rather than a second set of UI mocks.
 const save = async (url:string, data:unknown) => {
  const response=await request.post(url,{data});
  expect(response.ok(),`${url}: ${await response.text()}`).toBe(true);
  return response.json();
 };
 const profile={id:'guide-demo',businessName:'Sample Studio',address:'Pune, Maharashtra',state:'Maharashtra',country:'India',gstin:'',email:'studio@example.com'};
 await save('/api/profile',profile);
 await save('/api/local-prefs',{set:{gst_printSettings:JSON.stringify({onboardingComplete:true}),freegstbill_onboarded:'true',freegstbill_theme:'light'}});
 const now=new Date();
 const today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
 const fy=now.getMonth()>=3?now.getFullYear():now.getFullYear()-1;
 const invoiceNumber=`INV/${String(fy).slice(-2)}-${String(fy+1).slice(-2)}/0001`;
 const supplierInvoice=`SUP-${now.getFullYear()}-001`;
 const client={id:'guide-client',businessId:profile.id,name:'Sample Client',email:'client@example.com',address:'Mumbai',state:'Maharashtra',country:'India'};
 await save('/api/clients',client);
 await save('/api/products',{id:'guide-product',businessId:profile.id,name:'Design services',type:'service',hsn:'998314',unit:'Service',purchasePrice:2500,sellingPrice:5000,taxPercent:18,trackStock:false,stock:0});
 const bill={
  id:'guide-invoice',businessId:profile.id,invoiceNumber,invoiceDate:today,clientName:client.name,invoiceType:'tax-invoice',totalAmount:5900,totalTaxAmount:900,status:'partial',paidAmount:2000,currency:'INR',
  payments:[{id:'guide-payment',receiptNo:'RCPT-GUIDE-001',date:today,amount:2000,mode:'bank-transfer',note:'Fictional guide payment'}],
  data:{profile,client,details:{invoiceDate:today,dueDate:today},invoiceType:'tax-invoice',invoiceOptions:{currency:'INR'},items:[{name:'Design services',hsn:'998314',unit:'Service',quantity:1,rate:5000,taxPercent:18,cessPercent:0}],totals:{subtotal:5000,taxableAmount:5000,total:5900,totalTaxAmount:900,cgst:450,sgst:450,igst:0,cess:0}},
 };
 await save('/api/invoice-transactions',{operations:[{bill}]});
 await save('/api/purchases',{id:'guide-purchase',businessId:profile.id,invoiceNumber:supplierInvoice,date:today,supplierName:'Sample Supplier',supplierAddress:'Pune',paymentStatus:'Unpaid',interstate:false,ownerName:profile.businessName,profile,currency:'INR',totalAmount:1180,totalTaxAmount:180,items:[{name:'Office supplies',quantity:2,rate:500,taxPercent:18,cessPercent:0}]});
 const purchase=(await (await request.get('/api/purchases')).json()).find((row:{id:string})=>row.id==='guide-purchase');
 await save('/api/accounting/supplier-payments',{id:'guide-supplier-payment',purchaseId:purchase.id,revision:purchase._revision,amount:'400',date:today,account:'1000'});
 await save('/api/expenses',{id:'guide-expense',businessId:profile.id,description:'Workspace subscription',date:today,amount:1200,gstAmount:0,category:'Office',ownerName:profile.businessName,profile,currency:'INR'});
 const summaryResponse=await request.get(`/api/dashboard?month=${today.slice(0,7)}&currency=INR`);
 expect(summaryResponse.ok()).toBe(true);
 const summary=await summaryResponse.json();
 expect(summary).toMatchObject({businessId:profile.id,sales:500000,received:200000,spent:160000,outstanding:390000,payable:78000,unassigned:0,warnings:[],activityTotal:4});
 expect(summary.activity.map((row:{id:string})=>row.id)).toEqual(expect.arrayContaining(['guide-invoice','guide-payment','guide-purchase','guide-expense']));
 await page.route('**/api/recurring',r=>r.fulfill({json:[]}));
 const dir='apps/parity/public/docs/screenshots';await mkdir(dir,{recursive:true});
 const screens=[['dashboard','dashboard'],['invoice-register','invoices'],['invoice','new'],['clients','clients'],['products','inventory'],['purchases','purchases'],['expenses','expenses'],['receipts','receipts'],['recurring','recurring'],['reports','reports'],['gst','filing'],['income-tax','incometax'],['settings','settings'],['control-panel','controlpanel']];
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 for(const [name,view] of screens){
  await page.goto(`/?view=${view}`);await expect(page.locator('.main-content')).toBeVisible();
  await expect(page.getByText('Loading…',{exact:true})).toHaveCount(0);await page.evaluate(()=>document.fonts.ready);
  const loaded:Record<string,string>={dashboard:'Recent activity',invoices:invoiceNumber,clients:'Sample Client',inventory:'Design services',purchases:supplierInvoice,expenses:'Workspace subscription',receipts:'RCPT-GUIDE-001'};
  if(loaded[view!]) await expect(page.locator('.main-content')).toContainText(loaded[view!]!);
  if(view==='dashboard'){
   await expect(page.locator('.overview-metric').filter({hasText:'Sales · excluding GST'})).toContainText('5,000.00');
   await expect(page.locator('.overview-metric').filter({hasText:'Money received'})).toContainText('2,000.00');
   await expect(page.locator('.overview-metric').filter({hasText:'Customers owe you'})).toContainText('3,900.00');
   await expect(page.locator('.overview-metric').filter({hasText:'You owe suppliers'})).toContainText('780.00');
   await expect(page.locator('.overview-table tbody tr')).toHaveCount(4);
   await expect(page.locator('.overview-table')).toContainText('Sample Client');
   await expect(page.locator('.overview-table')).toContainText('Workspace subscription');
   await expect(page.locator('.overview-warning')).toHaveCount(0);
  }
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
 await page.goto('/?view=settings');await page.getByRole('navigation',{name:'Settings sections'}).getByRole('link',{name:'Integrations',exact:true}).click();await expect(page.getByRole('navigation',{name:'Settings sections'}).getByRole('link',{name:'Integrations',exact:true})).toHaveAttribute('aria-current','location');await expect(page.locator('#section-integrations').getByRole('button',{name:'Continue with ChatGPT'})).toBeVisible();await page.screenshot({path:`${dir}/integrations.png`});
 await save('/api/integrations/resend',{from:'studio@example.com',name:'Sample Studio',apiKey:'re_fictional_guide_only_123456'});
 await page.goto('/?view=invoices');await page.getByRole('row').filter({hasText:invoiceNumber}).getByRole('button',{name:/^More actions/}).click();await page.getByText('Email PDF with Resend',{exact:true}).click();await expect(page.getByRole('dialog',{name:'Email invoice'}).getByRole('link',{name:/Review PDF/})).toBeVisible();await page.getByRole('dialog').getByLabel('Recipient email').fill('client@example.com');await page.screenshot({path:`${dir}/email-invoice.png`});await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
 await page.goto('/?view=purchases');await page.getByRole('button',{name:'Add Purchase',exact:true}).first().click();
 await page.getByPlaceholder(/^(Vendor \/ Supplier name|Type or pick a previous supplier)$/).fill('Sample Supplier');
 await page.getByPlaceholder('Supplier invoice no.').fill(`SUP-${now.getFullYear()}-002`);
 await page.getByPlaceholder(/^(Item name|Type or pick a previous item)$/).fill('Office supplies');
 await page.locator('.form-group').filter({has:page.locator('label').filter({hasText:/^Rate$/})}).locator('input').fill('500');
 await page.getByRole('heading',{name:'Add Purchase Bill'}).click();
 await page.screenshot({path:`${dir}/purchase-form.png`});
 expect(errors).toEqual([]);
 await page.goto('/docs/?topic=purchases');await expect(page.locator('h1')).toHaveText('Record purchase bills');await expect.poll(()=>page.locator('main img').evaluateAll(els=>els.every(el=>(el as HTMLImageElement).complete))).toBe(true);await page.screenshot({path:'docs/verification/guide-desktop.png',fullPage:true});
});
