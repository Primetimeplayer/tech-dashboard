// scripts/summarize.js
// For each item in public/data/*.json, generates:
//   - summary:        one clear plain-English sentence
//   - whyItMatters:   one short sentence on why it's worth caring about
//
// Provider priority (first one with a key set wins):
//   1. Groq       -- FREE tier, no credit card required. Get a key at
//                    https://console.groq.com/keys (model: llama-3.1-8b-instant)
//   2. Anthropic  -- paid, small per-article cost. Get a key at
//                    https://console.anthropic.com/settings/keys
//
// If neither GROQ_API_KEY nor ANTHROPIC_API_KEY is set, this script does
// nothing and exits cleanly -- the dashboard falls back to raw excerpts,
// so this step is entirely optional.

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const FILES = ['news.json', 'papers.json', 'reviews.json', 'reddit.json'];

// Keep this modest -- it's 1 API call per article, and Groq's free tier is
// rate-limited (30 requests/min at the time of writing). Increase once you
// know your quota comfortably covers it.
const MAX_ITEMS_PER_FILE = 12;
const DELAY_BETWEEN_CALLS_MS = 2200; // stays safely under ~30 req/min

const PROMPT_INSTRUCTIONS =
  'You are helping summarize tech/AI articles for a personal dashboard. ' +
  'Given a title and excerpt, reply with ONLY a JSON object (no markdown, no code fence) ' +
  'shaped exactly like {"summary": "...", "why_it_matters": "..."}. ' +
  '"summary" is ONE plain-English sentence (max 25 words) stating what the piece is about. ' +
  '"why_it_matters" is ONE short sentence (max 20 words) on why a tech-savvy reader might care. ' +
  'If the excerpt is too thin to say anything specific, make why_it_matters a brief, honest, general note rather than inventing details.';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonLoose(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

async function callGroq(title, excerpt) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: PROMPT_INSTRUCTIONS },
        { role: 'user', content: `Title: ${title}\nExcerpt: ${excerpt || '(none)'}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq API returned ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return parseJsonLoose(data.choices?.[0]?.message?.content);
}

async function callAnthropic(title, excerpt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: PROMPT_INSTRUCTIONS,
      messages: [{ role: 'user', content: `Title: ${title}\nExcerpt: ${excerpt || '(none)'}` }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API returned ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.content?.find((b) => b.type === 'text')?.text;
  return parseJsonLoose(text);
}

function pickProvider() {
  if (process.env.GROQ_API_KEY) return { name: 'Groq', call: callGroq };
  if (process.env.ANTHROPIC_API_KEY) return { name: 'Anthropic', call: callAnthropic };
  return null;
}

async function processFile(filename, provider) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) return;

  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const items = data.items ?? [];
  const n = Math.min(items.length, MAX_ITEMS_PER_FILE);

  console.log(`[summarize] ${filename}: processing ${n} of ${items.length} items via ${provider.name}...`);

  for (let i = 0; i < n; i++) {
    try {
      const result = await provider.call(items[i].title, items[i].summary);
      if (result?.summary) items[i].summary = result.summary;
      if (result?.why_it_matters) items[i].whyItMatters = result.why_it_matters;
    } catch (err) {
      console.error(`[summarize] Skipping "${items[i].title}": ${err.message}`);
    }
    await sleep(DELAY_BETWEEN_CALLS_MS);
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`[summarize] ${filename}: done.`);
}

async function main() {
  const provider = pickProvider();
  if (!provider) {
    console.log('[summarize] No GROQ_API_KEY or ANTHROPIC_API_KEY set -- skipping, keeping raw excerpts.');
    return;
  }
  for (const file of FILES) {
    await processFile(file, provider);
  }
}

main().catch((err) => {
  console.error('[summarize] Failed:', err.message);
  process.exit(0); // don't fail the whole workflow over this optional step
});
