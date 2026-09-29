import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const CSP = [
  "default-src 'self'",
  "connect-src 'none'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Built page only. The dev server needs a websocket for hot reload, which the CSP would block. */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'azm-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
});
