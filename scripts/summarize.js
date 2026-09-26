// scripts/summarize.js
// Rewrites the `summary` field of each item in public/data/*.json into a
// tighter, clearer one-sentence summary using the Anthropic API.
//
// Requires an ANTHROPIC_API_KEY environment variable. If it isn't set,
// this script does nothing and exits cleanly -- the dashboard falls back
// to the raw RSS/API excerpts, so this step is entirely optional.
//
// Get a key at https://console.anthropic.com/settings/keys
// Locally:  export ANTHROPIC_API_KEY=sk-ant-...   (or put it in a .env file you load yourself)
// On GitHub Actions: add it as a repo secret named ANTHROPIC_API_KEY (see README).

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const FILES = ['news.json', 'papers.json', 'reviews.json', 'reddit.json'];

// Cheap, fast model -- plenty for a one-sentence rewrite. See
// https://docs.claude.com/en/docs/about-claude/models/overview for options.
const MODEL = 'claude-haiku-4-5-20251001';

// Keep this modest: it's one call per article, run every 6 hours.
const MAX_ITEMS_PER_FILE = 15;

async function summarizeOne(title, rawSummary) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 100,
      system:
        'Rewrite the given article title and excerpt as ONE clear, plain-English sentence (max 25 words) summarizing what it is about. Reply with only that sentence, no preamble, no quotes.',
      messages: [
        { role: 'user', content: `Title: ${title}\nExcerpt: ${rawSummary || '(none)'}` },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`API returned ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const text = data.content?.find((b) => b.type === 'text')?.text?.trim();
  return text || rawSummary;
}

async function processFile(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) return;

  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const items = data.items ?? [];

  console.log(`[summarize] ${filename}: summarizing up to ${MAX_ITEMS_PER_FILE} of ${items.length} items...`);

  for (let i = 0; i < Math.min(items.length, MAX_ITEMS_PER_FILE); i++) {
    try {
      items[i].summary = await summarizeOne(items[i].title, items[i].summary);
    } catch (err) {
      console.error(`[summarize] Skipping item "${items[i].title}": ${err.message}`);
      // leave the original summary in place on failure
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`[summarize] ${filename}: done.`);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[summarize] No ANTHROPIC_API_KEY set -- skipping LLM summaries, keeping raw excerpts.');
    return;
  }
  for (const file of FILES) {
    await processFile(file);
  }
}

main().catch((err) => {
  console.error('[summarize] Failed:', err.message);
  // Don't fail the whole workflow just because summarization had an issue --
  // the raw excerpts are still a perfectly good fallback.
  process.exit(0);
});
