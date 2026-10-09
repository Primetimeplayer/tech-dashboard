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

test('locale changes paint a fresh cache without the skeleton', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /src="feed-cache\.js"/);
  assert.match(html, /SignalFeedCache\.read/);
  assert.match(html, /SignalFeedCache\.write/);
  assert.match(html, /if \(cached && staticBuckets\)/);
  assert.match(html, /cached \? cached\.items : null/);
});
