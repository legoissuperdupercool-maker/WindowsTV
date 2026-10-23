import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// Obfuscate the built main/preload JS (where the license + integrity logic
// lives) at build time only. Dynamically imports javascript-obfuscator so
// `electron-vite dev` doesn't need it installed. Set ELLO_NO_OBFUSCATE=1 to
// skip (e.g. when debugging a packaged build). Options are deliberately
// conservative ("node" target, no self-defending) so they harden without
// breaking the mpv child-process + IPC wiring.
function obfuscateBuild(): Plugin {
  return {
    name: 'ello-obfuscate',
    apply: 'build',
    async renderChunk(code: string, chunk: { fileName: string }) {
      if (!chunk.fileName.endsWith('.js') || process.env.ELLO_NO_OBFUSCATE) return null
      // javascript-obfuscator is CommonJS; handle both interop shapes.
      const mod: any = await import('javascript-obfuscator')
      const JO = mod.default ?? mod
      const result = JO.obfuscate(code, {
        target: 'node',
        compact: true,
        identifierNamesGenerator: 'hexadecimal',
        stringArray: true,
        stringArrayEncoding: ['base64'],
        stringArrayThreshold: 0.75,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.5,
        numbersToExpressions: true,
        simplify: true,
        selfDefending: false,
        deadCodeInjection: false,
        disableConsoleOutput: false
      })
      return { code: result.getObfuscatedCode(), map: null }
    }
  }
}

// electron-vite builds three targets: main (Node), preload (Node+browser bridge),
// and renderer (the React UI). `externalizeDepsPlugin` keeps `dependencies` (e.g.
// electron-store, fast-xml-parser) external so they load from node_modules in the
// packaged app, while renderer-only libs (react, zustand) get bundled.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), obfuscateBuild()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin(), obfuscateBuild()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    }
  }
})
