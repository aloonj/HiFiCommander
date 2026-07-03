import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { refreshTheme } from './lib/applyTheme'

refreshTheme()
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshTheme)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
