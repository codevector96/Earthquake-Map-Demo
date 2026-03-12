import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// GitHub Pages serves at https://<user>.github.io/<repo>/
// BASE_PATH is set by the workflow to match the repo name (e.g. /Earthquake-Map-Demo/)
const base = process.env.BASE_PATH || (process.env.GITHUB_PAGES ? '/Earthquake-Map-Demo/' : '/')

export default defineConfig({
  base: base.endsWith('/') ? base : base + '/',
  plugins: [vue()],
})

