import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// tools/snapshot.mjs --target port expects the dev harness at http://localhost:5173/harness.html;
// npm run parity serves the build on 5174 (tools/parity.mjs)
export default defineConfig({
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  build: { outDir: 'dist/web', rollupOptions: { input: resolve(import.meta.dirname, 'harness.html') } },
});
