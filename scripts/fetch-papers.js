// scripts/fetch-papers.js
// Pulls recent AI/ML papers from the arXiv API (no key required) and
// writes them to data/papers.json.
//
// arXiv API docs: https://info.arxiv.org/help/api/user-manual.html

import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '..', 'public', 'data', 'papers.json');

// cs.AI = Artificial Intelligence, cs.LG = Machine Learning, cs.CL = Computation & Language.
// Full category list: https://arxiv.org/category_taxonomy
const CATEGORIES = ['cs.AI', 'cs.LG', 'cs.CL'];
const MAX_RESULTS = 20;

function buildUrl() {
  const query = CATEGORIES.map((c) => `cat:${c}`).join('+OR+');
  const params = new URLSearchParams({
    search_query: query,
    sortBy: 'submittedDate',
    sortOrder: 'descending',
    max_results: String(MAX_RESULTS),
  });
  // URLSearchParams encodes '+' as '%2B', which arXiv's query parser doesn't
  // like between cat: terms -- rebuild the query string manually instead.
  return `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(
    query
  ).replace(/%2B/g, '+')}&sortBy=submittedDate&sortOrder=descending&max_results=${MAX_RESULTS}`;
}

function clean(text = '') {
  return text.replace(/\s+/g, ' ').trim();
}

async function main() {
  console.log('[fetch-papers] Querying arXiv...');
  const res = await fetch(buildUrl(), { headers: { 'User-Agent': 'personal-dashboard/1.0' } });
  if (!res.ok) {
    throw new Error(`arXiv API returned ${res.status}`);
  }
  const xml = await res.text();
  const parsed = await parseStringPromise(xml);

  const feed = parsed?.feed;
  if (!feed || typeof feed !== 'object') {
    throw new Error('arXiv response did not contain a feed.');
  }

  const totalResultsValue = feed['opensearch:totalResults']?.[0];
  const totalResultsText = typeof totalResultsValue === 'string' ? totalResultsValue.trim() : '';
  const totalResults = Number(totalResultsText);
  if (
    !/^\d+$/.test(totalResultsText) ||
    !Number.isSafeInteger(totalResults) ||
    totalResults < 0
  ) {
    throw new Error('arXiv response contained an invalid total result count.');
  }

  const entries = totalResults === 0 ? [] : feed.entry;
  if (totalResults > 0 && (!Array.isArray(entries) || !entries.length)) {
    throw new Error('arXiv response declared results but contained no entries.');
  }
  if (entries.some((entry) => !entry.title?.[0] || !entry.id?.[0] || !entry.published?.[0])) {
    throw new Error('arXiv response contained a malformed or error entry.');
  }

  const papers = entries.map((entry) => ({
    title: clean(entry.title?.[0]),
    summary: clean(entry.summary?.[0]).slice(0, 400).replace(/\s+\S*$/, '').replace(/\s+$/, '').trim().replace(/[.,;:!?]$/, '').trim().concat('…'),
    link: entry.id?.[0],
    published: entry.published?.[0],
    authors: (entry.author ?? []).map((a) => a.name?.[0]).filter(Boolean),
    categories: (entry['category'] ?? []).map((c) => c.$?.term).filter(Boolean),
  }));

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify(
      { updated: new Date().toISOString(), count: papers.length, items: papers },
      null,
      2
    )
  );
  console.log(`[fetch-papers] Wrote ${papers.length} papers to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error('[fetch-papers] Failed:', err.message);
  process.exit(1);
});
