import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      // Our chart endpoints live under a DEDICATED /api/sentchart prefix so they
      // never shadow Ryan's Yahoo /api/charts/<ticker> route. (Dev port 5055; the
      // service default is 5050, used here because :5050 is held by the local
      // sentiment-scout dashboard. In compose this targets chart-service:5050.)
      '/api/sentchart': 'http://localhost:5055',
      // Everything else — including Ryan's own /api/charts/<ticker> (Momentum
      // IntradayChart + MomentumRow sparkline, ?range/&interval) — goes to his
      // Node backend, so his pages get HIS data again.
      '/api': 'http://localhost:3001',
    },
  },
})
