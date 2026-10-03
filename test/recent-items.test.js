import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const STORAGE_KEY = 'techDashboardRecents';
const TEST_ORIGIN = 'http://recent-items.test/';
const productionScript = await readFile(new URL('../public/recent-items.js', import.meta.url), 'utf8');

function createRecentItemsDom(t, items) {
  const dom = new JSDOM('<!doctype html><div id="recentArticles"></div>', {
    url: TEST_ORIGIN,
    runScripts: 'outside-only',
  });
  t.after(() => dom.window.close());

  if (items !== undefined) {
    dom.window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  dom.window.eval(productionScript);
  return dom;
}

function getRecentLinks(dom) {
  return [...dom.window.document.querySelectorAll('#recentArticles a')];
}

function clickStoryLink(dom, title, url, { descendant = false } = {}) {
  const { document, MouseEvent } = dom.window;
  const link = document.createElement('a');
  link.dataset.recentTitle = title;
  link.href = url;

  let clickTarget = link;
  if (descendant) {
    clickTarget = document.createElement('span');
    clickTarget.textContent = 'Open story';
    link.appendChild(clickTarget);
  }

  document.body.appendChild(link);
  clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return link.href;
}

test('renders a valid Recent Item with its expected link attributes', (t) => {
  const dom = createRecentItemsDom(t, [{ title: 'Valid story', url: 'https://example.test/story' }]);
  const links = getRecentLinks(dom);

  assert.equal(links.length, 1);
  assert.equal(links[0].textContent, 'Valid story');
  assert.equal(links[0].href, 'https://example.test/story');
  assert.equal(links[0].className, 'recent-item');
  assert.equal(links[0].target, '_blank');
  assert.ok(links[0].relList.contains('noopener'));
  assert.ok(links[0].relList.contains('noreferrer'));
});

test('renders HTML in a stored title as literal text', (t) => {
  const title = '<img src=x onerror=alert(1)>Hello';
  const dom = createRecentItemsDom(t, [{ title, url: 'https://example.test/story' }]);
  const link = getRecentLinks(dom)[0];

  assert.equal(link.textContent, title);
  assert.equal(link.querySelector('img'), null);
  assert.equal(link.children.length, 0);
});

test('rejects javascript: URLs', (t) => {
  const dom = createRecentItemsDom(t, [{ title: 'Unsafe', url: 'javascript:alert(1)' }]);
  assert.equal(getRecentLinks(dom).length, 0);
});

test('rejects data: URLs', (t) => {
  const dom = createRecentItemsDom(t, [{ title: 'Unsafe', url: 'data:text/html,hello' }]);
  assert.equal(getRecentLinks(dom).length, 0);
});

test('rejects file: URLs', (t) => {
  const dom = createRecentItemsDom(t, [{ title: 'Unsafe', url: 'file:///tmp/story.html' }]);
  assert.equal(getRecentLinks(dom).length, 0);
});

test('skips a malformed URL while rendering a valid item', (t) => {
  const dom = createRecentItemsDom(t, [
    { title: 'Malformed', url: 'http://[' },
    { title: 'Valid story', url: 'https://example.test/story' },
  ]);
  const links = getRecentLinks(dom);

  assert.equal(links.length, 1);
  assert.equal(links[0].textContent, 'Valid story');
});

test('skips records with missing, non-string, or whitespace-only titles and URLs', (t) => {
  const dom = createRecentItemsDom(t, [
    { url: 'https://example.test/no-title' },
    { title: 42, url: 'https://example.test/non-string-title' },
    { title: '   ', url: 'https://example.test/blank-title' },
    { title: 'Missing URL' },
    { title: 'Non-string URL', url: 42 },
    { title: 'Whitespace URL', url: '   ' },
    { title: 'Valid story', url: 'https://example.test/story' },
  ]);
  const links = getRecentLinks(dom);

  assert.equal(links.length, 1);
  assert.equal(links[0].textContent, 'Valid story');
});

test('malformed localStorage JSON does not throw and renders no items', (t) => {
  const dom = new JSDOM('<!doctype html><div id="recentArticles"></div>', {
    url: TEST_ORIGIN,
    runScripts: 'outside-only',
  });
  t.after(() => dom.window.close());
  dom.window.localStorage.setItem(STORAGE_KEY, '{malformed json');

  assert.doesNotThrow(() => dom.window.eval(productionScript));
  assert.equal(getRecentLinks(dom).length, 0);
});

test('non-array localStorage JSON does not throw and renders no items', (t) => {
  const dom = createRecentItemsDom(t, { title: 'Not an array', url: 'https://example.test/story' });

  assert.equal(getRecentLinks(dom).length, 0);
});

test('renders only safe valid entries from a mixed list without injecting markup', (t) => {
  const literalTitle = '<b>Literal</b> title';
  const dom = createRecentItemsDom(t, [
    { title: 'Valid one', url: 'https://example.test/one' },
    { title: 'JavaScript', url: 'javascript:alert(1)' },
    { title: literalTitle, url: 'https://example.test/two' },
    { title: 'Data', url: 'data:text/plain,nope' },
    { title: 'Malformed', url: 'http://[' },
    { title: 'File', url: 'file:///tmp/nope' },
    { title: 'Valid three', url: 'http://example.test/three' },
  ]);
  const links = getRecentLinks(dom);

  assert.deepEqual(links.map((link) => link.textContent), ['Valid one', literalTitle, 'Valid three']);
  assert.equal(dom.window.document.querySelector('#recentArticles b'), null);
  assert.equal(dom.window.document.querySelector('#recentArticles img'), null);
});

test('delegates clicks from a story-link descendant and records its URL', (t) => {
  const dom = createRecentItemsDom(t, [{ title: 'Existing recent', url: 'https://example.test/existing' }]);
  assert.equal(getRecentLinks(dom).length, 1);

  const clickedUrl = clickStoryLink(dom, 'New story', 'https://example.test/new', { descendant: true });
  const stored = JSON.parse(dom.window.localStorage.getItem(STORAGE_KEY));

  assert.equal(stored[0].title, 'New story');
  assert.equal(stored[0].url, clickedUrl);
  assert.equal(stored[0].url, 'https://example.test/new');
});

test('click-time deduplication removes prior clicked URLs and caps storage at five', (t) => {
  const clickedUrl = 'https://example.test/clicked';
  const initialItems = [
    { title: 'Old clicked item', url: clickedUrl },
    { title: 'Keep one', url: 'https://example.test/one' },
    { title: 'Duplicate clicked item', url: clickedUrl },
    { title: 'Keep two', url: 'https://example.test/two' },
    { title: 'Keep three', url: 'https://example.test/three' },
    { title: 'Keep four', url: 'https://example.test/four' },
    { title: 'Dropped by cap', url: 'https://example.test/five' },
  ];
  const dom = createRecentItemsDom(t, initialItems);

  clickStoryLink(dom, 'Clicked again', clickedUrl);
  const stored = JSON.parse(dom.window.localStorage.getItem(STORAGE_KEY));

  assert.equal(stored.length, 5);
  assert.deepEqual(stored[0], { title: 'Clicked again', url: clickedUrl });
  assert.equal(stored.filter((item) => item.url === clickedUrl).length, 1);
  assert.deepEqual(stored.slice(1).map((item) => item.title), ['Keep one', 'Keep two', 'Keep three', 'Keep four']);
});

test('each test DOM has its own non-opaque test origin and localStorage', (t) => {
  const dom = createRecentItemsDom(t, [{ title: 'Isolated', url: 'https://example.test/isolated' }]);

  assert.equal(dom.window.location.origin, 'http://recent-items.test');
  assert.equal(dom.window.localStorage.getItem(STORAGE_KEY), JSON.stringify([
    { title: 'Isolated', url: 'https://example.test/isolated' },
  ]));
  assert.equal(getRecentLinks(dom).length, 1);
});
