#!/usr/bin/env node
// Read-only post-deploy smoke test for a website + portal pair (staging or production).
//   node scripts/smoke-deployed.mjs --website https://site.example --portal https://portal.example [--demo]
// Verifies the two deployments are wired to each other and to the same database/branch.
// Sends no credentials and writes nothing. --demo skips checks that need a live database.
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const demo = args.includes('--demo');
const clean = (u) => (u || '').replace(/\/$/, '');
const website = clean(opt('website')),
  portal = clean(opt('portal'));
if (!website || !portal) {
  console.error('Usage: smoke-deployed.mjs --website <url> --portal <url> [--demo]');
  process.exit(2);
}
const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push([true, name]);
  } catch (e) {
    results.push([false, `${name}: ${e instanceof Error ? e.message : e}`]);
  }
}
const ok = (c, m) => {
  if (!c) throw new Error(m);
};
const get = (url, init) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000), ...init });
const manifestLink = /<link[^>]+rel="manifest"/i;
const norm = (s) =>
  s
    .toLowerCase()
    .replace(/&#x27;|&#39;|&apos;|&amp;/g, '')
    .replace(/[^a-z0-9]/g, '');

await check('website home responds 200 and is not a PWA', async () => {
  const r = await get(website + '/');
  ok(r.status === 200, `status ${r.status}`);
  ok(!manifestLink.test(await r.text()), 'website exposes a manifest');
});
await check('portal /login responds 200 and is the PWA entry', async () => {
  const r = await get(portal + '/login');
  ok(r.status === 200, `status ${r.status}`);
  ok(manifestLink.test(await r.text()), 'no manifest link on /login');
});
await check('portal /book responds 200 and is NOT a PWA page', async () => {
  const r = await get(portal + '/book');
  ok(r.status === 200, `status ${r.status}`);
  ok(!manifestLink.test(await r.text()), '/book exposes a manifest');
});
await check('portal serves the manifest with start_url /login', async () => {
  const r = await get(portal + '/manifest.webmanifest');
  ok(r.status === 200, `status ${r.status}`);
  ok((await r.json()).start_url === '/login', 'unexpected start_url');
});
await check('website links its Book button to this portal', async () => {
  const html = await (await get(website + '/')).text();
  ok(
    html.includes(`${portal}/book`),
    `no link to ${portal}/book (check NEXT_PUBLIC_PORTAL_URL on the website project)`,
  );
});
if (!demo) {
  await check('portal accepts the website origin for callback requests (CORS)', async () => {
    const r = await get(portal + '/api/public/inquiry', {
      method: 'OPTIONS',
      headers: { Origin: website, 'Access-Control-Request-Method': 'POST' },
    });
    ok(r.status === 204, `status ${r.status} (check NEXT_PUBLIC_WEBSITE_URL on the portal project)`);
  });
  await check('website and portal show the same doctors (same database and branch)', async () => {
    const r = await get(portal + '/api/v1/catalog');
    ok(r.status === 200, `portal catalog status ${r.status}`);
    const doctors = (await r.json())?.doctors;
    ok(Array.isArray(doctors), 'portal catalog has no doctors array');
    const page = norm(await (await get(website + '/doctors')).text());
    const missing = doctors.filter((d) => !page.includes(norm(d.name))).map((d) => d.name);
    ok(missing.length === 0, `doctors in portal but not on website: ${missing.join(', ')}`);
  });
}
for (const [pass, name] of results) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
process.exit(results.every(([p]) => p) ? 0 : 1);
