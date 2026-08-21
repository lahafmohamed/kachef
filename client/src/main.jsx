import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ThemeProvider } from './components/ui';
import './i18n';
// Self-hosted variable fonts (woff2, subset by unicode-range): Inter carries
// Latin, Noto Sans Arabic carries Arabic — the stack in index.css pairs them.
import '@fontsource-variable/inter';
import '@fontsource-variable/noto-sans-arabic';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
);
