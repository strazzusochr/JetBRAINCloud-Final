import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// 🚨 SAFETY KILLSWITCH: Protect local hardware from accidental rendering
if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
  const isRenderer = window.location.search.includes('renderer=true');
  const isForced = window.location.search.includes('force_local=true');
  
  if (!isRenderer && !isForced) {
    alert("🚨 JetBRAIN Zero-Footprint Mode aktiv!\nLokale Ausführung gestoppt zum Schutz deiner Hardware (CPU/GPU).\nNutze bitte die offizielle Cloud-Umgebung auf Hugging Face.");
    window.location.href = "https://huggingface.co/spaces/Wrzzzrzr/JetBRAIN";
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
