import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { clearChunkReloadFlag, recoverIfChunkError } from './lib/chunkReload';
import './styles.css';

clearChunkReloadFlag();

window.addEventListener('unhandledrejection', (event) => {
  if (recoverIfChunkError(event.reason)) event.preventDefault();
});

if (import.meta.env.PROD) {
  void import('./lib/pwaRegister').then((m) => m.registerPwa());
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
