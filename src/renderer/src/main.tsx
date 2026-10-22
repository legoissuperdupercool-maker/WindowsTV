import React from 'react'
import { createRoot } from 'react-dom/client'
// Google Sans Flex (the Google TV typeface), bundled so it works offline.
import '@fontsource-variable/google-sans-flex'
import './styles/global.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
