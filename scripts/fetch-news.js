// scripts/fetch-news.js
// Pulls recent articles from a set of tech news RSS feeds and writes
// them to data/news.json as a single, sorted, de-duplicated list.

import Parser from 'rss-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { excerpt } from './lib/excerpt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '..', 'public', 'data', 'news.json');

const parser = new Parser({ timeout: 10000, headers: { 'User-Agent': 'signal-personal-dashboard/1.0 (+https://github.com/Primetimeplayer/tech-dashboard)' } });

// Add or remove feeds freely. Most news/blog sites publish an RSS feed
// even if it isn't linked in the nav -- try /feed, /rss, or /rss.xml.
const FEEDS = [
  { name: 'The Verge', category: 'news', url: 'https://www.theverge.com/rss/index.xml' },
  { name: 'Ars Technica', category: 'news', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  { name: 'TechCrunch', category: 'news', url: 'https://techcrunch.com/feed/' },
  { name: 'Wired', category: 'news', url: 'https://www.wired.com/feed/rss' },
];

const ITEMS_PER_FEED = 12;

function cleanSummary(raw = '') {
  return excerpt(raw, 240);
}

async function fetchFeed(feed, parseFeed) {
  try {
    const parsed = await parseFeed(feed);
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
    return null;
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

export async function runNewsFetcher({
  feeds = FEEDS,
  parseFeed = (feed) => parser.parseURL(feed.url),
  outputPath = OUT_PATH,
  now = () => new Date(),
} = {}) {
  console.log(`[fetch-news] Fetching ${feeds.length} feeds...`);
  const feedResults = await Promise.all(feeds.map((feed) => fetchFeed(feed, parseFeed)));
  const successfulFeeds = feedResults.filter((items) => items !== null);
  if (!successfulFeeds.length) {
    throw new Error('All news feeds failed; keeping existing data.');
  }

  const results = successfulFeeds.flat();
  const deduped = dedupe(results).sort(
    (a, b) => new Date(b.published ?? 0) - new Date(a.published ?? 0)
  );

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      { updated: now().toISOString(), count: deduped.length, items: deduped },
      null,
      2
    )
  );
  console.log(`[fetch-news] Wrote ${deduped.length} items to ${outputPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runNewsFetcher().catch((err) => {
    console.error('[fetch-news] Failed:', err.message);
    process.exit(1);
  });
}
