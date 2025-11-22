import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

const outDir = 'dist-dev';

export default defineConfig({
  mode: 'development',
  assetsInclude: '**/*.html',
  base: './',
  plugins: [basicSsl()],
  build: {
    outDir: outDir,
    emptyOutDir: true,
    sourcemap: 'inline',
    lib: {
      fileName: '[name]',
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
