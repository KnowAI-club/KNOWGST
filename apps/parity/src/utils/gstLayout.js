// Keep the standard Indian document particulars visible. This is a layout
// safeguard, not GST registration, e-invoice validation or a tax calculation.
const particulars = new Set(['showBusinessName','showBusinessAddress','showState','showGSTIN','showClientAddress','showPlaceOfSupply','showInvoiceNumber','showInvoiceDate','showHSN','showItemQty','showItemUnit','showSubtotal']);
export function gstLayoutField(profile, type, key) {
  return (profile?.country || 'India') === 'India'
    && ['tax-invoice','bill-of-supply','composition','credit-note'].includes(type)
    && particulars.has(key);
}
