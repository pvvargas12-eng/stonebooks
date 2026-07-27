import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Two HTML entries, one app bundle: index.html (desktop + Field PWA)
      // and sales.html (Stonebooks Sales PWA — vercel.json rewrites /sales
      // to it so iOS Add-to-Home-Screen reads the Sales identity). SALES-3.
      input: {
        main: resolve(__dirname, 'index.html'),
        sales: resolve(__dirname, 'sales.html'),
      },
    },
  },
})
