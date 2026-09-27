// scripts/generate-digest.js
// Reads the last 7 days of items from public/data/*.json, picks the most
// notable ones per category, and writes:
//   - public/digests/<id>.json   { id, title, dateRange, markdown, thread }
//   - public/digests/index.json  a running list of all digests (newest first)
//
// With GROQ_API_KEY or ANTHROPIC_API_KEY set: an LLM writes an intro, groups
// highlights with a one-line note each, a closing pick, and a parallel
// Twitter/X-thread version -- grounded strictly in the item titles/summaries
// it's given (it's told not to invent details beyond them).
//
// With no key set: a rule-based fallback still produces a clean digest and
// thread using the existing summaries, just without new prose being written.

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'public', 'data');
const DIGESTS_DIR = path.join(__dirname, '..', 'public', 'digests');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PER_CATEGORY_LIMIT = { news: 6, papers: 4, reviews: 4, reddit: 4 };
const CATEGORY_LABEL = { news: 'Tech news', papers: 'AI papers', reviews: 'Reviews', reddit: 'Reddit' };

function loadItems(filename, category, mapFn) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) return [];
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return (data.items || []).map((raw) => ({ ...mapFn(raw), category }));
}

function withinWeek(item) {
  if (!item.published) return false;
  return Date.now() - new Date(item.published).getTime() <= WEEK_MS;
}

function pickTop(items, category) {
  return items
    .filter((i) => i.category === category)
    .sort((a, b) => new Date(b.published) - new Date(a.published))
    .slice(0, PER_CATEGORY_LIMIT[category] ?? 5);
}

function formatDateRange(start, end) {
  const opts = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString('en-US', opts)}–${end.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
}

// --- LLM-backed digest writing (optional) ---

const DIGEST_INSTRUCTIONS =
  'You write a short, warm, plain-English weekly tech digest. You will be given a JSON list of items ' +
  '(title, source, category, link, note). Using ONLY the information given -- never invent facts, numbers, ' +
  'or details not present in the notes -- reply with ONLY a JSON object shaped exactly like: ' +
  '{"intro": "2-3 sentence opener framing the week, no specifics you were not given", ' +
  '"picks": [{"link": "...", "blurb": "one punchy sentence on why this item made the cut"}], ' +
  '"closing": "one sentence closing line", ' +
  '"thread": ["tweet 1 text (hook, no link)", "tweet 2 text", "... 5-7 tweets total", "final tweet inviting people to read the full digest"]}. ' +
  'Each thread tweet must be under 260 characters. Cover a good spread across categories in "picks", not just one.';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function parseJsonLoose(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

async function callGroq(items) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: DIGEST_INSTRUCTIONS },
        { role: 'user', content: JSON.stringify(items) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq API returned ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return parseJsonLoose(data.choices?.[0]?.message?.content);
}

async function callAnthropic(items) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      system: DIGEST_INSTRUCTIONS,
      messages: [{ role: 'user', content: JSON.stringify(items) }],
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

// --- Fallback (no API key) ---

function fallbackDigestData(curated) {
  return {
    intro: `A roundup of what came through the dashboard this week, across ${Object.keys(curated).length} categories.`,
    picks: Object.values(curated).flat().map((item) => ({
      link: item.link,
      blurb: item.whyItMatters || item.summary || '',
    })),
    closing: 'That is the week in Signal. See the full dashboard for everything else that came through.',
    thread: Object.values(curated).flat().slice(0, 6).map((item) => `${item.title} — ${item.link}`),
  };
}

// --- Assembling markdown from structured digest data ---

function buildMarkdown(title, dateRange, curated, digestData) {
  const byLink = new Map(Object.values(curated).flat().map((i) => [i.link, i]));
  let md = `# ${title}\n\n*${dateRange}*\n\n${digestData.intro}\n\n`;

  for (const category of Object.keys(curated)) {
    const picksInCategory = digestData.picks.filter((p) => byLink.get(p.link)?.category === category);
    if (!picksInCategory.length) continue;
    md += `## ${CATEGORY_LABEL[category]}\n\n`;
    for (const pick of picksInCategory) {
      const item = byLink.get(pick.link);
      if (!item) continue;
      md += `- **[${item.title}](${item.link})** (${item.source}) — ${pick.blurb}\n`;
    }
    md += '\n';
  }

  md += `---\n\n${digestData.closing}\n`;
  return md;
}

async function main() {
  const news = loadItems('news.json', 'news', (i) => i);
  const papers = loadItems('papers.json', 'papers', (i) => ({
    ...i,
    source: (i.authors || []).slice(0, 2).join(', ') + ((i.authors || []).length > 2 ? ' et al.' : ''),
  }));
  const reviews = loadItems('reviews.json', 'reviews', (i) => i);
  const reddit = loadItems('reddit.json', 'reddit', (i) => i);

  const allRecent = [...news, ...papers, ...reviews, ...reddit].filter(withinWeek);

  const curated = {
    news: pickTop(allRecent, 'news'),
    papers: pickTop(allRecent, 'papers'),
    reviews: pickTop(allRecent, 'reviews'),
    reddit: pickTop(allRecent, 'reddit'),
  };

  const totalCurated = Object.values(curated).flat().length;
  if (!totalCurated) {
    console.log('[generate-digest] No items in the last 7 days -- skipping digest.');
    return;
  }

  const forModel = Object.values(curated).flat().map((i) => ({
    title: i.title,
    source: i.source,
    category: i.category,
    link: i.link,
    note: i.whyItMatters || i.summary || '',
  }));

  const provider = pickProvider();
  let digestData;
  if (provider) {
    console.log(`[generate-digest] Writing digest via ${provider.name}...`);
    try {
      digestData = await provider.call(forModel);
      await sleep(500);
    } catch (err) {
      console.error(`[generate-digest] LLM call failed, using fallback: ${err.message}`);
    }
  }
  if (!digestData || !digestData.intro || !Array.isArray(digestData.picks)) {
    console.log('[generate-digest] Using rule-based fallback (no key set, or LLM call failed).');
    digestData = fallbackDigestData(curated);
  }

  const end = new Date();
  const start = new Date(end.getTime() - WEEK_MS);
  const id = end.toISOString().slice(0, 10); // YYYY-MM-DD
  const dateRange = formatDateRange(start, end);
  const title = `Signal Weekly — ${dateRange}`;
  const markdown = buildMarkdown(title, dateRange, curated, digestData);

  fs.mkdirSync(DIGESTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DIGESTS_DIR, `${id}.json`),
    JSON.stringify({ id, title, dateRange, generatedAt: end.toISOString(), markdown, thread: digestData.thread || [] }, null, 2)
  );

  const indexPath = path.join(DIGESTS_DIR, 'index.json');
  const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf-8')) : [];
  const withoutToday = index.filter((d) => d.id !== id); // replace if run twice same day
  withoutToday.unshift({ id, title, dateRange, generatedAt: end.toISOString(), itemCount: totalCurated });
  fs.writeFileSync(indexPath, JSON.stringify(withoutToday, null, 2));

  console.log(`[generate-digest] Wrote digest ${id} (${totalCurated} items curated).`);
}

main().catch((err) => {
  console.error('[generate-digest] Failed:', err.message);
  process.exit(0); // don't fail the workflow over this
});
