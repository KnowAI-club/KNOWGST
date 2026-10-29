export default function AppFooter({ onOpenSupport }) {
  return <footer style={{padding:'20px 0',fontSize:11,color:'var(--text-muted)'}}>KNOWGST · Local workspace <button type="button" className="btn btn-secondary" style={{marginLeft:12,fontSize:11}} onClick={onOpenSupport}>About & licenses</button></footer>;
}
