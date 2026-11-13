import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The demo page imports the library source directly, so `npm run demo` needs no build step.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { host: '127.0.0.1' },
});
