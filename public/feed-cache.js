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

  function drop(storage, memory, cacheKey) {
    try {
      if (storage) storage.removeItem(cacheKey);
    } catch (e) {}
    try {
      if (memory) memory.delete(cacheKey);
    } catch (e) {}
  }

  // Missing keys and invalid JSON must not throw. A thrown parse here used to
  // stop the feed script before it could hide the skeleton.
  function read(storage, memory, region, language, now) {
    var cacheKey = key(region, language);
    var stamp = typeof now === 'number' ? now : Date.now();
    var memoryEntry = null;
    try {
      memoryEntry = memory && memory.get(cacheKey);
    } catch (e) {
      memoryEntry = null;
    }
    if (fresh(memoryEntry, stamp)) return memoryEntry;
    if (!storage) return null;
    var raw = null;
    try {
      raw = storage.getItem(cacheKey);
    } catch (e) {
      return null;
    }
    if (raw == null || raw === '') return null;
    try {
      var parsed = JSON.parse(raw);
      if (!fresh(parsed, stamp)) {
        drop(storage, memory, cacheKey);
        return null;
      }
      try {
        if (memory) memory.set(cacheKey, parsed);
      } catch (e) {}
      return parsed;
    } catch (e) {
      drop(storage, memory, cacheKey);
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
