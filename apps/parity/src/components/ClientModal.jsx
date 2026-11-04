import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { getCountryConfig, getStatesForCountry, validateTaxId, detectCountryFromBrowser, getCountriesForRegion, PAPER_SIZES, decodeGstin } from '../utils';
import { getRegionMode } from '../store';
import { validatePhone, validateEmail, getAddressErrors, hasAddressErrors, getCitiesForCountry } from '../utils/addressValidation';

export default function ClientModal({ show, onClose, onSave, client, isEditing, defaultCountry }) {
  // Country defaults: explicit prop (active business profile) → browser locale → 'India'.
  const fallbackCountry = defaultCountry || detectCountryFromBrowser();
  const emptyForm = {
    name: '', address: '', city: '', pin: '', state: '', gstin: '', email: '', phone: '',
    country: fallbackCountry, isSEZ: false,
    // v1.9.1 - per-client print preferences. When set, they auto-populate
    // invoiceOptions when the user creates a new invoice for this client.
    // Left blank = use app-wide defaults.
    preferredPaperSize: '',   // '' | 'a4' | 'a5' | 'thermal80' | ...
    preferredCurrency: '',    // '' | 'INR' | 'USD' | ...
    autoPrint: false,          // per-client auto-print override
  };
  const [form, setForm] = useState({ ...emptyForm });
  const [taxIdWarning, setTaxIdWarning] = useState('');

  useEffect(() => {
    if (show && client) {
      setForm({
        name: client.name || '', address: client.address || '', city: client.city || '',
        pin: client.pin || '', state: client.state || '', gstin: client.gstin || '',
        email: client.email || '', phone: client.phone || '', country: client.country || fallbackCountry,
        isSEZ: !!client.isSEZ,
        preferredPaperSize: client.preferredPaperSize || '',
        preferredCurrency: client.preferredCurrency || '',
        autoPrint: !!client.autoPrint,
      });
    } else if (show) {
      setForm({ ...emptyForm });
    }
    setTaxIdWarning('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, client]);

  if (!show) return null;

  const cc = getCountryConfig(form.country);
  const addrErrors = { ...getAddressErrors(form.country, form), phone: validatePhone(form.phone).message, email: validateEmail(form.email).message };
  const errStyle = { color: '#dc2626', fontSize: '0.7rem', display: 'block', marginTop: '0.2rem' };
  const stateOptions = getStatesForCountry(form.country);

  // v1.10.68 (#68, idea from @deppen12) - a GSTIN already says which state the
  // client is registered in and carries a checksum, so fill the state in and
  // catch a typo here, offline. The state drives place of supply, so a wrong
  // one silently swaps CGST + SGST for IGST on every invoice to this client.
  const handleTaxIdBlur = () => {
    const result = validateTaxId(form.country, form.gstin);
    setTaxIdWarning(result.ok ? '' : result.message);
    if (form.country !== 'India') return;
    const decoded = decodeGstin(form.gstin);
    if (!decoded) return;
    if (!decoded.checksumOk) {
      setTaxIdWarning('This GSTIN fails its own checksum - check for a typo.');
      return;
    }
    if (!decoded.state) return;
    if (!form.state?.trim()) {
      setForm(prev => ({ ...prev, state: decoded.state }));
    } else if (form.state.trim().toLowerCase() !== decoded.state.toLowerCase()) {
      setTaxIdWarning(`This GSTIN is registered in ${decoded.state}, but the state says ${form.state}.`);
    }
  };

  const handleSave = () => {
    if (!form.name.trim()) return;
    if (hasAddressErrors(addrErrors)) return;
    onSave(form);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '520px' }}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="section-title" style={{ margin: 0 }}>{isEditing ? 'Edit Client' : 'Add New Client'}</h3>
          <button type="button" className="icon-btn" onClick={onClose} title="Close"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label className="form-label">Client / Business Name *</label>
            <input type="text" className="form-input" value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder="e.g. Acme Corp" />
          </div>
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label className="form-label">Address</label>
            <input type="text" className="form-input" value={form.address} onChange={e => setForm(prev => ({ ...prev, address: e.target.value }))} placeholder="Street address, locality" />
          </div>
          <div className="form-group">
            <label className="form-label">Country</label>
            <select className="form-input" value={form.country} onChange={e => setForm(prev => ({ ...prev, country: e.target.value, state: '' }))}>
              {(() => {
                const visible = getCountriesForRegion(getRegionMode());
                const out = [];
                if (form.country && !visible.some(c => c.name === form.country)) {
                  out.push(<option key={form.country} value={form.country}>{form.country}</option>);
                }
                return out.concat(visible.map(c => <option key={c.code} value={c.name}>{c.name}</option>));
              })()}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">City</label>
            <input type="text" className="form-input" list="client-city-options" value={form.city}
              style={addrErrors.city ? { borderColor: '#dc2626' } : undefined}
              onChange={e => setForm(prev => ({ ...prev, city: e.target.value }))} placeholder="e.g. Mumbai" />
            <datalist id="client-city-options">{getCitiesForCountry(form.country).map(c => <option key={c} value={c} />)}</datalist>
            {addrErrors.city && <small style={errStyle}>{addrErrors.city}</small>}
          </div>
          <div className="form-group">
            <label className="form-label">{cc.postalLabel}</label>
            <input type="text" className="form-input" inputMode={form.country === 'India' ? 'numeric' : undefined}
              maxLength={form.country === 'India' ? 6 : undefined}
              style={addrErrors.pin ? { borderColor: '#dc2626' } : undefined}
              value={form.pin} onChange={e => setForm(prev => ({ ...prev, pin: e.target.value }))} placeholder={cc.postalLabel} />
            {addrErrors.pin && <small style={errStyle}>{addrErrors.pin}</small>}
          </div>
          <div className="form-group">
            <label className="form-label">{cc.stateLabel}</label>
            {stateOptions.length > 0 ? (
              <select className="form-input" value={form.state} onChange={e => setForm(prev => ({ ...prev, state: e.target.value }))}>
                <option value="">Select {cc.stateLabel}</option>
                {stateOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <input type="text" className="form-input" value={form.state} onChange={e => setForm(prev => ({ ...prev, state: e.target.value }))} placeholder={cc.stateLabel} />
            )}
          </div>
          <div className="form-group">
            <label className="form-label">{cc.taxIdLabel}</label>
            <input type="text" className="form-input"
              style={addrErrors.gstin ? { borderColor: '#dc2626' } : taxIdWarning ? { borderColor: '#f59e0b' } : undefined}
              value={form.gstin}
              onChange={e => { setForm(prev => ({ ...prev, gstin: e.target.value.toUpperCase() })); if (taxIdWarning) setTaxIdWarning(''); }}
              onBlur={handleTaxIdBlur}
              placeholder={cc.taxIdPlaceholder} maxLength={form.country === 'India' ? 15 : 20} />
            {addrErrors.gstin && <small style={errStyle}>{addrErrors.gstin}</small>}
            {!addrErrors.gstin && taxIdWarning && <small style={{ color: '#d97706', fontSize: '0.7rem', display: 'block', marginTop: '0.2rem' }}>⚠ {taxIdWarning}</small>}
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input type="email" className="form-input" value={form.email} style={addrErrors.email ? { borderColor: '#dc2626' } : undefined} onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))} placeholder="client@example.com" />
            {addrErrors.email && <small style={errStyle}>{addrErrors.email}</small>}
          </div>
          <div className="form-group">
            <label className="form-label">Phone</label>
            <input type="tel" className="form-input" maxLength={20} value={form.phone} style={addrErrors.phone ? { borderColor: '#dc2626' } : undefined} onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))} placeholder="+91 98765 43210" />
            {addrErrors.phone && <small style={errStyle}>{addrErrors.phone}</small>}
          </div>
          {form.country === 'India' && (
            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!form.isSEZ}
                  onChange={e => setForm(prev => ({ ...prev, isSEZ: e.target.checked }))}
                  style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
                <span><strong>SEZ unit / Developer</strong> - supplies will be charged IGST regardless of state (Section 16, IGST Act).</span>
              </label>
            </div>
          )}

          {/* v1.9.1 - per-client print preferences. All optional; leave blank
              to use the app-wide defaults from Settings. When set, they
              auto-apply the next time an invoice is created for this client. */}
          <div className="form-group" style={{ gridColumn: 'span 2', paddingTop: '0.5rem', borderTop: '1px solid var(--border)', marginTop: '0.5rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
              Print preferences (optional)
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>
              Auto-applied when you create a new invoice for this client. Leave blank to use app-wide defaults.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 3 }}>Preferred paper size</label>
                <select className="form-input" style={{ fontSize: '0.8rem', padding: '0.35rem' }}
                  value={form.preferredPaperSize}
                  onChange={e => setForm(prev => ({ ...prev, preferredPaperSize: e.target.value }))}>
                  <option value="">Use app default</option>
                  {Object.entries(PAPER_SIZES).map(([key, ps]) => (
                    <option key={key} value={key}>{ps.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 3 }}>Preferred currency</label>
                <select className="form-input" style={{ fontSize: '0.8rem', padding: '0.35rem' }}
                  value={form.preferredCurrency}
                  onChange={e => setForm(prev => ({ ...prev, preferredCurrency: e.target.value }))}>
                  <option value="">Use invoice default</option>
                  <option value="INR">INR (₹)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="AED">AED (د.إ)</option>
                  <option value="SGD">SGD (S$)</option>
                  <option value="AUD">AUD (A$)</option>
                </select>
              </div>
              <label style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', cursor: 'pointer', marginTop: '0.2rem' }}>
                <input type="checkbox" checked={!!form.autoPrint}
                  onChange={e => setForm(prev => ({ ...prev, autoPrint: e.target.checked }))}
                  style={{ width: 15, height: 15, accentColor: 'var(--primary)' }} />
                <span><strong>Auto-print on save for this client</strong> - overrides global setting</span>
              </label>
            </div>
          </div>
        </div>
        <div className="flex gap-2 justify-end mt-4">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={handleSave}>{isEditing ? 'Update Client' : 'Save Client'}</button>
        </div>
      </div>
    </div>
  );
}
