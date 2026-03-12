import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// GitHub Pages serves at https://<user>.github.io/<repo>/
const base = process.env.GITHUB_PAGES === 'true' ? '/Earthquake-Map-Demo/' : '/'

export default defineConfig({
  base,
  plugins: [vue()],
})

