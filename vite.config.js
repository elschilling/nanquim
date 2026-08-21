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
  test: {
    coverage: {
      provider: 'v8',
      enabled: false,
      include: ['src/js/**/*.js'],
      exclude: [
        'src/js/libs/**',
        'public/**',
        'dist/**',
        'coverage/**',
        'tests/browser/**',
      ],
      reportsDirectory: 'coverage',
      reporter: ['text', 'json-summary', 'html'],
      reportOnFailure: true,
      thresholds: {
        branches: 48,
        functions: 66,
        lines: 58,
        statements: 56,
        // Vitest's perFile switch is global. Exact paths keep these stronger
        // module floors independent without applying the global legacy ratchet
        // to every source file.
        'src/js/document/DocumentMetadata.js': {
          branches: 87,
          functions: 100,
          lines: 93,
          statements: 89,
        },
        'src/js/document/DocumentParser.js': {
          branches: 84,
          functions: 86,
          lines: 87,
          statements: 84,
        },
        'src/js/document/DocumentSerializer.js': {
          branches: 80,
          functions: 97,
          lines: 94,
          statements: 89,
        },
        'src/js/document/DocumentState.js': {
          branches: 91,
          functions: 100,
          lines: 100,
          statements: 96,
        },
        'src/js/CommandIcons.js': {
          branches: 75,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'src/js/ThemeController.js': {
          branches: 96,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'src/js/ToolPalette.js': {
          branches: 77,
          functions: 89,
          lines: 95,
          statements: 88,
        },
        'src/js/Collection.js': {
          branches: 89,
          functions: 100,
          lines: 98,
          statements: 95,
        },
        'src/js/History.js': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'src/js/SpatialIndex.js': {
          branches: 92,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'src/js/utils/sanitizeSvg.js': {
          branches: 84,
          functions: 91,
          lines: 91,
          statements: 86,
        },
        'src/js/utils/transformGeometry.js': {
          branches: 93,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'src/js/commands/CompositeCommand.js': {
          branches: 93,
          functions: 100,
          lines: 85,
          statements: 85,
        },
        'src/js/commands/EditRectangleCommand.js': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'src/js/commands/TrimTransaction.js': {
          branches: 88,
          functions: 90,
          lines: 91,
          statements: 90,
        },
        'src/js/commands/VertexEditTransaction.js': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'src/js/utils/geometryTransformQualification.js': {
          branches: 87,
          functions: 100,
          lines: 100,
          statements: 92,
        },
        'src/js/utils/invalidateSpatialIndexes.js': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'src/js/utils/vertexCoordinateSpace.js': {
          branches: 88,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'src/js/utils/hatchTransformQualification.js': {
          branches: 80,
          functions: 96,
          lines: 88,
          statements: 83,
        },
      },
    },
  },
  // css: {
  //   preprocessorOptions: {
  //     sass: { additionalData: `@use 'src/styles/main.sass'` },
  //   },
  // },
})
