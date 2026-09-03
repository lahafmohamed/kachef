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
      </BrowserRouter>
      <DevAnnotation />
    </ThemeProvider>
  </React.StrictMode>
);
