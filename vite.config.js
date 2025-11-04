import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/habit_mvp/',   // ⚡ 這行一定要，對應你的 repo 名稱！
  plugins: [react()],
})
