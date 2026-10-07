import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ThemeProvider } from './components/ui';
import { PushBridge } from './components/Notifications';
import './i18n';
// Self-hosted variable fonts (woff2, subset by unicode-range): Inter carries
// Latin, Noto Sans Arabic carries Arabic — the stack in index.css pairs them.
import '@fontsource-variable/inter';
import '@fontsource-variable/noto-sans-arabic';
import './index.css';

// A deploy replaces every hashed chunk, so a tab still running the previous build
// asks for pages that are gone. Reload once to pick up the new build instead of
// showing the crash screen — once: a server that is really down must not loop it.
window.addEventListener('vite:preloadError', () => {
  try {
    const last = Number(sessionStorage.getItem('chunk-reload-at')) || 0;
    if (Date.now() - last < 10_000) return;
    sessionStorage.setItem('chunk-reload-at', String(Date.now()));
  } catch {
    return; // no storage, no loop guard: the error screen shows instead
  }
  window.location.reload();
});

// Agentation: outil de retour visuel — on clique un élément de l'UI, on note, et
// l'annotation part vers le serveur MCP (port 4747) que Claude Code lit. Dev seulement :
// l'import dynamique gardé par import.meta.env.DEV le sort du bundle de production.
function DevAnnotation() {
  const [Tool, setTool] = React.useState(null);
  React.useEffect(() => {
    if (!import.meta.env.DEV) return;
    import('agentation').then((m) => setTool(() => m.Agentation)).catch(() => {});
  }, []);
  return Tool ? <Tool endpoint="http://localhost:4747" /> : null;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <App />
        {/* Service worker: a tapped notification opens its page in this tab */}
        <PushBridge />
      </BrowserRouter>
      <DevAnnotation />
    </ThemeProvider>
  </React.StrictMode>
);
