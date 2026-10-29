import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 4173 },
  build: { chunkSizeWarningLimit: 1000, rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom'], pdf: ['jspdf','html2canvas','pdf-lib'], ocr: ['tesseract.js'] } } } },
});
