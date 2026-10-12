import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const COACH_PORT = Number(process.env.COACH_PORT ?? 8787);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': `http://localhost:${COACH_PORT}` },
  },
  preview: {
    port: 5173,
    proxy: { '/api': `http://localhost:${COACH_PORT}` },
  },
  worker: { format: 'es' },
});
