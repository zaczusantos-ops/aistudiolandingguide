import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyPreview } from './preview-smoke.mjs';

const origin = 'https://lunar-preview.example';
const html = '<title>Lunar Landing Site Navigator</title><div id="root"></div><script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css">';
const resources = new Map([
  ['/', [html, 'text/html']],
  ['/assets/app.js', ['console.log("app");', 'text/javascript']],
  ['/assets/app.css', ['body { color: white; }', 'text/css']],
]);
const hash = (value) => createHash('sha256').update(value).digest('hex');

function mockFetch(overrides = new Map(), inspect = () => {}) {
  return async (url, options) => {
    inspect(url, options);
    const resource = overrides.get(url.pathname) ?? resources.get(url.pathname);
    if (resource instanceof Response) return resource.clone();
    if (!resource) return new Response('', { status: 404 });
    return new Response(resource[0], { headers: { 'content-type': resource[1] } });
  };
}

test('opens an unprotected preview without CLI credentials and checks compiled assets', async () => {
  const result = await verifyPreview({ url: origin, fetchImpl: mockFetch(new Map(), (_, options) => {
    assert.equal(options.headers.has('Authorization'), false);
    assert.equal(options.headers.has('Cookie'), false);
    assert.equal(options.headers.has('x-vercel-protection-bypass'), false);
    assert.equal(options.redirect, 'manual');
  }) });
  assert.equal(result.assetsChecked, 2);
  assert.equal(result.matchedLocalBuild, false);
});

test('recognizes the hosting provider toolbar but rejects arbitrary external scripts', async () => {
  const toolbar = '<script data-explicit-opt-in="true" src="https://vercel.live/_next-live/feedback/feedback.js"></script>';
  const result = await verifyPreview({ url: origin, fetchImpl: mockFetch(new Map([['/', [html + toolbar, 'text/html']]])) });
  assert.equal(result.assetsChecked, 2);
  const unexpected = '<script src="https://unexpected.example/app.js"></script>';
  await assert.rejects(verifyPreview({ url: origin, fetchImpl: mockFetch(new Map([['/', [html + unexpected, 'text/html']]])) }), /outside the preview origin/);
});

test('rejects login redirects before sending a request to another origin', async () => {
  let requests = 0;
  const login = new Response('', { status: 302, headers: { location: 'https://vercel.com/sso-api' } });
  await assert.rejects(verifyPreview({ url: origin, fetchImpl: mockFetch(new Map([['/', login]]), () => { requests += 1; }) }), /redirects outside/);
  assert.equal(requests, 1);
});

test('reports a transport error code without leaking URL or proxy credentials', async () => {
  const fetchImpl = async () => {
    throw new TypeError('fetch failed', { cause: Object.assign(new Error('proxy: https://user:password@proxy.example/?private=value'), { code: 'ECONNREFUSED' }) });
  };
  await assert.rejects(verifyPreview({ url: `${origin}/?_vercel_share=secret`, fetchImpl }), (error) => {
    assert.match(error.message, /ECONNREFUSED/);
    assert.doesNotMatch(error.message, /password|secret|private|user:/);
    return true;
  });
});

test('a fresh share session retains only its own cookies through redirect and assets', async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push(options.headers.get('Cookie'));
    assert.equal(options.headers.has('Authorization'), false);
    if (url.searchParams.has('_vercel_share')) {
      return new Response('', { status: 307, headers: { location: '/', 'set-cookie': '_vercel_jwt=test-share-session; Path=/; Secure; HttpOnly' } });
    }
    return mockFetch()(url, options);
  };
  const result = await verifyPreview({ url: `${origin}/?_vercel_share=example`, fetchImpl });
  assert.equal(result.assetsChecked, 2);
  assert.deepEqual(seen, [null, '_vercel_jwt=test-share-session', '_vercel_jwt=test-share-session', '_vercel_jwt=test-share-session']);
});

test('rejects an authentication page even when its HTTP status is 200', async () => {
  await assert.rejects(verifyPreview({ url: origin, fetchImpl: mockFetch(new Map([['/', ['<title>Authentication Required</title>', 'text/html']]])) }), /no application root/);
});

test('rejects missing bundles and HTML fallbacks masquerading as CSS', async () => {
  await assert.rejects(verifyPreview({ url: origin, fetchImpl: mockFetch(new Map([['/assets/app.js', new Response('', { status: 404 })]])) }), /HTTP 404/);
  await assert.rejects(verifyPreview({ url: origin, fetchImpl: mockFetch(new Map([['/assets/app.css', [html, 'text/html']]])) }), /asset returned HTML/);
});

test('checks exact local artifact hashes, including lazy chunks and imagery', async () => {
  const expectedBuild = {
    entries: new Set(['/assets/app.js', '/assets/app.css']),
    assets: new Map([
      ['/assets/app.js', hash(resources.get('/assets/app.js')[0])],
      ['/assets/app.css', hash(resources.get('/assets/app.css')[0])],
      ['/assets/lazy-moon.js', hash('export const moon = true;')],
      ['/assets/lunar/moon.jpg', hash('image bytes')],
    ]),
  };
  const extra = new Map([
    ['/assets/lazy-moon.js', ['export const moon = true;', 'text/javascript']],
    ['/assets/lunar/moon.jpg', ['image bytes', 'image/jpeg']],
  ]);
  const result = await verifyPreview({ url: origin, expectedBuild, fetchImpl: mockFetch(extra) });
  assert.equal(result.assetsChecked, 4);
  assert.equal(result.matchedLocalBuild, true);
  extra.set('/assets/lazy-moon.js', ['export const moon = false;', 'text/javascript']);
  await assert.rejects(verifyPreview({ url: origin, expectedBuild, fetchImpl: mockFetch(extra) }), /differs from the expected local build/);
});

test('rejects another version even if the old entry asset still exists', async () => {
  const expectedBuild = { entries: new Set(['/assets/new-app.js', '/assets/app.css']), assets: new Map() };
  await assert.rejects(verifyPreview({ url: origin, expectedBuild, fetchImpl: mockFetch() }), /entry assets do not match/);
});
