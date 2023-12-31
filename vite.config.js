import { defineConfig } from 'vite'
import pugPlugin from 'vite-plugin-pug'
// https://vitejs.dev/config/
export default defineConfig({
  plugins: [pugPlugin()],
  // css: {
  //   preprocessorOptions: {
  //     sass: { additionalData: `@use 'src/styles/main.sass'` },
  //   },
  // },
})
