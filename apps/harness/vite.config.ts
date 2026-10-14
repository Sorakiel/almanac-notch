import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// tools/snapshot.mjs --target port expects the harness at http://localhost:5173/harness.html
export default defineConfig({
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  build: { rollupOptions: { input: resolve(import.meta.dirname, 'harness.html') } },
});
