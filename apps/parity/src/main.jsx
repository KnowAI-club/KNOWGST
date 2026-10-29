import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import AppLockGate from './components/AppLock.jsx';
import { restorePrefs, startMirroring } from './utils/prefsMirror';
import './index.css';
import './knowgst.css';

// Local service is authoritative. No API caching or forced service-worker reloads.
restorePrefs().then(restored => {
  startMirroring(restored);
  createRoot(document.getElementById('root')).render(<StrictMode><AppLockGate><App /></AppLockGate></StrictMode>);
}).catch(() => {
  createRoot(document.getElementById('root')).render(<main role="alert" style={{padding:32}}>KNOWGST could not open local preferences. Restart the local service and reload.</main>);
});
