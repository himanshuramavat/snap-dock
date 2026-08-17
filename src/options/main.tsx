// Must come first: aliases Firefox's promise-based `browser` onto `chrome` so the
// rest of the codebase can be written once against promises. See utils/browser.ts.
import '@/utils/browser';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@/ui/base.css';
import './options.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
