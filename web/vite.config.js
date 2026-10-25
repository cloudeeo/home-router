import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development, API calls go to the router on port 8090
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:8090' } },
})
