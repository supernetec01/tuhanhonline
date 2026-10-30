import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist' },
  server: { watch: { ignored: ['**/.data/**', '**/test-results/**'] } },
});
