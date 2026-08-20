import { defineConfig } from 'vite'
import pugPlugin from 'vite-plugin-pug'
import { readFileSync } from 'node:fs'

const packageMetadata = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
)

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [pugPlugin()],
  define: {
    __NANQUIM_APP_VERSION__: JSON.stringify(packageMetadata.version),
  },
  // css: {
  //   preprocessorOptions: {
  //     sass: { additionalData: `@use 'src/styles/main.sass'` },
  //   },
  // },
})
