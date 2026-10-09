/* Locale feed cache. Each entry is the Google News items for one region and
   language, kept for five minutes in memory and in localStorage. */
(function () {
  var TTL_MS = 5 * 60 * 1000;

  function key(region, language) {
    return 'feed_cache_' + region + '_' + language;
  }

  function usable(entry) {
    return !!(entry
      && Array.isArray(entry.items)
      && entry.items.length
      && typeof entry.savedAt === 'number');
  }

  function fresh(entry, now) {
    return usable(entry) && now - entry.savedAt < TTL_MS;
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
  // allowStale keeps an expired entry for a failed RSS fetch. A normal read
  // still drops expired and invalid entries.
  function read(storage, memory, region, language, now, options) {
    var allowStale = !!(options && options.allowStale);
    var cacheKey = key(region, language);
    var stamp = typeof now === 'number' ? now : Date.now();
    var memoryEntry = null;
    try {
      memoryEntry = memory && memory.get(cacheKey);
    } catch (e) {
      memoryEntry = null;
    }
    if (fresh(memoryEntry, stamp)) return memoryEntry;
    if (!storage) return allowStale && usable(memoryEntry) ? memoryEntry : null;
    var raw = null;
    try {
      raw = storage.getItem(cacheKey);
    } catch (e) {
      return allowStale && usable(memoryEntry) ? memoryEntry : null;
    }
    if (raw == null || raw === '') return allowStale && usable(memoryEntry) ? memoryEntry : null;
    try {
      var parsed = JSON.parse(raw);
      if (!usable(parsed)) {
        drop(storage, memory, cacheKey);
        return null;
      }
      if (!fresh(parsed, stamp)) {
        if (allowStale) {
          try {
            if (memory) memory.set(cacheKey, parsed);
          } catch (e) {}
          return parsed;
        }
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
