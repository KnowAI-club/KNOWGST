import test from 'node:test';
import assert from 'node:assert/strict';
import { isServiceItem, isLowStock } from '../src/utils/stockAlerts.js';
import { a4CanvasSlices } from '../src/utils/pdfPagination.js';
test('service catalog entries never produce stock alerts; goods retain thresholds',()=>{
  for (const p of [{unit:'service'},{unit:'Hrs'},{hsn:'998313'},{type:'services'}]) {
    assert.equal(isServiceItem(p),true);
    assert.equal(isLowStock({...p,stock:0}),false);
  }
  assert.equal(isLowStock({unit:'Pcs',hsn:'847180',stock:0}),true);
  assert.equal(isLowStock({stock:5},5),true);
  assert.equal(isLowStock({stock:6},5),false);
  for(const stock of [null,undefined,'','invalid'])assert.equal(isLowStock({stock}),false);
  assert.equal(isLowStock({stock:0,trackStock:false}),false);
});
test('A4 canvas rounding does not split at footer into an empty second page',()=>{
  for(const [width,height] of [[794,1123],[1588,2246],[2381,3368]])
    assert.deepEqual(a4CanvasSlices(width,height,[Math.floor(height*.7)]),[{y:0,height}]);
});
test('long invoices keep every pixel and use safe row boundaries',()=>{
  const slices=a4CanvasSlices(794,2600,[900,1800]);
  assert.deepEqual(slices,[{y:0,height:900},{y:900,height:900},{y:1800,height:800}]);
  assert.equal(slices.reduce((s,p)=>s+p.height,0),2600);
  assert.throws(()=>a4CanvasSlices(0,100));
});
