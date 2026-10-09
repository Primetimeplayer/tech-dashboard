import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Parser from 'rss-parser';

import { runNewsFetcher, buildNewsFeeds } from '../scripts/fetch-news.js';
import {
  applyLocaleParams,
  googleNewsUrl,
  LANGUAGES,
  REGIONS,
} from '../scripts/lib/news-locale.js';
import { parseGoogleNewsXml } from '../scripts/lib/parse-google-news.js';

const rssParser = new Parser();

test('Google News URL uses hl, gl, and ceid from the selected region and language', () => {
  assert.equal(
    googleNewsUrl('US', 'en-US'),
    'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en'
  );
  assert.equal(
    googleNewsUrl('GB', 'en-US'),
    'https://news.google.com/rss?hl=en-GB&gl=GB&ceid=GB:en'
  );
  assert.equal(
    googleNewsUrl('JP', 'ja'),
    'https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja'
  );
  assert.equal(
    googleNewsUrl('MX', 'es-419'),
    'https://news.google.com/rss?hl=es-419&gl=MX&ceid=MX:es-419'
  );
  assert.equal(
    googleNewsUrl('INT', 'fr'),
    'https://news.google.com/rss/headlines/section/topic/WORLD?hl=fr&gl=US&ceid=US:fr'
  );
  assert.equal(googleNewsUrl('nope', 'nope'), googleNewsUrl('US', 'en-US'));
});

test('locale query is applied to publisher feeds and skipped for The Verge', () => {
  const feeds = buildNewsFeeds('GB', 'en-US');
  const byName = Object.fromEntries(feeds.map((feed) => [feed.name, feed.url]));

  assert.equal(byName['The Verge'], 'https://www.theverge.com/rss/index.xml');
  assert.equal(
    applyLocaleParams('https://www.theverge.com/rss/index.xml', 'JP', 'ja'),
    'https://www.theverge.com/rss/index.xml'
  );

  const ars = new URL(byName['Ars Technica']);
  assert.equal(ars.searchParams.get('gl'), 'GB');
  assert.equal(ars.searchParams.get('hl'), 'en-US');

  const wired = new URL(byName['Wired']);
  assert.equal(wired.searchParams.get('gl'), 'GB');
  assert.equal(wired.searchParams.get('hl'), 'en-US');

  assert.equal(byName['Google News'], googleNewsUrl('GB', 'en-US'));
});

test('news fetcher asks rss-parser for the locale-specific Google News URL', async (t) => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tech-dashboard-locale-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = await readFile(new URL('./fixtures/rss-sample.xml', import.meta.url), 'utf8');
  const urls = [];

  await runNewsFetcher({
    outputPath: path.join(directory, 'news.json'),
    now: () => new Date('2025-01-02T03:04:05.000Z'),
    region: 'JP',
    language: 'ja',
    parseFeed: async (feed) => {
      urls.push(feed.url);
      return rssParser.parseString(fixture);
    },
  });

  assert.ok(urls.includes('https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja'));
  assert.ok(urls.includes('https://www.theverge.com/rss/index.xml'));
  assert.equal(urls.length, 5);
});

test('Google News RSS items drop the publisher suffix and link-list description', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item>
      <title>Chip launch draws a crowd - Nikkei</title>
      <link>https://news.google.com/rss/articles/example</link>
      <pubDate>Fri, 09 Oct 2026 21:11:00 GMT</pubDate>
      <description>&lt;ol&gt;&lt;li&gt;&lt;a href="https://example.com"&gt;Chip launch&lt;/a&gt;&lt;/li&gt;&lt;/ol&gt;</description>
    </item>
  </channel></rss>`;
  const items = parseGoogleNewsXml(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Chip launch draws a crowd');
  assert.equal(items[0].source, 'Nikkei');
  assert.equal(items[0].category, 'news');
  assert.equal(items[0].link, 'https://news.google.com/rss/articles/example');
  assert.equal(items[0].summary, '');
  assert.equal(items[0].published, 'Fri, 09 Oct 2026 21:11:00 GMT');
});

test('header region and language options match the feed locale list', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const regionBlock = html.split('id="regionSelect"')[1].split('</select>')[0];
  const languageBlock = html.split('id="languageSelect"')[1].split('</select>')[0];
  const values = (block) => [...block.matchAll(/value="([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(values(regionBlock), REGIONS.map((region) => region.id));
  assert.deepEqual(values(languageBlock), LANGUAGES.map((language) => language.id));
  assert.match(html, /localStorage\.setItem\(LOCALE_REGION_KEY/);
  assert.match(html, /localStorage\.setItem\(LOCALE_LANGUAGE_KEY/);
  assert.match(html, /const LOCALE_REGION_KEY = 'region'/);
  assert.match(html, /const LOCALE_LANGUAGE_KEY = 'language'/);
});

test('dynamic Google News fetch gives up after five seconds', async () => {
  const worker = await readFile(new URL('../cloudflare-worker/worker.js', import.meta.url), 'utf8');
  const locale = await readFile(new URL('../scripts/lib/news-locale.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(worker, /googleNewsUrl\(region, language\)/);
  assert.match(worker, /const deadline = Date\.now\(\) \+ 5000/);
  assert.match(worker, /AbortSignal\.timeout\(remaining\)/);
  assert.match(html, /const LOCALE_FETCH_MS = 5000/);
  assert.match(
    locale,
    /https:\/\/news\.google\.com\/rss\?hl=\$\{hl\}&gl=\$\{edition\}&ceid=\$\{edition\}:\$\{lang\}/
  );
});
