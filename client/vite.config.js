import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Another project on this machine may already hold 3001. Run both with
      // PORT=3011 (server) and API_URL=http://127.0.0.1:3011 (client) to move out
      // of its way — the default stays 3001 so nothing else changes.
      '/api': process.env.API_URL || 'http://127.0.0.1:3001',
    },
  },
});
