import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // `npm run dev:phone` (mode "phone") serves the site over HTTPS on the local network, so a
  // phone can open the live camera for "Try it on". Phones only allow the camera on HTTPS or
  // localhost. `npm run dev` is unchanged: plain http://localhost:5173.
  const phone = mode === 'phone'

  return {
    plugins: phone ? [react(), basicSsl()] : [react()],
    server: {
      host: phone ? true : undefined,
      // Forward API and image requests to the FastAPI backend (backend/main.py).
      // xfwd passes each visitor's address (X-Forwarded-For), so the backend's chat rate
      // limit counts each guest separately rather than everyone as the proxy.
      proxy: {
        '/api': { target: 'http://localhost:8000', xfwd: true },
        '/images': 'http://localhost:8000',
      },
    },
  }
})
