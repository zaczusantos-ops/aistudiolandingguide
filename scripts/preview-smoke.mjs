import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import * as http from 'node:http';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function entryAssets(html, pageUrl) {
  const assets = new Map();
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/gi) ?? []) {
    const script = /^<script\b/i.test(tag);
    if (!script && !/\brel=["'](?:stylesheet|modulepreload)["']/i.test(tag)) continue;
    const source = tag.match(/\b(?:src|href)=["']([^"']+)["']/i)?.[1];
    if (!source) continue;
    const url = new URL(source, pageUrl);
    // Vercel adds this identified toolbar after serving the build. It is not
    // an application entry and cannot match a locally generated asset hash.
    if (script && url.origin === 'https://vercel.live' && url.pathname === '/_next-live/feedback/feedback.js' && /\bdata-explicit-opt-in=["']true["']/i.test(tag)) continue;
    assert.equal(url.origin, pageUrl.origin, 'An entry asset points outside the preview origin.');
    assert(!/\.(?:tsx?|jsx)$/.test(url.pathname), 'The preview references uncompiled source.');
    assets.set(url.pathname, url);
  }
  assert([...assets.keys()].some((path) => path.endsWith('.js')), 'The page has no compiled JavaScript entry.');
  assert([...assets.keys()].some((path) => path.endsWith('.css')), 'The page has no compiled stylesheet.');
  return assets;
}

/** Read the exact local build, including lazy chunks, imagery and fonts. */
export async function readExpectedBuild(buildDirectory) {
  const root = resolve(buildDirectory);
  const html = await readFile(resolve(root, 'index.html'), 'utf8');
  const entries = entryAssets(html, new URL('https://local-build.invalid/'));
  const assets = new Map();
  async function visit(directory) {
    for (const file of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, file.name);
      if (file.isDirectory()) await visit(path);
      else if (file.isFile()) {
        const rel = relative(root, path);
        assert(!isAbsolute(rel) && !rel.startsWith('..'), 'A build asset escapes the build directory.');
        assets.set(`/${rel.replaceAll('\\', '/')}`, digest(await readFile(path)));
      }
    }
  }
  await visit(resolve(root, 'assets'));
  return { entries: new Set(entries.keys()), assets };
}

/**
 * A fresh HTTP session: no CLI authentication, browser cookies or automation
 * bypass headers. Only cookies issued while opening the supplied share URL
 * are retained. Cross-origin redirects (including Vercel login) are refused.
 */
function previewSession(origin, fetchImpl) {
  const cookies = new Map();
  const storeCookies = (headers, url) => {
    for (const raw of headers.getSetCookie()) {
      const [pair, ...attributes] = raw.split(';');
      const equals = pair.indexOf('=');
      if (equals <= 0) continue;
      const name = pair.slice(0, equals).trim();
      const cookie = { name, value: pair.slice(equals + 1), path: '/', secure: false, expires: Infinity };
      let validDomain = true;
      for (const attribute of attributes) {
        const [key, ...parts] = attribute.trim().split('=');
        const value = parts.join('=');
        if (key.toLowerCase() === 'domain') {
          const domain = value.toLowerCase().replace(/^\./, '');
          validDomain = url.hostname === domain || url.hostname.endsWith(`.${domain}`);
        } else if (key.toLowerCase() === 'path') cookie.path = value || '/';
        else if (key.toLowerCase() === 'secure') cookie.secure = true;
        else if (key.toLowerCase() === 'max-age') cookie.expires = Date.now() + Number(value) * 1000;
        else if (key.toLowerCase() === 'expires' && cookie.expires === Infinity) cookie.expires = Date.parse(value);
      }
      if (validDomain) cookies.set(`${name}:${cookie.path}`, cookie);
    }
  };
  return async (input) => {
    let url = new URL(input);
    for (let redirects = 0; redirects <= 8; redirects += 1) {
      assert.equal(url.origin, origin, 'Preview redirects outside its origin; a login or unrelated site may be blocking access.');
      const headers = new Headers();
      const applicable = [...cookies.values()].filter((cookie) => {
        const pathMatches = url.pathname === cookie.path || url.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`);
        return pathMatches && cookie.expires > Date.now() && (!cookie.secure || url.protocol === 'https:');
      });
      if (applicable.length) headers.set('Cookie', applicable.map(({ name, value }) => `${name}=${value}`).join('; '));
      let response;
      try {
        response = await fetchImpl(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
      } catch (error) {
        // Include a useful transport code without echoing share queries, proxy
        // URLs or credentials that an underlying client may put in its message.
        const code = error.cause?.code ?? error.code ?? error.name;
        const safeCode = /^[A-Z][A-Z_\d]*$/i.test(String(code)) ? code : 'network error';
        throw new Error(`Network request failed at ${url.pathname} (${safeCode}). Check the environment proxy and CA configuration.`, { cause: error });
      }
      storeCookies(response.headers, url);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        assert(location, 'Preview returned a redirect with no destination.');
        url = new URL(location, url);
        continue;
      }
      assert(response.ok, `Preview returned HTTP ${response.status} at ${url.pathname}.`);
      return { response, url };
    }
    throw new Error('Preview exceeded eight redirects.');
  };
}

export async function verifyPreview(options) {
  const { fetchImpl = globalThis.fetch } = options;
  // Node fetch does not necessarily use HTTP(S)_PROXY by default. Node 24's
  // native helper respects inherited proxy/NO_PROXY settings and leaves CA/TLS
  // verification intact. Restore the dispatcher after this isolated check.
  const usesNativeFetch = fetchImpl === globalThis.fetch;
  const hasProxy = Boolean(process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY);
  assert(!usesNativeFetch || !hasProxy || typeof http.setGlobalProxyFromEnv === 'function', 'Preview checks behind an environment proxy require Node 24 with setGlobalProxyFromEnv support.');
  const restoreProxy = usesNativeFetch && typeof http.setGlobalProxyFromEnv === 'function' ? http.setGlobalProxyFromEnv() : () => {};
  try {
    return await verifyPreviewSession({ ...options, fetchImpl });
  } finally {
    restoreProxy();
  }
}

async function verifyPreviewSession({ url, expectedBuild, fetchImpl }) {
  const requested = new URL(url);
  assert.equal(requested.protocol, 'https:', 'Use the HTTPS URL returned by the preview provider.');
  assert(!requested.username && !requested.password, 'A preview URL must not contain account credentials.');
  const request = previewSession(requested.origin, fetchImpl);
  const page = await request(requested);
  assert(/text\/html/i.test(page.response.headers.get('content-type') ?? ''), 'Preview did not return HTML.');
  const html = await page.response.text();
  assert(/<div\b[^>]*\bid=["']root["']/i.test(html), 'Preview HTML has no application root; it may be an authentication page.');
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1];
  assert.equal(title, 'Lunar Landing Site Navigator', 'Preview title does not identify this application.');
  const entries = entryAssets(html, page.url);
  if (expectedBuild) assert.deepEqual(new Set(entries.keys()), expectedBuild.entries, 'Preview entry assets do not match the expected local build.');
  const assets = new Map(entries);
  for (const path of expectedBuild?.assets.keys() ?? []) assets.set(path, new URL(path, page.url));
  for (const [path, assetUrl] of assets) {
    const { response } = await request(assetUrl);
    const contentType = response.headers.get('content-type') ?? '';
    assert(!/text\/html/i.test(contentType), `An asset returned HTML instead of its contents: ${path}`);
    if (path.endsWith('.js')) assert(/(?:java|ecma)script/i.test(contentType), `JavaScript has an unexpected content type: ${path}`);
    if (path.endsWith('.css')) assert(/text\/css/i.test(contentType), `CSS has an unexpected content type: ${path}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert(bytes.length > 0, `An asset is empty: ${path}`);
    if (expectedBuild) assert.equal(digest(bytes), expectedBuild.assets.get(path), `Preview asset differs from the expected local build: ${path}`);
  }
  return { title, origin: page.url.origin, assetsChecked: assets.size, matchedLocalBuild: Boolean(expectedBuild) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [url, option, directory] = process.argv.slice(2);
    assert(url && (!option || (option === '--build-dir' && directory)), 'Usage: node scripts/preview-smoke.mjs HTTPS_URL [--build-dir frontend/dist]');
    const expectedBuild = directory ? await readExpectedBuild(directory) : undefined;
    const result = await verifyPreview({ url, expectedBuild });
    console.log(`Preview HTTP/asset checks passed: ${JSON.stringify(result)}. Browser rendering still requires verification.`);
  } catch (error) {
    console.error(`Preview smoke check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
