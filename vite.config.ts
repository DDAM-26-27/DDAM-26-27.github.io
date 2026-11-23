import { copyFileSync, writeFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const apiTarget = process.env.E2E_API ?? 'http://localhost:8787';

/**
 * Static hosting support (GitHub Pages):
 * - 404.html = index.html, so deep links such as /booking or /manage load the app;
 * - .nojekyll, so GitHub serves the files as they are;
 * - a Content-Security-Policy meta tag (GitHub Pages cannot send custom headers).
 */
function staticHosting(): Plugin {
  return {
    name: 'static-hosting',
    apply: 'build',
    transformIndexHtml(html) {
      const api = process.env.VITE_API_BASE ? new URL(process.env.VITE_API_BASE).origin : '';
      const csp = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        `connect-src 'self' https://*.supabase.co ${api}`.trim(),
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ');
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );
    },
    closeBundle() {
      copyFileSync('dist/index.html', 'dist/404.html');
      writeFileSync('dist/.nojekyll', '');
    },
  };
}

export default defineConfig({
  base: process.env.SITE_BASE ?? '/',
  plugins: [react(), tailwindcss(), staticHosting()],
  server: {
    port: 5173,
    proxy: { '/api': apiTarget },
  },
  preview: {
    port: 4173,
    proxy: { '/api': apiTarget },
  },
});
