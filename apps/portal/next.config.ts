import type { NextConfig } from 'next';
const config: NextConfig = {
  transpilePackages: ['@hms/ui','@hms/types','@hms/validation'],
  poweredByHeader: false,
  async headers() { return [{source:'/sw.js',headers:[{key:'Cache-Control',value:'no-store'},{key:'Service-Worker-Allowed',value:'/'}]},{source: '/:path*', headers: [
    {key:'X-Robots-Tag',value:'noindex, nofollow, noarchive'},
    {key:'X-Content-Type-Options',value:'nosniff'},
    {key:'X-Frame-Options',value:'DENY'},
    {key:'Referrer-Policy',value:'no-referrer'},
    {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'},
    {key:'Content-Security-Policy',value:"frame-ancestors 'none'; base-uri 'self'; object-src 'none'"},
  ] }]; }
};
export default config;
