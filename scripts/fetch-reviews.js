// scripts/fetch-reviews.js
// Pulls device/product review posts from RSS feeds that publish a
// dedicated reviews section, and writes them to data/reviews.json.

import Parser from 'rss-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { excerpt } from './lib/excerpt.js';
import { storyImage } from './lib/story-image.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '..', 'public', 'data', 'reviews.json');

const parser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent': 'signal-personal-dashboard/1.0 (+https://github.com/Primetimeplayer/tech-dashboard)',
    'Cache-Control': 'no-cache, max-age=0',
    'Pragma': 'no-cache',
  },
  customFields: {
    item: [
      ['media:content', 'media:content', { keepArray: true }],
      ['media:thumbnail', 'media:thumbnail'],
      ['description', 'description'],
    ],
  },
});

// Section-specific feeds tend to be cleaner than filtering a firehose feed
// by keyword. Swap in whatever outlets you actually read.
const FEEDS = [
  { name: 'Engadget Reviews', url: 'https://www.engadget.com/rss.xml' },
  { name: 'The Verge Reviews', url: 'https://www.theverge.com/rss/reviews/index.xml' },
];

const ITEMS_PER_FEED = 10;

function cleanSummary(raw = '') {
  return excerpt(raw, 240);
}

async function fetchFeed(feed, parseFeed) {
  try {
    const parsed = await parseFeed(feed);
    return parsed.items.slice(0, ITEMS_PER_FEED).map((item) => {
      const image = storyImage(item);
      return {
        source: feed.name,
        title: item.title?.trim() ?? '(untitled)',
        link: item.link,
        published: item.pubDate ?? item.isoDate ?? null,
        summary: cleanSummary(item.contentSnippet ?? item.content ?? ''),
        ...(image ? { image } : {}),
      };
    });
  } catch (err) {
    console.error(`[fetch-reviews] Failed to fetch ${feed.name}: ${err.message}`);
    return null;
  }
}

export async function runReviewsFetcher({
  feeds = FEEDS,
  parseFeed = (feed) => parser.parseURL(feed.url),
  outputPath = OUT_PATH,
  now = () => new Date(),
} = {}) {
  console.log(`[fetch-reviews] Fetching ${feeds.length} feeds...`);
  const feedResults = await Promise.all(feeds.map((feed) => fetchFeed(feed, parseFeed)));
  const successfulFeeds = feedResults.filter((items) => items !== null);
  if (!successfulFeeds.length) {
    throw new Error('All review feeds failed; keeping existing data.');
  }

  const results = successfulFeeds.flat();
  results.sort((a, b) => new Date(b.published ?? 0) - new Date(a.published ?? 0));

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      { updated: now().toISOString(), count: results.length, items: results },
      null,
      2
    )
  );
  console.log(`[fetch-reviews] Wrote ${results.length} items to ${outputPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runReviewsFetcher().catch((err) => {
    console.error('[fetch-reviews] Failed:', err.message);
    process.exit(1);
  });
}
