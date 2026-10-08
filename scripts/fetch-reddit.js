// scripts/fetch-reddit.js
// Pulls top daily posts from a few subreddits using Reddit's public
// .json endpoints (no API key or app registration required for this).
// Reddit requires a descriptive User-Agent or it will rate-limit/block you.

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { excerpt } from './lib/excerpt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '..', 'public', 'data', 'reddit.json');

const SUBREDDITS = ['technology', 'MachineLearning', 'hardware'];
const POSTS_PER_SUB = 8;
const USER_AGENT = 'personal-tech-dashboard/1.0 (by u/your-username)';

function cleanText(raw = '') {
  return excerpt(raw, 240);
}

async function fetchSubreddit(sub, request) {
  const url = `https://www.reddit.com/r/${sub}/top/.json?limit=${POSTS_PER_SUB}&t=day`;
  try {
    const res = await request(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return (json.data?.children ?? [])
      .filter((c) => !c.data.stickied)
      .map((c) => ({
        source: `r/${sub}`,
        title: c.data.title,
        link: `https://reddit.com${c.data.permalink}`,
        published: new Date(c.data.created_utc * 1000).toISOString(),
        summary: cleanText(c.data.selftext) || `${c.data.ups} upvotes · ${c.data.num_comments} comments`,
      }));
  } catch (err) {
    console.error(`[fetch-reddit] Failed to fetch r/${sub}: ${err.message}`);
    return null;
  }
}

export async function runRedditFetcher({
  subreddits = SUBREDDITS,
  request = fetch,
  outputPath = OUT_PATH,
  now = () => new Date(),
} = {}) {
  console.log(`[fetch-reddit] Fetching ${subreddits.length} subreddits...`);
  const subredditResults = await Promise.all(
    subreddits.map((subreddit) => fetchSubreddit(subreddit, request))
  );
  const successfulSubreddits = subredditResults.filter((items) => items !== null);
  if (!successfulSubreddits.length) {
    throw new Error('All subreddit requests failed; keeping existing data.');
  }

  const results = successfulSubreddits.flat();
  results.sort((a, b) => new Date(b.published) - new Date(a.published));

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      { updated: now().toISOString(), count: results.length, items: results },
      null,
      2
    )
  );
  console.log(`[fetch-reddit] Wrote ${results.length} items to ${outputPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRedditFetcher().catch((err) => {
    console.error('[fetch-reddit] Failed:', err.message);
    process.exit(1);
  });
}
