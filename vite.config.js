import { defineConfig } from "vite"
import pugPlugin from "vite-plugin-pug"

export default defineConfig({
  plugins: [pugPlugin(undefined, { hello: 'world'})],
  css: {
    preprocessorOptions: {
      sass: {
        // additionalData: `@import @/test.sass`
      }
    }
  }
})