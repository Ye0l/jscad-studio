import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 는 /jscad-studio/ 하위 경로로 서비스되므로 Pages 빌드에서만 base 를 바꾼다.
// Tauri 는 dist 를 루트로 서빙하기 때문에 기본값은 '/' 로 두어야 한다.
const base = process.env.PAGES_BASE ?? '/'

export default defineConfig({
  base,
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: '0.0.0.0'
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: true
  }
})
