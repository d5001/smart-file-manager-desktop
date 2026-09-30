import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/theme.css';
import './styles/layout.css';
import './styles/glass.css';
import './styles/features.css';

const container = document.getElementById('root');
if (!container) throw new Error('未找到 #root 挂载点');

createRoot(container).render(<App />);
