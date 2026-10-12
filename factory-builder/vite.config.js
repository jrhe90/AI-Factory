import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const threeDir = path.resolve(here, 'node_modules/three');

// The 3D object library is shared with the static demos in ../src, which import
// 'three' and 'three/addons/...' bare. Point those at this app's copy of three.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^three\/addons\/(.*)$/, replacement: `${threeDir}/examples/jsm/$1` },
      { find: /^three$/, replacement: `${threeDir}/build/three.module.js` },
    ],
    dedupe: ['three'],
  },
  server: { fs: { allow: ['..'] } },
  build: { chunkSizeWarningLimit: 2500 },
});
