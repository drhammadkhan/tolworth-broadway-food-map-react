import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/tolworth-broadway-food-map-react/',
  plugins: [react()],
  server: {
    // This project lives in a Dropbox/CloudStorage folder where native FS
    // change events are unreliable; poll so HMR actually picks up edits.
    watch: { usePolling: true, interval: 300 },
  },
})
