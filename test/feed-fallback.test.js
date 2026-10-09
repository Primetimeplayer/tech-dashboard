import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const pageHtml = (await readFile(path.join(root, 'index.html'), 'utf8'))
  .replace(/<link rel="preconnect"[^>]*>/g, '')
  .replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/, '');

const staticStory = {
  source: 'The Verge',
  category: 'news',
  title: 'Static fallback headline',
  link: 'https://example.test/static-fallback',
  published: '2026-10-09T17:25:39.000Z',
  summary: 'Served from the built JSON file.',
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function startServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) && file !== root) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200);
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('missing');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function matchMedia() {
  return {
    matches: false,
    media: '',
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  };
}

async function waitFor(fn, timeoutMs) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = fn();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const error = new Error('timed out waiting for the feed');
  error.last = last;
  throw error;
}

async function openDashboard(port, fetchImpl, { cache = '{malformed json' } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => {
    errors.push(error && error.message ? error.message : String(error));
  });
  let onLoad;
  const loaded = new Promise((resolve) => {
    onLoad = resolve;
  });
  const dom = new JSDOM(pageHtml, {
    url: `http://127.0.0.1:${port}/`,
    runScripts: 'dangerously',
    resources: 'usable',
    virtualConsole,
    beforeParse(window) {
      window.matchMedia = matchMedia;
      window.fetch = fetchImpl;
      window.addEventListener('load', onLoad);
      window.localStorage.setItem('feed_cache_US_en-US', cache);
    },
  });
  await Promise.race([
    loaded,
    new Promise((_, reject) => setTimeout(() => reject(new Error('page load timed out')), 8000)),
  ]);
  return { dom, errors };
}

test('hung locale fetch falls back to static JSON without leaving the skeleton up', async (t) => {
  const server = await startServer();
  const { port } = server.address();
  t.after(() => new Promise((resolve) => server.close(resolve)));

  let localeStarted = 0;
  const fetchImpl = (url, init) => {
    const href = String(url);
    if (href.includes('/api/news')) {
      localeStarted += 1;
      return new Promise((resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (init && init.signal) {
          if (init.signal.aborted) abort();
          else init.signal.addEventListener('abort', abort, { once: true });
        }
      });
    }
    if (href.includes('data/news.json')) {
      return Promise.resolve(jsonResponse({ items: [staticStory] }));
    }
    if (href.includes('data/')) return Promise.resolve(jsonResponse({ items: [] }));
    return Promise.reject(new Error(`unexpected ${href}`));
  };

  const started = Date.now();
  const { dom, errors } = await openDashboard(port, fetchImpl);
  t.after(() => dom.window.close());

  const headline = await waitFor(() => {
    const card = dom.window.document.querySelector('#feed h2 a');
    return card && card.textContent === 'Static fallback headline' ? card : null;
  }, 2000);
  assert.ok(headline);
  assert.ok(Date.now() - started < 4000, 'static fallback waited on the locale request');
  assert.equal(dom.window.document.getElementById('skeleton').style.display, 'none');
  const status = dom.window.document.getElementById('status');
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /^updated /);
  assert.equal(status.textContent.includes('loading'), false);
  assert.equal(dom.window.document.getElementById('retryFeed'), null);
  assert.equal(dom.window.localStorage.getItem('feed_cache_US_en-US'), null);
  assert.equal(localeStarted >= 1, true);
  assert.equal(errors.some((message) => /malformed|JSON/.test(message)), false);
});

test('a failed feed hides the skeleton and loading line and offers Retry Feed', async (t) => {
  const server = await startServer();
  const { port } = server.address();
  t.after(() => new Promise((resolve) => server.close(resolve)));

  let mode = 'fail';
  const fetchImpl = (url) => {
    const href = String(url);
    if (mode === 'fail') return Promise.reject(new TypeError('offline'));
    if (href.includes('/api/news')) return Promise.resolve(jsonResponse({ error: 'down' }, 502));
    if (href.includes('data/news.json')) return Promise.resolve(jsonResponse({ items: [staticStory] }));
    if (href.includes('data/')) return Promise.resolve(jsonResponse({ items: [] }));
    return Promise.reject(new Error(`unexpected ${href}`));
  };

  const { dom } = await openDashboard(port, fetchImpl, { cache: '' });
  t.after(() => dom.window.close());

  const button = await waitFor(() => dom.window.document.getElementById('retryFeed'), 2000);
  assert.equal(button.textContent, 'Retry Feed');
  const banner = dom.window.document.getElementById('errorBanner');
  assert.equal(banner.classList.contains('visible'), true);
  assert.match(banner.textContent, /The feed could not be loaded/);
  assert.equal(dom.window.document.getElementById('skeleton').style.display, 'none');
  assert.equal(dom.window.document.getElementById('feed').style.display, 'none');
  const status = dom.window.document.getElementById('status');
  assert.equal(status.hidden, true);
  assert.equal(status.textContent.includes('loading'), false);

  mode = 'ok';
  button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const headline = await waitFor(() => {
    const card = dom.window.document.querySelector('#feed h2 a');
    return card && card.textContent === 'Static fallback headline' ? card : null;
  }, 2000);
  assert.ok(headline);
  assert.equal(dom.window.document.getElementById('skeleton').style.display, 'none');
  assert.equal(dom.window.document.getElementById('retryFeed'), null);
  const restored = dom.window.document.getElementById('status');
  assert.equal(restored.hidden, false);
  assert.match(restored.textContent, /^updated /);
});
