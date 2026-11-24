import { publicLive, indexLive, publicContent, publicCatalog, contentPath } from '../lib/live';
import type { MetadataRoute } from 'next';
import { doctors, services, articles } from '@hms/types';
import { siteUrl } from '../lib/config';
// URL inventory for later production indexing; demo is explicitly disallowed by robots and metadata.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (publicLive) {
    if (!indexLive) return [];
    const [entries, catalog] = await Promise.all([publicContent(), publicCatalog()]);
    return [
      ...new Set([
        '/',
        '/doctors',
        '/services',
        '/contact',
        '/request-callback',
        '/faq',
        '/health-library',
        ...(catalog?.doctors.map((d) => `/doctors/${d.slug}`) || []),
        ...entries.map(contentPath),
      ]),
    ].map((path) => ({ url: new URL(path, siteUrl).href }));
  }
  return [
    '/',
    '/about',
    '/doctors',
    '/services',
    '/contact',
    '/request-callback',
    '/facilities',
    '/faq',
    '/health-library',
    ...doctors.map((d) => `/doctors/${d.slug}`),
    ...services.map((s) => `/services/${s.slug}`),
    ...articles.map((a) => `/health-library/${a.slug}`),
  ].map((path) => ({ url: new URL(path, siteUrl).href }));
}
