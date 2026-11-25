// Served as a plain route (not the app/manifest.ts file convention) because that convention
// auto-links the manifest from EVERY page. Only the PWA layouts reference it (see lib/pwa.ts).
const manifest = {
  id: '/',
  name: 'Hospital Management Workspace',
  short_name: 'HMS',
  description: 'Secure hospital operations and patient services',
  start_url: '/login',
  scope: '/',
  display: 'standalone',
  background_color: '#f5f8f7',
  theme_color: '#096b66',
  icons: [
    { src: '/icons/hms-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/hms-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/hms-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
export function GET() {
  return Response.json(manifest, {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' },
  });
}
