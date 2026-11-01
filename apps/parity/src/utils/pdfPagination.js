// Canvas dimensions are rounded independently by html2canvas. Allow two
// pixels of rounding before selecting a row boundary; otherwise a one-page
// invoice can split at its footer and export a blank continuation page.
export function a4CanvasSlices(width, height, breaks = []) {
  if (!(width > 0) || !(height > 0)) throw new Error('Invalid invoice canvas size');
  const capacity = Math.max(1, Math.floor(width * 297 / 210));
  const boundaries = [...breaks].filter(Number.isFinite).sort((a, b) => a - b);
  const slices = [];
  for (let y = 0; y < height;) {
    const remaining = height - y;
    let h = remaining <= capacity + 2 ? remaining : capacity;
    if (h < remaining) {
      const cut = boundaries.filter(b => b > y + capacity * 0.5 && b <= y + capacity).pop();
      if (cut) h = cut - y;
    }
    slices.push({ y, height: h });
    y += h;
  }
  return slices;
}
