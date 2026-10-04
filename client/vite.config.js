import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // The libraries every screen runs get a chunk of their own: its hash only
        // moves when a dependency is upgraded, so after a deploy a phone downloads
        // the app's code again, not React with it. A list, not "all node_modules":
        // the calendar's libraries must stay in their own lazy chunk.
        manualChunks(id) {
          if (
            /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|i18next|react-i18next|@radix-ui|@floating-ui|tailwind-merge)[\\/]/.test(
              id
            )
          )
            return 'vendor';
        },
      },
    },
  },
  server: {
    proxy: {
      // Another project on this machine may already hold 3001. Run both with
      // PORT=3011 (server) and API_URL=http://127.0.0.1:3011 (client) to move out
      // of its way — the default stays 3001 so nothing else changes.
      '/api': process.env.API_URL || 'http://127.0.0.1:3001',
    },
  },
});
