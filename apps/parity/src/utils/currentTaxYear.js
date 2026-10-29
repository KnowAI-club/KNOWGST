// Ordinary resident-individual income only. Not an ITR schema or capital-gains engine.
// Sources and scope: docs/TAX-RULE-REVIEW.md (reviewed 2026-10-29).
export const TAX_YEAR='2026-27';
export function estimateCurrentYear({income=0,salary=false}={}) {
  const gross=Number(income);
  if(!Number.isFinite(gross)||gross<0) throw new Error('Enter a non-negative income amount');
  const deduction=salary?Math.min(75000,gross):0;
  const taxable=Math.max(0,gross-deduction);
  // Explicit upper bound: surcharge/special-rate and nonresident cases are outside this estimator.
  if(taxable>5000000) throw new Error('Income above ₹50 lakh requires a surcharge-aware calculation');
  const limits=[400000,800000,1200000,1600000,2000000,2400000,Infinity];
  const rates=[0,.05,.1,.15,.2,.25,.3];
  let tax=0,lower=0;
  for(let i=0;i<limits.length;i++){tax+=Math.max(0,Math.min(taxable,limits[i])-lower)*rates[i];lower=limits[i];if(taxable<=lower)break;}
  const rebate=taxable<=1200000?Math.min(tax,60000):Math.max(0,tax-(taxable-1200000));
  const afterRebate=Math.max(0,tax-rebate),cess=afterRebate*.04;
  return {taxYear:TAX_YEAR,taxable,deduction,tax,rebate,cess,total:Math.round((afterRebate+cess)/10)*10};
}
