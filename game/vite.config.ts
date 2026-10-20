import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], server: { port: 5299, host: true }, resolve: { extensions: ['.tsx', '.ts', '.js', '.jsx'] } });
