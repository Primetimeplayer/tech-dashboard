// scripts/lib/robots.js
// A small, dependency-free robots.txt checker. Not used by the current
// fetch-*.js scripts, since all of them use RSS feeds or official APIs --
// robots.txt governs crawling of a site's HTML pages, not requests to
// endpoints explicitly published for programmatic consumption.
//
// Keep this around for if you ever add a source with no feed/API and need
// to scrape its HTML directly -- check first, always:
//
//   import { isAllowedByRobots } from './lib/robots.js';
//   if (!(await isAllowedByRobots(url, 'signal-personal-dashboard'))) {
//     console.log(`robots.txt disallows fetching ${url}, skipping.`);
//   }

import fetch from 'node-fetch';

const cache = new Map(); // origin -> parsed rules, so we don't refetch per-URL in the same run

function parseRobotsTxt(text) {
  // Rules keyed by user-agent (lowercased). '*' is the catch-all group.
  const groups = {};
  let currentAgents = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (key === 'user-agent') {
      // A run of consecutive User-agent lines applies to all of them together.
      if (currentAgents.length && groups[currentAgents[currentAgents.length - 1]]?._started) {
        currentAgents = [];
      }
      currentAgents.push(value.toLowerCase());
      currentAgents.forEach((a) => {
        groups[a] = groups[a] || { disallow: [], allow: [] };
      });
    } else if (key === 'disallow' && currentAgents.length) {
      currentAgents.forEach((a) => groups[a]?.disallow.push(value));
      currentAgents.forEach((a) => { if (groups[a]) groups[a]._started = true; });
    } else if (key === 'allow' && currentAgents.length) {
      currentAgents.forEach((a) => groups[a]?.allow.push(value));
      currentAgents.forEach((a) => { if (groups[a]) groups[a]._started = true; });
    }
  }
  return groups;
}

function matchesRule(pathname, rule) {
  if (!rule) return false;
  // Robots.txt prefix matching (not full wildcard support, but covers the common case).
  return rule !== '' && pathname.startsWith(rule);
}

export async function isAllowedByRobots(targetUrl, userAgent = '*') {
  let origin, pathname;
  try {
    ({ origin, pathname } = new URL(targetUrl));
  } catch {
    return true; // malformed URL isn't this function's problem
  }

  try {
    if (!cache.has(origin)) {
      const res = await fetch(`${origin}/robots.txt`, { timeout: 8000 });
      cache.set(origin, res.ok ? parseRobotsTxt(await res.text()) : {});
    }
    const groups = cache.get(origin);
    const group = groups[userAgent.toLowerCase()] || groups['*'];
    if (!group) return true; // no applicable rules -- default allow

    const disallowed = group.disallow.some((rule) => matchesRule(pathname, rule));
    const allowed = group.allow.some((rule) => matchesRule(pathname, rule));
    // An explicit Allow overrides a Disallow for the same path (simplified precedence).
    return allowed || !disallowed;
  } catch {
    return true; // if robots.txt is unreachable, don't block on that alone
  }
}
