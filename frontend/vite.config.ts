import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Encaminha /api para o `vercel dev` (porta 3000 por padrão) rodando em WhatsApp-Fin.
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
