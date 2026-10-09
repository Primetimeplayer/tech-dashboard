/* Locale feed cache. Each entry is the Google News items for one region and
   language, kept for five minutes in memory and in localStorage. */
(function () {
  var TTL_MS = 5 * 60 * 1000;

  function key(region, language) {
    return 'feed_cache_' + region + '_' + language;
  }

  function fresh(entry, now) {
    return !!(entry
      && Array.isArray(entry.items)
      && entry.items.length
      && typeof entry.savedAt === 'number'
      && now - entry.savedAt < TTL_MS);
  }

  function read(storage, memory, region, language, now) {
    var cacheKey = key(region, language);
    var stamp = typeof now === 'number' ? now : Date.now();
    var memoryEntry = memory && memory.get(cacheKey);
    if (fresh(memoryEntry, stamp)) return memoryEntry;
    if (!storage) return null;
    try {
      var raw = storage.getItem(cacheKey);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!fresh(parsed, stamp)) {
        storage.removeItem(cacheKey);
        if (memory) memory.delete(cacheKey);
        return null;
      }
      if (memory) memory.set(cacheKey, parsed);
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function write(storage, memory, region, language, items, now) {
    if (!Array.isArray(items) || !items.length) return null;
    var entry = { savedAt: typeof now === 'number' ? now : Date.now(), items: items };
    var cacheKey = key(region, language);
    if (memory) memory.set(cacheKey, entry);
    if (!storage) return entry;
    try {
      storage.setItem(cacheKey, JSON.stringify(entry));
    } catch (e) {}
    return entry;
  }

  window.SignalFeedCache = { TTL_MS: TTL_MS, key: key, read: read, write: write };
})();
