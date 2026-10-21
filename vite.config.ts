import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'es2022' },
  worker: { format: 'es' },
  // Transformers.js ships its own ONNX runtime loader; pre-bundling breaks its worker/wasm paths.
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
});
