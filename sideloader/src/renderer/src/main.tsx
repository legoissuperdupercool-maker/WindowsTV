import React from 'react'
import { createRoot } from 'react-dom/client'
// Google Sans Flex, the same typeface as ello smartTV, bundled so it works offline.
import '@fontsource-variable/google-sans-flex'
import './styles.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
