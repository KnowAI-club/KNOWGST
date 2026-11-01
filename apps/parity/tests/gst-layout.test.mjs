import test from 'node:test';
import assert from 'node:assert/strict';
import { gstLayoutField } from '../src/utils/gstLayout.js';
import { BUSINESS_PRESETS, applyBusinessPreset, buildSampleInvoice } from '../src/utils/printSettings.js';
import { computeInvoiceTotals } from '../src/utils.js';
test('Indian issued document particulars cannot be hidden by cosmetic settings',()=>{
 for(const type of ['tax-invoice','bill-of-supply','composition','credit-note'])
  for(const key of ['showGSTIN','showHSN','showInvoiceNumber','showInvoiceDate','showItemUnit','showClientAddress'])assert.equal(gstLayoutField({country:'India'},type,key),true);
 assert.equal(gstLayoutField({country:'India'},'quotation','showGSTIN'),false);
 assert.equal(gstLayoutField({country:'UAE'},'tax-invoice','showGSTIN'),false);
 assert.equal(gstLayoutField({},'tax-invoice','showLogo'),false);
});
test('every business preset preserves HSN/SAC and neutral identity without tax-scheme assumptions',()=>{
 for(const key of Object.keys(BUSINESS_PRESETS)){
  const result=applyBusinessPreset({pdfAccent:'#ff0000',gstin:'kept',taxRate:12},key);
  assert.equal(result.showHSN,true);assert.equal(result.pdfAccent,'#343c34');
  assert.equal(result.gstin,'kept');assert.equal(result.taxRate,12);
  assert.equal(result.autoPrintOnSave,false);
 }
});
test('sample invoice figures reconcile to the actual calculation',()=>{
 const sample=buildSampleInvoice();
 const computed=computeInvoiceTotals({...sample,showGST:true});
 assert.equal(sample.totals.total,computed.total);
 assert.equal(sample.totals.cgst+sample.totals.sgst,computed.totalTaxAmount);
});
