// scripts/fetch-reddit.js
// Pulls top daily posts from a few subreddits using Reddit's public
// .json endpoints (no API key or app registration required for this).
// Reddit requires a descriptive User-Agent or it will rate-limit/block you.

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '..', 'public', 'data', 'reddit.json');

const SUBREDDITS = ['technology', 'MachineLearning', 'hardware'];
const POSTS_PER_SUB = 8;
const USER_AGENT = 'personal-tech-dashboard/1.0 (by u/your-username)';

function cleanText(raw = '') {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 240);
}

async function fetchSubreddit(sub) {
  const url = `https://www.reddit.com/r/${sub}/top/.json?limit=${POSTS_PER_SUB}&t=day`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
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
    return [];
  }
}

async function main() {
  console.log(`[fetch-reddit] Fetching ${SUBREDDITS.length} subreddits...`);
  const results = (await Promise.all(SUBREDDITS.map(fetchSubreddit))).flat();
  results.sort((a, b) => new Date(b.published) - new Date(a.published));

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify(
      { updated: new Date().toISOString(), count: results.length, items: results },
      null,
      2
    )
  );
  console.log(`[fetch-reddit] Wrote ${results.length} items to ${OUT_PATH}`);
}

main();
