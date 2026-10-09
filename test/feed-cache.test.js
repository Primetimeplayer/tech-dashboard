import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function loadCache() {
  const source = await readFile(new URL('../public/feed-cache.js', import.meta.url), 'utf8');
  const context = { window: {}, Date };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.SignalFeedCache;
}

test('feed cache keys locale items and expires after five minutes', async () => {
  const cache = await loadCache();
  assert.equal(cache.TTL_MS, 5 * 60 * 1000);
  assert.equal(cache.key('FR', 'fr'), 'feed_cache_FR_fr');
  assert.equal(cache.key('US', 'en-US'), 'feed_cache_US_en-US');

  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
  const memory = new Map();
  const items = [{ title: 'Paris', link: 'https://example.com/paris', source: 'Google News' }];
  const savedAt = 1_000_000;

  assert.equal(cache.write(storage, memory, 'FR', 'fr', [], savedAt), null);
  const entry = cache.write(storage, memory, 'FR', 'fr', items, savedAt);
  assert.equal(entry.savedAt, savedAt);
  assert.deepEqual(entry.items, items);
  assert.equal(store.has('feed_cache_FR_fr'), true);

  const hit = cache.read(storage, new Map(), 'FR', 'fr', savedAt + cache.TTL_MS - 1);
  assert.equal(hit.savedAt, savedAt);
  assert.equal(hit.items[0].title, 'Paris');

  const memoryOnly = new Map();
  cache.write(null, memoryOnly, 'DE', 'de', [{ title: 'Berlin', link: 'https://example.com/berlin' }], savedAt);
  assert.equal(cache.read(null, memoryOnly, 'DE', 'de', savedAt + 1000).items[0].title, 'Berlin');

  assert.equal(cache.read(storage, new Map(), 'FR', 'fr', savedAt + cache.TTL_MS), null);
  assert.equal(store.has('feed_cache_FR_fr'), false);
  assert.equal(cache.read(storage, memory, 'JP', 'ja', savedAt), null);
});

test('missing or invalid localStorage cache entries do not throw', async () => {
  const cache = await loadCache();
  const store = new Map();
  const removed = [];
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => {
      removed.push(key);
      store.delete(key);
    },
  };
  const memory = new Map();
  const now = 5_000;

  assert.equal(cache.read(storage, memory, 'US', 'en-US', now), null);
  assert.equal(removed.length, 0);

  store.set('feed_cache_US_en-US', '');
  assert.equal(cache.read(storage, memory, 'US', 'en-US', now), null);

  store.set('feed_cache_US_en-US', '{malformed json');
  assert.equal(cache.read(storage, memory, 'US', 'en-US', now), null);
  assert.equal(store.has('feed_cache_US_en-US'), false);
  assert.deepEqual(removed, ['feed_cache_US_en-US']);

  store.set('feed_cache_JP_ja', 'null');
  assert.equal(cache.read(storage, memory, 'JP', 'ja', now), null);
  assert.equal(store.has('feed_cache_JP_ja'), false);

  const throwing = {
    getItem: () => {
      throw new Error('storage disabled');
    },
    removeItem: () => {
      throw new Error('storage disabled');
    },
  };
  assert.equal(cache.read(throwing, memory, 'DE', 'de', now), null);
  assert.equal(cache.read(storage, null, 'US', 'en-US', now), null);
});

test('locale changes paint a fresh cache without the skeleton', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /src="feed-cache\.js"/);
  assert.match(html, /SignalFeedCache\.read/);
  assert.match(html, /SignalFeedCache\.write/);
  assert.match(html, /if \(cached && staticBuckets\)/);
  assert.match(html, /cached \? cached\.items : null/);
  assert.match(html, /const LOCALE_FETCH_MS = 5000/);
  assert.match(html, /AbortSignal\.timeout\(remaining\)/);
  assert.match(html, /signal: AbortSignal\.timeout\(LOCALE_FETCH_MS\)/);
  assert.match(html, /loadJSON\('news\.json'/);
  assert.match(html, /paintErrorBanner\(t\('errorFeed'\)\)/);
  assert.match(html, /button\.id = 'retryFeed'/);
  assert.match(html, /statusEl\.hidden = true/);
  assert.match(await readFile(new URL('../public/feed-cache.js', import.meta.url), 'utf8'), /JSON\.parse\(raw\)/);
});
