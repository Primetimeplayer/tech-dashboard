// Turn a Google News RSS document into the same item shape as news.json.
// The worker and the tests share this. fetch-news.js still parses feeds with
// rss-parser, then uses splitGoogleTitle for the publisher suffix.

import { excerpt } from './excerpt.js';

const ITEM_LIMIT = 20;

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function tagText(block, tag) {
  const match = String(block || '').match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

export function splitGoogleTitle(title) {
  const text = String(title || '').trim();
  const idx = text.lastIndexOf(' - ');
  if (idx <= 0) return { title: text || '(untitled)', source: 'Google News' };
  const headline = text.slice(0, idx).trim();
  const source = text.slice(idx + 3).trim();
  return {
    title: headline || text,
    source: source || 'Google News',
  };
}

function summaryFromDescription(description) {
  const raw = String(description || '');
  if (/<\s*(ol|ul|li)\b/i.test(raw)) return '';
  return excerpt(raw, 240);
}

export function parseGoogleNewsXml(xml, limit = ITEM_LIMIT) {
  const blocks = String(xml || '').split(/<item\b[^>]*>/i).slice(1);
  const items = [];
  for (const block of blocks) {
    const chunk = block.split(/<\/item>/i)[0];
    const headline = splitGoogleTitle(tagText(chunk, 'title'));
    const link = tagText(chunk, 'link');
    if (!headline.title || !link) continue;
    items.push({
      source: headline.source,
      category: 'news',
      title: headline.title,
      link,
      published: tagText(chunk, 'pubDate') || null,
      summary: summaryFromDescription(tagText(chunk, 'description')),
    });
    if (items.length >= limit) break;
  }
  return items;
}
