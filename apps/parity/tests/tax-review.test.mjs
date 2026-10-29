import test from 'node:test';
import assert from 'node:assert/strict';
import {computeTax,getNewRegimeSlabs,get87AConfig,computeSlabTax,computeRebate87A} from '../src/utils/itr.js';
import {estimateCurrentYear} from '../src/utils/currentTaxYear.js';
test('AY 2026-27 filing slabs and rebate match official ordinary-income examples',()=>{
 const slabs=getNewRegimeSlabs('2025-26');
 for(const [income,tax] of [[400000,0],[800000,20000],[1200000,60000],[1600000,120000],[2000000,200000],[2400000,300000],[2500000,330000]]) assert.equal(computeSlabTax(income,slabs),tax);
 assert.equal(computeRebate87A(1200000,60000,'new','2025-26'),60000);
 assert.equal(computeRebate87A(1210000,61500,'new','2025-26'),51500);
 assert.deepEqual(get87AConfig('old','2025-26'),{threshold:500000,cap:12500});
});
test('filing engine rejects unsupported years instead of using obsolete defaults',()=>{
 for(const fy of ['2023-24','2026-27','2027-28','bad']) {
  assert.throws(()=>computeTax({fy,regime:'new',salary:1600000}),/Unsupported filing year/);
  assert.throws(()=>getNewRegimeSlabs(fy),/Unsupported filing year/);
  assert.throws(()=>get87AConfig('old',fy),/Unsupported filing year/);
 }
});
test('Tax Year 2026-27 ordinary-resident estimate covers rebate, marginal relief, salary and bounds',()=>{
 assert.equal(estimateCurrentYear({income:1200000}).total,0);
 assert.equal(estimateCurrentYear({income:1275000,salary:true}).total,0);
 assert.equal(estimateCurrentYear({income:1210000}).total,10400);
 assert.equal(estimateCurrentYear({income:2400000}).total,312000);
 assert.equal(estimateCurrentYear({income:2500000}).total,343200);
 assert.equal(estimateCurrentYear({income:50000,salary:true}).deduction,50000);
 assert.throws(()=>estimateCurrentYear({income:5000001}),/surcharge/);
 assert.throws(()=>estimateCurrentYear({income:-1}),/non-negative/);
 assert.throws(()=>estimateCurrentYear({income:Infinity}),/non-negative/);
});
