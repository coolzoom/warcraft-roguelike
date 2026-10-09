import { defineConfig } from 'vite';

export default defineConfig({
  // 5174 keeps this branch from colliding with the main project on 5173.
  server: { host: true, port: 5174 },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        editor: 'card-editor.html',
      },
    },
  },
});
