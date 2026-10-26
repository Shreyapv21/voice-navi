import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/ocr': 'http://127.0.0.1:8000',
      '/detect': 'http://127.0.0.1:8000',
      '/stt': 'http://127.0.0.1:8000',
      '/tts': 'http://127.0.0.1:8000',
      '/uploads': 'http://127.0.0.1:8000',
      '/live': 'http://127.0.0.1:8000',
      '/slam': 'http://127.0.0.1:8000',
      '/perception': 'http://127.0.0.1:8000',
      '/api': 'http://127.0.0.1:5000',
    },
  },
})