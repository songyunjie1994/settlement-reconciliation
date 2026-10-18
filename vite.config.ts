import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({base:'/settlement-reconciliation/',plugins:[react()],build:{sourcemap:false}});
