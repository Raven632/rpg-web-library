import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://rpg-library:3000', 
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://rpg-library:3000',
        ws: true, 
      },
      // --- НОВОЕ: Прокси для картинок и файлов игр ---
      '/media': {
        target: 'http://rpg-library:3000',
        changeOrigin: true,
        // Vite уберет слово "/media" перед тем, как отправить запрос на бэкенд
        rewrite: (path) => path.replace(/^\/media/, '') 
      }
    }
  }
})