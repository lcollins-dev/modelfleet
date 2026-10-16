import eslintPlugin from '@nabla/vite-plugin-eslint';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

import { iconsPlugin } from './icons.config';

const webPort = Number(process.env.WEB_PORT ?? 8080);
const serverPort = Number(process.env.SERVER_PORT ?? 3000);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    iconsPlugin(),
    eslintPlugin(),
    tsconfigPaths({
      loose: true,
    }),
  ],
  server: {
    port: webPort,
    strictPort: true,
    proxy: {
      '/api/v1': `http://localhost:${serverPort}`,
    },
  },
});
