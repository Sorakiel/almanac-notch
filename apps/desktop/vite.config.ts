import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Tauri dev loads the frontend from this fixed port (src-tauri/tauri.conf.json devUrl).
// `--mode setup`: only the Windows installer's page (apps/desktop/setup embeds dist/setup).
export default defineConfig(({ mode }) => ({
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  build: {
    target: 'safari16',
    outDir: mode === 'setup' ? 'dist/setup' : 'dist/web',
    // the island page, the settings window and the uninstall window
    rollupOptions: {
      input:
        mode === 'setup'
          ? { setup: resolve(__dirname, 'setup.html') }
          : {
              main: resolve(__dirname, 'index.html'),
              settings: resolve(__dirname, 'settings.html'),
              bye: resolve(__dirname, 'bye.html'),
            },
    },
  },
}));
