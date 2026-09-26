// scripts/fetch-news.js
// Pulls recent articles from a set of tech news RSS feeds and writes
// them to data/news.json as a single, sorted, de-duplicated list.

import Parser from 'rss-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '..', 'public', 'data', 'news.json');

const parser = new Parser({ timeout: 10000 });

// Add or remove feeds freely. Most news/blog sites publish an RSS feed
// even if it isn't linked in the nav -- try /feed, /rss, or /rss.xml.
const FEEDS = [
  { name: 'The Verge', category: 'news', url: 'https://www.theverge.com/rss/index.xml' },
  { name: 'Ars Technica', category: 'news', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  { name: 'TechCrunch', category: 'news', url: 'https://techcrunch.com/feed/' },
  { name: 'Wired', category: 'news', url: 'https://www.wired.com/feed/rss' },
  { name: 'Engadget', category: 'reviews', url: 'https://www.engadget.com/rss.xml' },
];

const ITEMS_PER_FEED = 12;

function cleanSummary(raw = '') {
  return raw
    .replace(/<[^>]*>/g, ' ')     // strip any stray HTML
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

async function fetchFeed(feed) {
  try {
    const parsed = await parser.parseURL(feed.url);
    return parsed.items.slice(0, ITEMS_PER_FEED).map((item) => ({
      source: feed.name,
      category: feed.category,
      title: item.title?.trim() ?? '(untitled)',
      link: item.link,
      published: item.pubDate ?? item.isoDate ?? null,
      summary: cleanSummary(item.contentSnippet ?? item.content ?? ''),
    }));
  } catch (err) {
    console.error(`[fetch-news] Failed to fetch ${feed.name}: ${err.message}`);
    return [];
  }
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = (item.title || '').toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  console.log(`[fetch-news] Fetching ${FEEDS.length} feeds...`);
  const results = (await Promise.all(FEEDS.map(fetchFeed))).flat();
  const deduped = dedupe(results).sort(
    (a, b) => new Date(b.published ?? 0) - new Date(a.published ?? 0)
  );

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify(
      { updated: new Date().toISOString(), count: deduped.length, items: deduped },
      null,
      2
    )
  );
  console.log(`[fetch-news] Wrote ${deduped.length} items to ${OUT_PATH}`);
}

main();
