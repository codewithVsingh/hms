import type { MetadataRoute } from 'next';
import { indexLive } from '../lib/live';
import { siteUrl } from '../lib/config';
export default function robots(): MetadataRoute.Robots {
  return indexLive
    ? { rules: { userAgent: '*', allow: '/' }, sitemap: new URL('/sitemap.xml', siteUrl).href }
    : { rules: { userAgent: '*', disallow: '/' } };
}
