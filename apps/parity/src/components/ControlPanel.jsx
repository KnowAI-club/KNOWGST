import {useState,useEffect} from 'react';
import {HardDrive} from 'lucide-react';
import PageHeader from './PageHeader';
import {confirmAction} from './ConfirmModal';
export default function ControlPanel(){
 const [backups,setBackups]=useState([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function refresh(){const response=await fetch('/api/backups');if(!response.ok)throw new Error('Could not load backups');setBackups(await response.json());}
 useEffect(()=>{refresh().catch(e=>setMessage(e.message));},[]);
 async function run(url){setBusy(true);setMessage('');try{const response=await fetch(url,{method:'POST'});const result=await response.json();if(!response.ok||result.ok===false||result.success===false)throw new Error(result.error||'Action failed');setMessage(url.endsWith('/restore')?'Backup restored. Reload to use restored records.':'Completed successfully.');await refresh();}catch(e){setMessage(e.message);}finally{setBusy(false);}}
 async function restore(date){if(await confirmAction({title:`Restore backup ${date}?`,message:'This replaces records and PDFs with the selected snapshot. Current files are saved as a recovery copy first. Older data-only backups leave PDFs unchanged.',confirmLabel:'Restore backup',tone:'warning'}))await run(`/api/backups/${date}/restore`);}
 return <div className="dashboard-container">
  <PageHeader icon={<HardDrive size={22}/>} title="Control Panel" subtitle="Back up and restore your local workspace."/>
  <section className="glass-panel p-6">
   <h3>Complete workspace backups</h3><p className="text-muted">Includes records, settings, saved invoices, cancelled PDF originals and PDF trash. Each snapshot is checked before restoration. Use Settings to keep a second copy on another drive.</p>
   <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
    <button className="btn btn-primary" disabled={busy} onClick={()=>run('/api/control-panel/backup')}>{busy?'Working…':'Create Backup'}</button>
    <button className="btn btn-secondary" disabled={busy} onClick={()=>run('/api/control-panel/open-backups-folder')}>Open backups folder</button>
    <button className="btn btn-secondary" disabled={busy} onClick={()=>run('/api/control-panel/open-data-folder')}>Open data folder</button>
   </div>
   {message&&<p role="status">{message}</p>}
   <h3 style={{marginTop:24}}>Saved snapshots</h3>
   {backups.length===0?<p>No backups yet.</p>:<table className="data-table"><thead><tr><th>Date</th><th>Location</th><th>Action</th></tr></thead><tbody>{backups.map(b=><tr key={b.date}><td>{b.date}</td><td>{b.onlyInBackupFolder?'Secondary folder':'Local'}</td><td><button className="btn btn-secondary" disabled={busy} onClick={()=>restore(b.date)}>Restore</button></td></tr>)}</tbody></table>}
  </section>
 </div>;
}
