import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const raiz = document.getElementById('root')!

// Import dinâmico: se faltar configuração do Supabase, o erro aparece na tela em vez de página em branco.
import('./App.tsx')
  .then(({ default: App }) => {
    createRoot(raiz).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
  .catch((e: unknown) => {
    console.error(e)
    raiz.textContent = e instanceof Error ? e.message : 'Erro ao iniciar o aplicativo.'
    raiz.style.cssText = 'padding:24px;font-family:sans-serif;color:#b91c1c'
  })
