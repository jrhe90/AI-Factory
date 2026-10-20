import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { loadMegapack } from '../../src/battery/models.js';
import './styles.css';

// The straddle carrier carries the captured Megapack 2 XL; load it before the library builds objects
loadMegapack().finally(() => createRoot(document.getElementById('root')).render(<App />));
