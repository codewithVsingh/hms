// Cross-app contracts: the website and the portal deploy separately but share one database and a
// few public interfaces. These static checks fail the build when one side drifts from the other.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, existsSync, statSync } = require('node:fs');
const { join } = require('node:path');

const read = (p) => readFileSync(p, 'utf8');
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.next', '.turbo'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const sources = (dir) => walk(dir).filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && !f.endsWith('.d.ts'));
const envKeys = (file) =>
  new Set(
    read(file)
      .split(/\r?\n/)
      .map((l) => l.match(/^([A-Z][A-Z0-9_]*)=/))
      .filter(Boolean)
      .map((m) => m[1]),
  );

test('every portal link used by the website points to an existing portal page', () => {
  const paths = new Set();
  for (const f of sources('apps/website'))
    for (const m of read(f).matchAll(/\$\{portalUrl\}(\/[A-Za-z0-9_\-/]*)/g))
      paths.add(m[1].replace(/\/$/, ''));
  assert.ok(paths.size >= 4, 'expected the website to link to several portal pages');
  for (const p of paths)
    assert.ok(
      existsSync(`apps/portal/app${p}/page.tsx`),
      `website links to ${p} but the portal has no such page`,
    );
  for (const required of ['/book', '/login', '/manage-booking', '/my-bookings'])
    assert.ok(
      paths.has(required),
      `website no longer links to ${required}; update docs/RELEASE-AND-SERVICES.md`,
    );
});

test('callback form and portal inquiry API agree on endpoint and fields', () => {
  const form = read('apps/website/components/callback.tsx');
  assert.match(form, /\/api\/public\/inquiry/);
  assert.ok(existsSync('apps/portal/app/api/public/inquiry/route.ts'), 'portal inquiry route missing');
  const sent = form.match(/JSON\.stringify\(\{([^}]*)\}\)/);
  assert.ok(sent, 'could not find the callback request body');
  const sentFields = sent[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
  const route = read('apps/portal/app/api/public/inquiry/route.ts');
  const read_ = [...new Set([...route.matchAll(/\bb\.([a-z]+)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(sentFields, read_, 'website sends different fields than the portal validates');
});

test('website only uses public RPCs that exist and are executable by anon', () => {
  const live = read('apps/website/lib/live.ts');
  const names = [...live.matchAll(/getRPC<[^>]*>\(\s*'([a-z0-9_]+)'/g)].map((m) => m[1]);
  assert.ok(names.length >= 2, 'expected the website to call public RPCs');
  const sql = readdirSync('supabase/migrations')
    .map((f) => read(join('supabase/migrations', f)))
    .join('\n');
  for (const n of names) {
    assert.match(
      sql,
      new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${n}\\(`),
      `${n} is not defined in a migration`,
    );
    assert.match(
      sql,
      new RegExp(`GRANT EXECUTE ON FUNCTION[^;]*${n}[^;]*TO[^;]*anon`),
      `${n} is not granted to anon`,
    );
  }
});

test('website and portal point at the same organization, branch and database', () => {
  const site = envKeys('apps/website/.env.local.example'),
    portal = envKeys('apps/portal/.env.local.example');
  for (const k of [
    'HMS_ORGANIZATION_SLUG',
    'HMS_BRANCH_CODE',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_PORTAL_URL',
    'NEXT_PUBLIC_WEBSITE_URL',
    'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
  ]) {
    assert.ok(site.has(k), `website env example is missing ${k}`);
    assert.ok(portal.has(k), `portal env example is missing ${k}`);
  }
});

test('website holds no server secrets', () => {
  const name = /SERVICE_ROLE|RAZORPAY|CRON_SECRET|TWILIO|RESEND|WHATSAPP_ACCESS|SCANNER|TURNSTILE_SECRET/i;
  for (const k of envKeys('apps/website/.env.local.example'))
    assert.doesNotMatch(k, name, `website env example has ${k}`);
  // Public copy may mention "Razorpay"; only environment-variable access is a leak.
  const envRef =
    /process\.env\.[A-Z0-9_]*(SERVICE_ROLE|RAZORPAY|CRON_SECRET|TWILIO|RESEND|WHATSAPP_ACCESS|SCANNER|TURNSTILE_SECRET)/;
  for (const f of sources('apps/website')) assert.doesNotMatch(read(f), envRef, `${f} reads a server secret`);
});
test('each app deploys only when it or something it depends on changed', () => {
  const ignore = [];
  for (const app of ['website', 'portal']) {
    const v = JSON.parse(read(`apps/${app}/vercel.json`));
    assert.match(v.ignoreCommand, /turbo-ignore@\d+\.\d+\.\d+/, `${app}: pin turbo-ignore in ignoreCommand`);
    assert.match(v.installCommand, /--frozen-lockfile/);
    ignore.push(v.ignoreCommand);
  }
  assert.equal(ignore[0], ignore[1], 'both apps must use the same pinned turbo-ignore');
});

test('apps and packages keep their boundaries', () => {
  for (const f of sources('apps/website')) assert.doesNotMatch(read(f), /apps\/portal|@hms\/portal/, f);
  for (const f of sources('apps/portal')) assert.doesNotMatch(read(f), /apps\/website|@hms\/website/, f);
  for (const f of sources('packages'))
    assert.doesNotMatch(read(f), /apps\/(portal|website)|@hms\/(portal|website)/, f);
});

test('production promotion is manual, approved, fast-forward only and never forced', () => {
  const wf = read('.github/workflows/promote.yml');
  const triggers = wf.slice(wf.indexOf('on:'), wf.indexOf('concurrency:'));
  assert.match(triggers, /workflow_dispatch/);
  assert.doesNotMatch(
    triggers,
    /(^|\s)push:|pull_request|schedule:/,
    'promotion must only run when a person starts it',
  );
  assert.match(wf, /environment:\s*production/, 'deploy job must use the protected production environment');
  const pushes = wf.split(/\r?\n/).filter((l) => /git push/.test(l));
  assert.ok(pushes.length >= 1, 'promote.yml must push to main');
  for (const l of pushes) {
    assert.doesNotMatch(l, /--force|\s-f(?![\w-])|--force-with-lease|\+[^ ]*:/, `forced push: ${l.trim()}`);
    assert.match(l, /:refs\/heads\/main/, `unexpected push target: ${l.trim()}`);
  }
  assert.match(wf, /promote-plan\.sh/);
  assert.match(read('scripts/promote-plan.sh'), /merge-base --is-ancestor/);
});

test('CI runs for both long-lived branches and exposes one required check', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /branches:\s*\[main, staging\]/);
  assert.match(ci, /^ {2}ci-ok:/m);
});
