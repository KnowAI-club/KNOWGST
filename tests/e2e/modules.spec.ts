import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.beforeEach(async ({request}) => {
  await request.post('/api/profile',{data:{id:'e2e-business',businessName:'Demo Studio',address:'Pune, Maharashtra',state:'Maharashtra',country:'India',gstin:'',email:'demo@example.com'}});
  await request.post('/api/local-prefs',{data:{set:{gst_printSettings:JSON.stringify({onboardingComplete:true}),freegstbill_onboarded:'true'}}});
});
const modules = [
  ['dashboard','Dashboard'], ['new','New Invoice'], ['clients','Clients'], ['inventory','Products'], ['expenses','Expenses'], ['purchases','Purchases'],
  ['recurring','Recurring'], ['receipts','Receipts'], ['reports','Reports'], ['filing','GST Returns'], ['incometax','Income Tax'], ['settings','Settings'], ['controlpanel','Control Panel'], ['support','About KNOWGST'],
];
for (const [view,title] of modules) test(`${title} module loads without browser errors`,async ({page})=>{
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  const failures:string[]=[]; page.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=500) failures.push(`${r.status()} ${r.url()}`);});
  await page.goto(`/?view=${view}`);
  await expect(page.locator('.main-content')).toBeVisible();
  await expect(page.locator('.main-content')).toContainText(view === 'new' ? 'Invoice Details' : title!);
  await expect(page.locator('.sidebar-title')).toHaveText('KNOWGST');
  await expect(page.getByText('Loading…',{exact:true})).toHaveCount(0);
  expect(errors).toEqual([]); expect(failures).toEqual([]);
  if(view === 'dashboard') { await mkdir('docs/verification',{recursive:true}); await page.screenshot({path:'docs/verification/parity-dashboard.png',fullPage:true}); }
});

test('product catalog saves prices, stock and tax defaults',async ({page,request})=>{
  await page.goto('/?view=inventory');
  await page.getByRole('button',{name:'Add Product',exact:true}).first().click();
  await page.getByPlaceholder('e.g. Web Development').fill('Browser Test Product');
  await page.getByPlaceholder('e.g. 998314').fill('998314');
  await page.getByPlaceholder('0.00').nth(0).fill('500');
  await page.getByPlaceholder('0.00').nth(1).fill('1000');
  await page.getByPlaceholder('18',{exact:true}).fill('18');
  await page.getByPlaceholder('0',{exact:true}).fill('10');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('.main-content')).toContainText('Browser Test Product');
  const products=await (await request.get('/api/products')).json();
  const product=products.find((p:{name:string})=>p.name==='Browser Test Product');
  expect(product.sellingPrice).toBe(1000);expect(product.stock).toBe(10);
});

test('invoice saves legacy calculated totals and survives reload',async ({page,request})=>{
  await page.goto('/?view=new');
  await page.getByPlaceholder('Type client name to search or add new').fill('Invoice Test Client');
  await page.getByPlaceholder('Street address, locality',{exact:true}).fill('Mumbai');
  await page.locator('.form-group').filter({has:page.locator('label').filter({hasText:/^State$/})}).locator('select').selectOption({label:'Maharashtra'});
  await page.getByPlaceholder('Item',{exact:true}).fill('Consulting');
  await page.locator('.line-item-field').filter({has:page.locator('label').filter({hasText:/^Rate$/})}).locator('input').fill('100');
  const savedPdf = page.waitForResponse(r=>r.url().includes('/api/save-pdf') && r.request().method()==='POST');
  await page.getByRole('button',{name:'Save & Download',exact:true}).click();
  expect((await savedPdf).status()).toBe(200);
  await expect.poll(async()=> (await (await request.get('/api/bills')).json()).filter((b:{clientName:string})=>b.clientName==='Invoice Test Client').length).toBe(1);
  const bills=await (await request.get('/api/bills')).json();
  expect(bills.find((b:{clientName:string})=>b.clientName==='Invoice Test Client').totalAmount).toBe(118);
  await page.reload();
  await page.goto('/?view=dashboard');
  await expect(page.locator('.main-content')).toContainText('Invoice Test Client');
});

