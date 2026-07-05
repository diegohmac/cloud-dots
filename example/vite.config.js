import { fileURLToPath } from 'node:url'

export default {
  resolve: {
    alias: {
      'cloud-dots': fileURLToPath(new URL('../src/index.js', import.meta.url)),
    },
  },
  server: {
    fs: {
      allow: ['..'],
    },
  },
}
