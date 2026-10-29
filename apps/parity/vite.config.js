import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const guideIndex = server => { server.middlewares.use((req, _res, next) => {
  if (/^\/docs\/?(?:\?|$)/.test(req.url || '')) req.url = req.url.replace(/^\/docs\/?/, '/docs/index.html');
  next();
}); };
export default defineConfig({
  plugins: [react(), { name: 'guide-index', configureServer: guideIndex, configurePreviewServer: guideIndex }],
  server: { host: '127.0.0.1', port: 4173 },
  build: { chunkSizeWarningLimit: 1000, rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom'], pdf: ['jspdf','html2canvas','pdf-lib'], ocr: ['tesseract.js'] } } } },
});
