import { defineConfig } from 'vite';

// Tauri dev loads the frontend from this fixed port (src-tauri/tauri.conf.json devUrl).
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  build: { target: 'safari16', outDir: 'dist/web' },
});