test('expenses persist from the user form',async ({page,request})=>{
  await page.goto('/?view=expenses');
  await page.getByRole('button',{name:'Add Expense',exact:true}).first().click();
  await page.getByPlaceholder('e.g. AWS Hosting - March').fill('Browser Test Expense');
  await page.getByPlaceholder('0.00').fill('200');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('.main-content')).toContainText('Browser Test Expense');
  expect((await (await request.get('/api/expenses')).json()).some((x:{description:string})=>x.description==='Browser Test Expense')).toBe(true);
});

test('purchase entry calculates supplier tax and persists',async ({page,request})=>{
  await page.goto('/?view=purchases');
  await page.getByRole('button',{name:'Add Purchase',exact:true}).first().click();
  await page.getByPlaceholder('Vendor / Supplier name').fill('Browser Test Supplier');
  await page.getByPlaceholder('Supplier invoice no.').fill('SUP-BROWSER-1');
  await page.getByPlaceholder(/^(Item name|Type or pick a previous item)$/).fill('Purchased item');
  await page.locator('.form-group').filter({has:page.locator('label').filter({hasText:/^Rate$/})}).locator('input').fill('100');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('.main-content')).toContainText('SUP-BROWSER-1');
  expect((await (await request.get('/api/purchases')).json()).some((x:{invoiceNumber:string})=>x.invoiceNumber==='SUP-BROWSER-1')).toBe(true);
});

test('receipt entry records a standalone payment',async ({page,request})=>{
  await page.goto('/?view=receipts');
  await page.getByRole('button',{name:'New Receipt',exact:true}).first().click();
  await page.locator('.form-group').filter({has:page.locator('label').filter({hasText:'Received From (Client Name)'})}).locator('input').fill('Receipt Test Client');
  await page.locator('.form-group').filter({has:page.locator('label').filter({hasText:/^Amount/})}).locator('input').fill('50');
  await page.getByRole('button',{name:'Save Receipt',exact:true}).click();
  await expect(page.locator('.main-content')).toContainText('Receipt Test Client');
  expect((await (await request.get('/api/receipts')).json()).some((x:{clientName:string})=>x.clientName==='Receipt Test Client')).toBe(true);
});

test('client creation persists through reload',async ({page})=>{
  await page.goto('/?view=clients');
  await page.getByRole('button',{name:/Add Client/i}).click();
  // The source form labels are being migrated to explicit accessible associations.
  await page.locator('.modal-overlay input').first().fill('Browser Test Client');
  await page.getByRole('button',{name:/Save Client/i}).click();
  await expect(page.locator('.main-content')).toContainText('Browser Test Client');
  await page.reload();
  await expect(page.locator('.main-content')).toContainText('Browser Test Client');
});

test('mobile navigation and dark theme work',async ({page,request})=>{
  // Preferences are shared by the test server across browser contexts.
  // Establish light mode explicitly after earlier dark-theme checks.
  const prefs = await request.post('/api/local-prefs',{data:{set:{freegstbill_theme:'light'}}});
  expect(prefs.ok()).toBe(true);
  await page.setViewportSize({width:390,height:844});
  await page.goto('/?view=dashboard');
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.getByRole('button',{name:'Open menu',exact:true}).click();
  await page.locator('.sidebar').getByRole('button',{name:'Clients',exact:true}).click();
  await expect(page.locator('.main-content')).toContainText('Clients');
  await page.getByRole('button',{name:'Open menu',exact:true}).click();
  await page.getByRole('button',{name:'Dark Mode',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar-open/);
  await expect.poll(()=>page.locator('.sidebar').evaluate(el=>el.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  await page.screenshot({path:'docs/verification/parity-mobile-dark.png',fullPage:true});
});
