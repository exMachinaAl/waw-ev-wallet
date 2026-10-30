import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {getPorts,localUrl} from './src/runtime.mjs';
const ports=getPorts();
// Preserve the browser Host/Origin pair so backend origin checks still protect POSTs.
const walletProxy={target:localUrl(ports.wallet),changeOrigin:false};
export default defineConfig({plugins:[react()],build:{outDir:'dist',emptyOutDir:true},server:{host:'127.0.0.1',port:ports.webDev,strictPort:true,proxy:{'/api':walletProxy,'/internal':walletProxy,'/openapi.json':walletProxy}},preview:{host:'127.0.0.1',port:ports.webDev,strictPort:true}});
