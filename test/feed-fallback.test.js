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

test('a failed feed hides the skeleton and loading line and offers Retry Connection', async (t) => {
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
  assert.equal(button.textContent, 'Retry Connection');
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

function emptyFeeds(extra) {
  return (url, init) => {
    const href = String(url);
    if (href.includes('/api/news')) return extra(href, init);
    if (href.includes('data/')) return Promise.resolve(jsonResponse({ items: [] }));
    return Promise.reject(new Error(`unexpected ${href}`));
  };
}

test('invalid RSS proxy JSON renders stale localStorage items and hides the skeleton', async (t) => {
  const server = await startServer();
  const { port } = server.address();
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const stale = JSON.stringify({
    savedAt: Date.now() - (10 * 60 * 1000),
    items: [{
      source: 'Cached Desk',
      category: 'news',
      title: 'Stale cached headline',
      link: 'https://example.test/stale-cached',
      published: '2026-10-09T12:00:00.000Z',
      summary: 'Kept in localStorage after the proxy failed.',
    }],
  });
  const fetchImpl = emptyFeeds(() => Promise.resolve({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError('invalid json');
    },
  }));

  const { dom, errors } = await openDashboard(port, fetchImpl, { cache: stale });
  t.after(() => dom.window.close());

  const headline = await waitFor(() => {
    const card = dom.window.document.querySelector('#feed h2 a');
    return card && card.textContent === 'Stale cached headline' ? card : null;
  }, 2000);
  assert.ok(headline);
  assert.equal(dom.window.document.getElementById('skeleton').style.display, 'none');
  assert.equal(dom.window.document.getElementById('retryFeed'), null);
  assert.equal(errors.some((message) => /malformed|JSON|SyntaxError/.test(message)), false);
  assert.equal(dom.window.localStorage.getItem('feed_cache_US_en-US'), stale);
});

test('a six second RSS proxy timeout falls back to stale cache', async (t) => {
  const server = await startServer();
  const { port } = server.address();
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const stale = JSON.stringify({
    savedAt: Date.now() - (10 * 60 * 1000),
    items: [{
      source: 'Cached Desk',
      category: 'news',
      title: 'Timeout cached headline',
      link: 'https://example.test/timeout-cached',
      published: '2026-10-09T12:00:00.000Z',
      summary: 'Shown after the proxy timed out.',
    }],
  });
  const fetchImpl = emptyFeeds((href, init) => new Promise((resolve, reject) => {
    const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    if (init && init.signal) {
      if (init.signal.aborted) abort();
      else init.signal.addEventListener('abort', abort, { once: true });
    }
  }));

  const started = Date.now();
  const { dom } = await openDashboard(port, fetchImpl, { cache: stale });
  t.after(() => dom.window.close());

  const headline = await waitFor(() => {
    const card = dom.window.document.querySelector('#feed h2 a');
    return card && card.textContent === 'Timeout cached headline' ? card : null;
  }, 9000);
  const elapsed = Date.now() - started;
  assert.ok(headline);
  assert.ok(elapsed >= 5000, `timeout fallback returned in ${elapsed}ms`);
  assert.ok(elapsed < 9000, `timeout fallback took ${elapsed}ms`);
  assert.equal(dom.window.document.getElementById('skeleton').style.display, 'none');
  assert.equal(dom.window.document.getElementById('retryFeed'), null);
});

test('missing and broken card images use a category SVG placeholder', async (t) => {
  const server = await startServer();
  const { port } = server.address();
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const published = '2026-10-09T17:25:39.000Z';
  const item = (title, category, image) => ({
    source: category === 'reviews' ? 'The Verge Reviews' : 'The Verge',
    category,
    title,
    link: `https://example.test/${title.toLowerCase()}`,
    published,
    summary: 'Layout fixture.',
    image,
  });
  const newsItems = ['Alpha', 'Bravo', 'Cedar', 'Delta', 'Eagle', 'Frost', 'Harbor'].map((title) => (
    item(title, 'news', title === 'Bravo' ? 'https://example.test/missing-photo.jpg' : '')
  ));
  const reviewItems = [item('Giant', 'reviews', 'https://example.test/missing-photo.jpg')];
  const fetchImpl = (url) => {
    const href = String(url);
    if (href.includes('/api/news')) return Promise.reject(new TypeError('offline'));
    if (href.includes('data/news.json')) return Promise.resolve(jsonResponse({ items: newsItems }));
    if (href.includes('data/reviews.json')) return Promise.resolve(jsonResponse({ items: reviewItems }));
    if (href.includes('data/')) return Promise.resolve(jsonResponse({ items: [] }));
    return Promise.reject(new Error(`unexpected ${href}`));
  };

  const { dom } = await openDashboard(port, fetchImpl, { cache: '' });
  t.after(() => dom.window.close());

  await waitFor(() => {
    const card = dom.window.document.querySelector('#feed h2 a');
    return card && card.textContent === 'Alpha' ? card : null;
  }, 2000);

  const doc = dom.window.document;
  const hero = doc.querySelector('#feed .hero-media');
  assert.ok(hero);
  assert.ok(hero.querySelector('.media-fallback svg'));
  assert.equal(hero.querySelector('.media-fallback').dataset.category, 'news');
  assert.equal(hero.querySelector('img'), null);

  const pick = [...doc.querySelectorAll('#feed .pick-card')].find((card) => card.textContent.includes('Bravo'));
  assert.ok(pick);
  const pickImg = pick.querySelector('.pick-thumb');
  if (pickImg) {
    assert.equal(pickImg.getAttribute('onerror'), 'signalImageFallback(this)');
    assert.equal(pickImg.getAttribute('width'), '72');
    assert.equal(pickImg.getAttribute('height'), '72');
    dom.window.signalImageFallback(pickImg);
  }
  const pickFallback = pick.querySelector('.pick-media.media-fallback');
  assert.ok(pickFallback);
  assert.ok(pickFallback.querySelector('svg'));
  assert.equal(pickFallback.dataset.category, 'news');
  assert.equal(pick.querySelector('.pick-thumb'), null);

  const row = [...doc.querySelectorAll('#feed .story-row')].find((card) => card.textContent.includes('Giant'));
  assert.ok(row);
  const rowImg = row.querySelector('.story-thumb');
  if (rowImg) {
    assert.equal(rowImg.getAttribute('onerror'), 'signalImageFallback(this)');
    assert.equal(rowImg.getAttribute('width'), '96');
    assert.equal(rowImg.getAttribute('height'), '96');
    dom.window.signalImageFallback(rowImg);
  }
  const rowFallback = row.querySelector('.story-media.media-fallback');
  assert.ok(rowFallback);
  assert.equal(rowFallback.dataset.category, 'reviews');
  assert.ok(rowFallback.querySelector('svg'));

  const omitted = [...doc.querySelectorAll('#feed .story-row')].find((card) => card.textContent.includes('Harbor'));
  assert.ok(omitted.querySelector('.story-media.media-fallback svg'));
  assert.equal(omitted.querySelector('.story-thumb'), null);

  const style = dom.window.getComputedStyle.bind(dom.window);
  assert.equal(style(hero).backgroundColor, 'rgb(243, 244, 246)');
  assert.equal(style(hero).height, '248px');
  assert.equal(style(hero).objectFit, 'cover');
  assert.equal(style(rowFallback).width, '96px');
  assert.equal(style(rowFallback).height, '96px');
  assert.equal(style(rowFallback).objectFit, 'cover');
  assert.equal(style(rowFallback).backgroundColor, 'rgb(243, 244, 246)');
  assert.equal(style(pickFallback).width, '72px');
  assert.equal(style(pickFallback).height, '72px');
  assert.equal(style(pickFallback).objectFit, 'cover');
  assert.equal(style(pickFallback).backgroundColor, 'rgb(243, 244, 246)');
});
