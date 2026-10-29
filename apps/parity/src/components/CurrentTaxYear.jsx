import {useState} from 'react';
import {estimateCurrentYear,TAX_YEAR} from '../utils/currentTaxYear';
import {formatCurrency} from '../utils';
export default function CurrentTaxYear(){
 const [income,setIncome]=useState(''),[salary,setSalary]=useState(false);
 let result,error;try{result=estimateCurrentYear({income,salary});}catch(e){error=e.message;}
 return <details className="glass-panel" style={{padding:16,marginBottom:16}}>
  <summary>Tax Year {TAX_YEAR} · New-regime estimate</summary>
  <p className="text-muted">For resident individuals with ordinary income up to ₹50 lakh taxable income. Excludes capital gains, other special-rate income, surcharge and deductions other than the salary standard deduction. This is an estimate, not a filing return.</p>
  <label className="form-label" htmlFor="current-tax-income">Ordinary income before standard deduction</label>
  <input id="current-tax-income" className="form-input" type="number" min="0" value={income} onChange={e=>setIncome(e.target.value)}/>
  <label style={{display:'block',margin:'12px 0'}}><input type="checkbox" checked={salary} onChange={e=>setSalary(e.target.checked)}/> All income entered is salary or pension eligible for standard deduction</label>
  {error?<p role="alert">{error}</p>:<p role="status">Estimated tax including cess: <strong>{formatCurrency(result.total)}</strong> · Taxable income: {formatCurrency(result.taxable)}</p>}
 </details>;
}
