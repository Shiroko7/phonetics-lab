import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    watch: {
      ignored: [
        '**/backend/**',
        '**/datasets/**',
        '**/.cache/**',
        '**/recordings/**',
      ],
    },
  },
  optimizeDeps: {
    entries: ['index.html'],
    exclude: ['@huggingface/transformers'],
  },
})
