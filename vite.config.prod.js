import { defineConfig } from 'vite';
import * as fs from 'fs/promises';

const outDir = 'dist';

export default defineConfig({
  mode: 'production',
  publicDir: false,
  base: './',
  build: {
    outDir: outDir,
    emptyOutDir: true,
    copyPublicDir: false,
    lib: {
      fileName: '[name].prod',
      entry: 'index.js',
      formats: ['es'],
    },
    rollupOptions: {
      external: (id) => (id === 'three' || id.includes('three/examples/jsm/') || id.includes('three/addons/')),
      input: {
        'mindar-image': './src/image-target/index.js',
        'mindar-image-three': './src/image-target/three/main.js',
        'mindar-face': './src/face-target/index.js',
        'mindar-face-three': './src/face-target/three/main.js',
      },
    },
  },
  resolve: {
    alias: {
      'three/addons/': 'three/examples/jsm/',
    },
  },
});
