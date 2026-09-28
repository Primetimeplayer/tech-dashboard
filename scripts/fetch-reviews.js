// scripts/fetch-reviews.js
// Pulls device/product review posts from RSS feeds that publish a
// dedicated reviews section, and writes them to data/reviews.json.

import Parser from 'rss-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '..', 'public', 'data', 'reviews.json');

const parser = new Parser({ timeout: 10000, headers: { 'User-Agent': 'signal-personal-dashboard/1.0 (+https://github.com/Primetimeplayer/tech-dashboard)' } });

// Section-specific feeds tend to be cleaner than filtering a firehose feed
// by keyword. Swap in whatever outlets you actually read.
const FEEDS = [
  { name: 'Engadget Reviews', url: 'https://www.engadget.com/rss.xml' },
  { name: 'The Verge Reviews', url: 'https://www.theverge.com/reviews/rss/index.xml' },
];

const ITEMS_PER_FEED = 10;

function cleanSummary(raw = '') {
  return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240).replace(/\s+\S*$/, '').replace(/\s+$/, '').trim().replace(/[.,;:!?]$/, '').trim().concat('…');
}

async function fetchFeed(feed) {
  try {
    const parsed = await parser.parseURL(feed.url);
    return parsed.items.slice(0, ITEMS_PER_FEED).map((item) => ({
      source: feed.name,
      title: item.title?.trim() ?? '(untitled)',
      link: item.link,
      published: item.pubDate ?? item.isoDate ?? null,
      summary: cleanSummary(item.contentSnippet ?? item.content ?? ''),
    }));
  } catch (err) {
    console.error(`[fetch-reviews] Failed to fetch ${feed.name}: ${err.message}`);
    return [];
  }
}

async function main() {
  console.log(`[fetch-reviews] Fetching ${FEEDS.length} feeds...`);
  const results = (await Promise.all(FEEDS.map(fetchFeed))).flat();
  results.sort((a, b) => new Date(b.published ?? 0) - new Date(a.published ?? 0));

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify(
      { updated: new Date().toISOString(), count: results.length, items: results },
      null,
      2
    )
  );
  console.log(`[fetch-reviews] Wrote ${results.length} items to ${OUT_PATH}`);
}

main();
