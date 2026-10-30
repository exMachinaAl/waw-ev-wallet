import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.jsx';
import LabApp from './LabApp.jsx';
import './styles.css';
createRoot(document.getElementById('root')).render(<React.StrictMode>{location.pathname.startsWith('/lab')?<LabApp/>:<App/>}</React.StrictMode>);
