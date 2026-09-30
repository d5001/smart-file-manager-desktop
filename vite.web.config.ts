import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 独立的「浏览器预览版」构建配置。
 *
 * 复用同一套渲染层源码，但在没有 Electron IPC 桥（window.sfm）时会自动切换到
 * 内置演示数据桥（src/renderer/src/bridge/demoBridge.ts），
 * 因此可以直接在浏览器里打开 out/web/index.html 预览完整界面。
 */
export default defineConfig({
  root: resolve('src/renderer'),
  base: './',
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  plugins: [react()],
  define: {
    __SFM_WEB_PREVIEW__: 'true'
  },
  build: {
    outDir: resolve('out/web'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        index: resolve('src/renderer/index.html')
      }
    }
  }
});
