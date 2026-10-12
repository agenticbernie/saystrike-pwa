import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/plus-jakarta-sans';
import './styles.css';
import { App } from './App.js';
import { registerPwa } from './pwa.js';

registerPwa();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
