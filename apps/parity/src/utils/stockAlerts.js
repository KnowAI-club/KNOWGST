// Alert classification only: never changes saved stock or financial postings.
export function isServiceItem(product = {}) {
  const kind = String(product.type || product.kind || '').toLowerCase();
  const unit = String(product.unit || '').trim().toLowerCase();
  return ['service', 'services'].includes(kind)
    || /^(service|services|hrs?|hours?|days?|weeks?|months?|years?)$/.test(unit)
    || /^99\d{4}$/.test(String(product.hsn || '').trim());
}

export function isLowStock(product, threshold = 5) {
  return !isServiceItem(product) && product.trackStock !== false
    && product.stock !== null && product.stock !== undefined && product.stock !== ''
    && Number.isFinite(Number(product.stock)) && Number(product.stock) <= threshold;
}
