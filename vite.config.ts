import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves from a repo subpath; Cloud Run serves from the root.
// The workflow sets VITE_BASE for Pages, the Dockerfile sets it to '/'.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? '/Response-Behavioural-analysis/',
})
