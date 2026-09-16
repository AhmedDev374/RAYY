import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { CollapsibleProvider } from './components/collapsible';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
 <React.StrictMode>
    {/* The expand/collapse state of the dashboard sections lives above the
        router, so a user's choice survives every navigation within the app. */}
    <CollapsibleProvider>
      <App />
    </CollapsibleProvider>
 </React.StrictMode>,
);
