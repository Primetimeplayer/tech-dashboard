import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function checkBinary(name) {
  try {
    const res = spawnSync(name, ['--version'], { stdio: 'ignore' });
    return res.status === 0;
  } catch {
    return false;
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function startHttpServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let reqPath = decodeURIComponent(req.url.split('?')[0]);
      if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

      const filePath = path.join(PUBLIC_DIR, reqPath);
      if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(`Not found: ${reqPath}`);
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache'
        });
        fs.createReadStream(filePath).pipe(res);
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port });
    });

    server.on('error', reject);
  });
}

class WebDriverClient {
  constructor(port) {
    this.baseUrl = `http://127.0.0.1:${port}`;
    this.sessionId = null;
  }

  async request(method, reqPath, body = null) {
    const url = `${this.baseUrl}${reqPath}`;
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body !== null) {
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`WebDriver ${method} ${reqPath} failed (${res.status}): ${JSON.stringify(data)}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async createSession() {
    const data = await this.request('POST', '/session', {
      capabilities: {
        alwaysMatch: {
          'moz:firefoxOptions': {
            args: ['-headless'],
            prefs: {
              'browser.cache.disk.enable': false,
              'browser.cache.memory.enable': false,
              'network.cookie.cookieBehavior': 0
            }
          },
          timeouts: {
            pageLoad: 30000,
            script: 30000
          }
        }
      }
    });
    this.sessionId = data.value.sessionId;
    return data.value;
  }

  async deleteSession() {
    if (!this.sessionId) return;
    try {
      await this.request('DELETE', `/session/${this.sessionId}`);
    } finally {
      this.sessionId = null;
    }
  }

  async navigate(url) {
    return await this.request('POST', `/session/${this.sessionId}/url`, { url });
  }

  async getTitle() {
    const data = await this.request('GET', `/session/${this.sessionId}/title`);
    return data.value;
  }

  async findElement(selector) {
    try {
      const data = await this.request('POST', `/session/${this.sessionId}/element`, {
        using: 'css selector',
        value: selector
      });
      return data.value ? data.value['element-6066-11e4-a52e-4f735466cecf'] : null;
    } catch {
      return null;
    }
  }

  async findElements(selector) {
    try {
      const data = await this.request('POST', `/session/${this.sessionId}/elements`, {
        using: 'css selector',
        value: selector
      });
      return (data.value || []).map(el => el['element-6066-11e4-a52e-4f735466cecf']);
    } catch {
      return [];
    }
  }

  async click(elementId) {
    return await this.request('POST', `/session/${this.sessionId}/element/${elementId}/click`, {});
  }

  // W3C actions: used where element click cannot express the intent
  // (e.g. clicking a full-screen backdrop next to an overlaid drawer).
  async performActions(actions) {
    return await this.request('POST', `/session/${this.sessionId}/actions`, { actions });
  }

  async pointerClickAt(x, y) {
    return await this.performActions([{
      type: 'pointer',
      id: 'mouse',
      parameters: { pointerType: 'mouse' },
      actions: [
        { type: 'pointerMove', duration: 0, x, y },
        { type: 'pointerDown', button: 0 },
        { type: 'pointerUp', button: 0 }
      ]
    }]);
  }

  async pressKey(key) {
    return await this.performActions([{
      type: 'key',
      id: 'keyboard',
      actions: [
        { type: 'keyDown', value: key },
        { type: 'keyUp', value: key }
      ]
    }]);
  }

  async clear(elementId) {
    return await this.request('POST', `/session/${this.sessionId}/element/${elementId}/clear`, {});
  }

  async sendKeys(elementId, text) {
    return await this.request('POST', `/session/${this.sessionId}/element/${elementId}/value`, { text });
  }

  async executeScript(script, args = []) {
    const data = await this.request('POST', `/session/${this.sessionId}/execute/sync`, {
      script,
      args
    });
    return data.value;
  }

  async setWindowRect(width, height) {
    return await this.request('POST', `/session/${this.sessionId}/window/rect`, {
      width,
      height
    });
  }

  async refresh() {
    return await this.request('POST', `/session/${this.sessionId}/refresh`, {});
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// geckodriver's W3C key actions accept WebDriver key codes, not key names.
const KEY_ESCAPE = String.fromCharCode(0xe00c);
const KEY_TAB = String.fromCharCode(0xe004);

const hasGecko = checkBinary('geckodriver');
const hasFirefox = checkBinary('firefox');

test('browser regression suite (headless Firefox + direct WebDriver)', { timeout: 60000 }, async (t) => {
  if (!hasGecko || !hasFirefox) {
    t.skip(`Skipping browser tests: geckodriver (${hasGecko ? 'found' : 'missing'}), firefox (${hasFirefox ? 'found' : 'missing'})`);
    return;
  }

  let httpServer = null;
  let geckoProcess = null;
  let driver = null;
  let testUrl = '';

  t.after(async () => {
    if (driver && driver.sessionId) {
      try {
        await driver.deleteSession();
      } catch {
        // Session deletion best-effort
      }
    }
    if (geckoProcess) {
      try {
        geckoProcess.kill('SIGTERM');
      } catch {
        // Process termination best-effort
      }
      try {
        // geckodriver does not reliably honour SIGTERM. While it stays alive
        // the ChildProcess handle keeps Node's event loop open, so
        // `node --test` never exits even though every test has finished.
        geckoProcess.kill('SIGKILL');
      } catch {
        // Forced termination best-effort
      }
    }
    if (httpServer) {
      try {
        await new Promise(r => httpServer.close(r));
      } catch {
        // Server close best-effort
      }
    }
  });

  // 1. Start temporary static server
  const serverInfo = await startHttpServer();
  httpServer = serverInfo.server;
  testUrl = `http://127.0.0.1:${serverInfo.port}/index.html`;

  // 2. Start geckodriver
  const geckoPort = await getFreePort();
  geckoProcess = spawn('geckodriver', ['--port', String(geckoPort), '--host', '127.0.0.1'], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let geckoReady = false;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${geckoPort}/status`);
      if (r.ok) {
        geckoReady = true;
        break;
      }
    } catch {
      await sleep(100);
    }
  }
  assert.ok(geckoReady, 'geckodriver failed to respond on /status');

  // 3. Create WebDriver session & navigate to dashboard
  driver = new WebDriverClient(geckoPort);
  await driver.createSession();
  assert.ok(driver.sessionId, 'WebDriver session creation returned valid sessionId');

  await driver.navigate(testUrl);

  // Wait for document.readyState complete & feed loaded
  let feedLoaded = false;
  for (let i = 0; i < 50; i++) {
    const cardCount = await driver.executeScript('return document.querySelectorAll("#feed .card").length;');
    const statusText = await driver.executeScript('const el = document.getElementById("status"); return el ? el.textContent : "";');
    if (cardCount > 0 || (statusText && statusText.includes('items'))) {
      feedLoaded = true;
      break;
    }
    await sleep(100);
  }
  assert.ok(feedLoaded, 'Dashboard feed failed to load within timeout');

  // --- SUBTESTS ---

  await t.test('loads dashboard and renders initial feed cards', async () => {
    const title = await driver.getTitle();
    assert.match(title, /Signal/i, 'Page title must contain "Signal"');

    const statusEl = await driver.findElement('#status');
    assert.ok(statusEl, '#status element must exist');

    const feedEl = await driver.findElement('#feed');
    assert.ok(feedEl, '#feed element must exist');

    const latestSecEl = await driver.findElement('#latestSection');
    assert.ok(latestSecEl, '#latestSection element must exist');

    const latestRowEl = await driver.findElement('#latestRow');
    assert.ok(latestRowEl, '#latestRow element must exist');

    const themeToggleEl = await driver.findElement('#themeToggle');
    assert.ok(themeToggleEl, '#themeToggle element must exist');

    const searchEl = await driver.findElement('#search');
    assert.ok(searchEl, '#search element must exist');

    const cardCount = await driver.executeScript('return document.querySelectorAll("#feed .card").length;');
    assert.ok(cardCount > 0, `Expected feed cards, found ${cardCount}`);

    const fetchErrors = await driver.executeScript('return window.fetchErrors || [];');
    assert.equal(fetchErrors.length, 0, `Dashboard reported fetchErrors: ${JSON.stringify(fetchErrors)}`);
  });

  await t.test('toggles theme and persists across page refresh', async () => {
    const initialTheme = await driver.executeScript('return document.documentElement.getAttribute("data-theme");');
    assert.equal(initialTheme, 'light', 'Default theme should be "light"');

    const themeToggleEl = await driver.findElement('#themeToggle');
    await driver.click(themeToggleEl);
    await sleep(200);

    const toggledTheme = await driver.executeScript('return document.documentElement.getAttribute("data-theme");');
    assert.equal(toggledTheme, 'dark', 'Theme should switch to "dark" on toggle click');

    await driver.refresh();
    await sleep(500);

    const persistedTheme = await driver.executeScript('return document.documentElement.getAttribute("data-theme");');
    assert.equal(persistedTheme, 'dark', 'Theme "dark" must persist in localStorage across page refresh');

    // Reset back to light
    const themeToggleAfterRefresh = await driver.findElement('#themeToggle');
    await driver.click(themeToggleAfterRefresh);
    await sleep(200);
    const restoredTheme = await driver.executeScript('return document.documentElement.getAttribute("data-theme");');
    assert.equal(restoredTheme, 'light', 'Theme should switch back to "light"');
  });

  await t.test('filters feed by category and updates aria-pressed', async () => {
    const filterEl = await driver.findElement('.filter[data-cat="news"]');
    assert.ok(filterEl, 'News category filter element must exist');

    const initialAria = await driver.executeScript('return document.querySelector(\'.filter[data-cat="news"]\').getAttribute("aria-pressed");');
    assert.equal(initialAria, 'false', 'Initial aria-pressed for news filter should be "false"');

    await driver.click(filterEl);
    await sleep(300);

    const resultingAria = await driver.executeScript('return document.querySelector(\'.filter[data-cat="news"]\').getAttribute("aria-pressed");');
    assert.equal(resultingAria, 'true', 'aria-pressed should update to "true" when active');

    const nonNewsCount = await driver.executeScript('return document.querySelectorAll("#feed .card:not(.news)").length;');
    assert.equal(nonNewsCount, 0, 'No non-news cards should be visible when filtered to "news"');

    const newsCount = await driver.executeScript('return document.querySelectorAll("#feed .card.news").length;');
    assert.ok(newsCount > 0, 'News cards should remain visible when filtered');

    // Reset to "all"
    const allFilterEl = await driver.findElement('.filter[data-cat="all"]');
    if (allFilterEl) {
      await driver.click(allFilterEl);
      await sleep(200);
    }
  });

  await t.test('searches feed with debounce and restores when cleared', async () => {
    const searchEl = await driver.findElement('#search');
    assert.ok(searchEl, 'Search input element must exist');

    const initialCount = await driver.executeScript('return document.querySelectorAll("#feed .card").length;');

    await driver.sendKeys(searchEl, 'podracing');
    await sleep(400); // 150ms debounce

    const filteredCount = await driver.executeScript('return document.querySelectorAll("#feed .card").length;');
    assert.ok(filteredCount > 0, 'Filtered card count should be greater than 0');
    assert.ok(filteredCount <= initialCount, 'Filtered card count should be less than or equal to total');

    const cardTitles = await driver.executeScript(`
      return Array.from(document.querySelectorAll("#feed .card h2")).map(h => h.textContent.toLowerCase());
    `);
    const matchesTerm = cardTitles.some(t => t.includes('podracing') || t.includes('star wars'));
    assert.ok(matchesTerm, 'Search result cards must match query keywords');

    // Clear and dispatch input event
    await driver.clear(searchEl);
    await driver.executeScript(`
      const el = document.getElementById("search");
      el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    `);
    await sleep(400);

    const restoredCount = await driver.executeScript('return document.querySelectorAll("#feed .card").length;');
    assert.equal(restoredCount, initialCount, 'Clearing search input must restore full card count');
  });

  await t.test('renders Latest row with valid story cards', async () => {
    const latestCardsCount = await driver.executeScript('return document.querySelectorAll("#latestRow .latest-card").length;');
    assert.ok(latestCardsCount > 0, `Expected latest cards in #latestRow, found ${latestCardsCount}`);

    const cardsValid = await driver.executeScript(`
      const cards = Array.from(document.querySelectorAll("#latestRow .latest-card"));
      return cards.every(c => {
        const cat = c.querySelector(".cat");
        const title = c.querySelector("h3");
        return cat && cat.textContent.trim().length > 0 && title && title.textContent.trim().length > 0;
      });
    `);
    assert.ok(cardsValid, 'All cards in #latestRow must have non-empty category and title elements');
  });

  await t.test('Latest Stories renders a visible strip of story cards', async () => {
    await driver.setWindowRect(1280, 900);
    await sleep(200);

    const state = await driver.executeScript(`
      const section = document.getElementById('latestSection');
      const row = document.getElementById('latestRow');
      const cards = Array.from(row.querySelectorAll('.latest-card'));
      return {
        hidden: section.hidden,
        cardCount: cards.length,
        allHaveContent: cards.every(c => {
          const cat = c.querySelector('.cat');
          const h3 = c.querySelector('h3');
          return cat && cat.textContent.trim() && h3 && h3.textContent.trim();
        }),
        rowVisible: row.getBoundingClientRect().height > 0,
        sectionHeight: document.querySelector('.latest').getBoundingClientRect().height
      };
    `);

    assert.equal(state.hidden, false, 'Latest Stories section must be visible once cards exist');
    assert.ok(state.cardCount > 1, `Expected multiple Latest Stories cards, found ${state.cardCount}`);
    assert.ok(state.allHaveContent, 'Every Latest Stories card needs a category line and a title');
    assert.ok(state.rowVisible, 'Latest Stories row must be rendered with a non-zero height');
    assert.ok(
      state.sectionHeight > 60 && state.sectionHeight <= 260,
      `Latest Stories must stay compact, measured ${state.sectionHeight}px`
    );
  });

  await t.test('Latest Stories desktop shows complete cards instead of clipped ones', async () => {
    await driver.setWindowRect(1280, 900);
    await sleep(300);

    const layout = await driver.executeScript(`
      const row = document.getElementById('latestRow');
      row.scrollLeft = 0;
      const cards = Array.from(row.querySelectorAll('.latest-card'));
      const rr = row.getBoundingClientRect();
      const cs = getComputedStyle(row);
      const rects = cards.map(c => c.getBoundingClientRect());
      const fullyVisible = rects.filter(b => b.left >= rr.left - 1 && b.right <= rr.right + 1).length;
      const partiallyVisible = rects.filter(b =>
        b.right > rr.left + 1 && b.left < rr.right - 1 && !(b.left >= rr.left - 1 && b.right <= rr.right + 1)
      ).length;
      return {
        overflowX: cs.overflowX,
        snap: cs.scrollSnapType,
        fullyVisible,
        partiallyVisible,
        cardWidth: Math.round(rects[0].width),
        clientWidth: row.clientWidth,
        scrollWidth: row.scrollWidth,
        cardCount: cards.length
      };
    `);

    assert.equal(layout.overflowX, 'auto', 'Latest Stories must keep a native horizontal scroll container');
    assert.match(layout.snap, /x/, 'Latest Stories must keep horizontal scroll snapping');
    assert.ok(
      layout.fullyVisible >= 4 && layout.fullyVisible <= 5,
      `Expected 4-5 fully visible cards on desktop, measured ${layout.fullyVisible}`
    );
    assert.equal(layout.partiallyVisible, 0, 'Desktop must not show partially clipped cards at the scroll start');
    assert.ok(layout.scrollWidth > layout.clientWidth, 'Latest Stories must remain horizontally scrollable');
    assert.ok(layout.cardCount > layout.fullyVisible, 'Expected more cards than fit, so navigation is meaningful');
    assert.ok(
      layout.cardWidth >= 190 && layout.cardWidth <= layout.clientWidth / 3,
      `Card width ${layout.cardWidth}px should stay near the current size, not shrink or balloon`
    );
  });

  await t.test('Latest Stories prev/next controls are labelled buttons', async () => {
    const controls = await driver.executeScript(`
      const read = id => {
        const el = document.getElementById(id);
        if (!el) return null;
        return {
          tag: el.tagName,
          type: el.getAttribute('type'),
          label: (el.getAttribute('aria-label') || '').trim(),
          controls: el.getAttribute('aria-controls'),
          svgHidden: !!el.querySelector('svg[aria-hidden="true"]')
        };
      };
      const btn = document.getElementById('latestNext');
      btn.focus();
      const focus = { activeId: document.activeElement.id, tag: document.activeElement.tagName };
      btn.blur();
      return { prev: read('latestPrev'), next: read('latestNext'), focus };
    `);

    for (const [name, info] of Object.entries(controls)) {
      if (name === 'focus') continue;
      assert.ok(info, `#latest${name === 'prev' ? 'Prev' : 'Next'} must exist`);
      assert.equal(info.tag, 'BUTTON', `#latest${name} must be a real button`);
      assert.equal(info.type, 'button', `#latest${name} must not submit a form`);
      assert.ok(info.label.length > 0, `#latest${name} needs an accessible label`);
      assert.equal(info.controls, 'latestRow', `#latest${name} must reference the scroll container it controls`);
      assert.ok(info.svgHidden, `#latest${name} icon must be hidden from assistive technology`);
    }

    assert.match(controls.prev.label, /previous/i, 'Previous control label must describe its action');
    assert.match(controls.next.label, /next/i, 'Next control label must describe its action');
    assert.equal(controls.focus.tag, 'BUTTON', 'Next control must be focusable');
    assert.equal(controls.focus.activeId, 'latestNext', 'Next control must receive keyboard focus');
  });

  await t.test('Latest Stories next control is operable from the keyboard', async () => {
    await driver.setWindowRect(1280, 900);
    await sleep(200);
    await driver.executeScript('const r = document.getElementById("latestRow"); r.scrollLeft = 0;');
    await sleep(200);

    // Reach the controls with real Tab presses so :focus-visible applies.
    const searchEl = await driver.findElement('#search');
    assert.ok(searchEl, '#search must exist to start keyboard traversal');
    await driver.sendKeys(searchEl, '');

    let focusedId = null;
    for (let i = 0; i < 12 && focusedId !== 'latestNext'; i++) {
      await driver.sendKeys(searchEl, '\uE004'); // Tab
      focusedId = await driver.executeScript('return document.activeElement ? document.activeElement.id : null;');
    }
    assert.equal(focusedId, 'latestNext', 'Tab must reach the Latest Stories next control');

    const focusStyle = await driver.executeScript(`
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName,
        focusVisible: el.matches(':focus-visible'),
        outlineWidth: parseFloat(cs.outlineWidth) || 0,
        outlineStyle: cs.outlineStyle
      };
    `);
    assert.equal(focusStyle.tag, 'BUTTON', 'Keyboard focus must land on a button');
    assert.ok(focusStyle.focusVisible, 'Keyboard focus must register as :focus-visible');
    assert.ok(
      focusStyle.outlineWidth >= 1 && focusStyle.outlineStyle !== 'none',
      'Keyboard-focused control must show a visible focus ring'
    );

    const before = await driver.executeScript('return document.getElementById("latestRow").scrollLeft;');
    const nextEl = await driver.findElement('#latestNext');
    await driver.sendKeys(nextEl, '\uE007'); // Enter activates a focused button
    await sleep(500);
    const after = await driver.executeScript('return document.getElementById("latestRow").scrollLeft;');

    assert.ok(after > before, `Enter must scroll the strip forward (before ${before}, after ${after})`);

    // Leave focus out of the strip for the following subtests.
    await driver.executeScript('document.getElementById("latestRow").scrollLeft = 0;');
    await sleep(200);
  });

  await t.test('Latest Stories next and previous controls move the scroll position', async () => {
    await driver.setWindowRect(1280, 900);
    await sleep(200);
    await driver.executeScript('const r = document.getElementById("latestRow"); r.scrollLeft = 0;');
    await sleep(200);

    const cardWidth = await driver.executeScript(
      'return Math.round(document.querySelector("#latestRow .latest-card").getBoundingClientRect().width);'
    );
    assert.ok(cardWidth > 0, 'Expected a measurable card width');

    const nextEl = await driver.findElement('#latestNext');
    const start = await driver.executeScript('return document.getElementById("latestRow").scrollLeft;');
    await driver.click(nextEl);
    await sleep(600);
    const afterNext = await driver.executeScript('return document.getElementById("latestRow").scrollLeft;');

    assert.ok(afterNext > start, `Clicking next must scroll forward (before ${start}, after ${afterNext})`);
    assert.ok(
      afterNext <= cardWidth * 1.5,
      `A single next click should advance roughly one card (${cardWidth}px), moved ${afterNext}px`
    );

    const prevEl = await driver.findElement('#latestPrev');
    await driver.click(prevEl);
    await sleep(600);
    const afterPrev = await driver.executeScript('return document.getElementById("latestRow").scrollLeft;');

    assert.ok(afterPrev < afterNext, `Clicking previous must scroll back (before ${afterNext}, after ${afterPrev})`);
  });

  await t.test('Latest Stories controls disable at the start and the end of the list', async () => {
    await driver.setWindowRect(1280, 900);
    await sleep(200);

    const atStart = await driver.executeScript(`
      const row = document.getElementById('latestRow');
      row.scrollLeft = 0;
      const prev = document.getElementById('latestPrev');
      const next = document.getElementById('latestNext');
      return {
        scrollLeft: row.scrollLeft,
        prevDisabled: prev.disabled,
        nextDisabled: next.disabled,
        prevOpacity: parseFloat(getComputedStyle(prev).opacity),
        nextOpacity: parseFloat(getComputedStyle(next).opacity)
      };
    `);

    assert.equal(atStart.scrollLeft, 0, 'Strip starts at the beginning');
    assert.equal(atStart.prevDisabled, true, 'Previous must be disabled at the beginning');
    assert.equal(atStart.nextDisabled, false, 'Next must be enabled at the beginning');
    assert.ok(
      atStart.prevOpacity < atStart.nextOpacity,
      'Disabled previous must be visually de-emphasized relative to next'
    );

    const atEnd = await driver.executeScript(`
      const row = document.getElementById('latestRow');
      row.scrollLeft = row.scrollWidth;
      return new Promise(resolve => setTimeout(() => resolve({
        scrollLeft: row.scrollLeft,
        max: row.scrollWidth - row.clientWidth,
        prevDisabled: document.getElementById('latestPrev').disabled,
        nextDisabled: document.getElementById('latestNext').disabled,
        nextOpacity: parseFloat(getComputedStyle(document.getElementById('latestNext')).opacity)
      }), 400));
    `);

    assert.ok(atEnd.max > 0, 'Strip must be scrollable');
    assert.ok(atEnd.scrollLeft >= atEnd.max - 2, 'Strip should reach its maximum scroll offset');
    assert.equal(atEnd.nextDisabled, true, 'Next must be disabled at the end');
    assert.equal(atEnd.prevDisabled, false, 'Previous must be enabled at the end');
    assert.ok(atEnd.nextOpacity < 1, 'Disabled next must be visually de-emphasized');

    const restored = await driver.executeScript(`
      const row = document.getElementById('latestRow');
      row.scrollLeft = 0;
      return new Promise(resolve => setTimeout(() => resolve({
        prevDisabled: document.getElementById('latestPrev').disabled,
        nextDisabled: document.getElementById('latestNext').disabled
      }), 400));
    `);
    assert.equal(restored.prevDisabled, true, 'Returning home must disable previous again');
    assert.equal(restored.nextDisabled, false, 'Returning home must re-enable next');
  });

  await t.test('Latest Stories stays usable and touch-scrollable on mobile', async () => {
    await driver.setWindowRect(390, 844);
    await sleep(400);

    const mobile = await driver.executeScript(`
      const row = document.getElementById('latestRow');
      const nav = document.querySelector('.latest-nav');
      const cards = Array.from(row.querySelectorAll('.latest-card'));
      const rr = row.getBoundingClientRect();
      const fully = cards.filter(c => {
        const b = c.getBoundingClientRect();
        return b.left >= rr.left - 1 && b.right <= rr.right + 1;
      }).length;
      const before = row.scrollLeft;
      row.scrollLeft = 200;
      const after = row.scrollLeft;
      row.scrollLeft = before;
      return {
        navDisplay: getComputedStyle(nav).display,
        overflowX: getComputedStyle(row).overflowX,
        snap: getComputedStyle(row).scrollSnapType,
        docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        cardCount: cards.length,
        fullyVisible: fully,
        cardWidth: Math.round(cards[0].getBoundingClientRect().width),
        scrolled: after > before,
        rowFitsViewport: rr.left >= -1 && rr.right <= document.documentElement.clientWidth + 1
      };
    `);

    assert.equal(mobile.navDisplay, 'none', 'Prev/next controls must not crowd the narrow layout');
    assert.equal(mobile.overflowX, 'auto', 'Mobile must keep native horizontal scrolling');
    assert.match(mobile.snap, /x/, 'Mobile must keep scroll snapping for touch scrolling');
    assert.equal(mobile.docOverflow, false, 'Mobile layout must not cause page-level horizontal overflow');
    assert.ok(mobile.cardCount > 1, 'Mobile must still render story cards');
    assert.ok(mobile.fullyVisible >= 1, 'Mobile must show at least one complete card');
    assert.ok(mobile.scrolled, 'Mobile strip must be natively scrollable');
    assert.ok(mobile.rowFitsViewport, 'Mobile strip must stay inside the viewport');

    await driver.setWindowRect(1280, 900);
    await sleep(300);
    const resized = await driver.executeScript(`
      const row = document.getElementById('latestRow');
      row.scrollLeft = 0;
      return new Promise(resolve => setTimeout(() => resolve({
        navDisplay: getComputedStyle(document.querySelector('.latest-nav')).display,
        prevDisabled: document.getElementById('latestPrev').disabled,
        nextDisabled: document.getElementById('latestNext').disabled,
        scrollLeft: row.scrollLeft
      }), 400));
    `);
    assert.notEqual(resized.navDisplay, 'none', 'Controls must return on wider viewports');
    assert.equal(resized.prevDisabled, true, 'Resize back to desktop must disable previous at the start');
    assert.equal(resized.nextDisabled, false, 'Resize back to desktop must leave next enabled');
  });

  await t.test('Latest Stories controls follow the active light/dark theme', async () => {
    await driver.setWindowRect(1280, 900);
    await sleep(200);

    const readTheme = () => driver.executeScript(`
      const card = document.querySelector('#latestRow .latest-card');
      const btn = document.getElementById('latestNext');
      const cardStyle = getComputedStyle(card);
      const btnStyle = getComputedStyle(btn);
      return {
        theme: document.documentElement.getAttribute('data-theme'),
        cardBg: cardStyle.backgroundColor,
        cardBorder: cardStyle.borderTopColor,
        btnBg: btnStyle.backgroundColor,
        btnBorder: btnStyle.borderTopColor,
        btnColor: btnStyle.color,
        headingColor: getComputedStyle(document.querySelector('.latest-label h2')).color
      };
    `);

    const lightTheme = await driver.executeScript(
      "document.documentElement.setAttribute('data-theme','light'); return true;"
    );
    assert.ok(lightTheme);
    await sleep(200);
    const light = await readTheme();

    const themeToggleEl = await driver.findElement('#themeToggle');
    await driver.click(themeToggleEl);
    await sleep(300);
    const dark = await readTheme();

    assert.equal(light.theme, 'light');
    assert.equal(dark.theme, 'dark', 'Theme toggle must switch to dark');
    assert.notEqual(dark.cardBg, light.cardBg, 'Latest Stories card surface must change in dark mode');
    assert.notEqual(dark.cardBorder, light.cardBorder, 'Latest Stories card border must change in dark mode');
    assert.notEqual(dark.headingColor, light.headingColor, 'Latest Stories heading must remain legible in dark mode');
    assert.equal(dark.btnBg, dark.cardBg, 'Controls must reuse the theme surface token');
    assert.equal(dark.btnBorder, dark.cardBorder, 'Controls must reuse the theme border token');
    assert.notEqual(dark.btnColor, light.btnColor, 'Control icon color must change with the theme');

    // Restore light for the remaining subtests.
    const toggleAgain = await driver.findElement('#themeToggle');
    await driver.click(toggleAgain);
    await sleep(300);
    const restored = await readTheme();
    assert.equal(restored.theme, 'light', 'Theme must be restored to light');
    assert.equal(restored.btnBg, light.btnBg, 'Control surface must return to the light theme value');
  });

  await t.test('cards render titles, metadata, links and actions as before', async () => {
    await driver.setWindowRect(1280, 900);
    await driver.executeScript(`
      document.querySelector('.filter[data-cat="all"]').click();
    `);
    await sleep(400);

    const cards = await driver.executeScript(`
      const list = Array.from(document.querySelectorAll('#feed .card'));
      return {
        count: list.length,
        sample: list.slice(0, 6).map(c => {
          const link = c.querySelector('h2 a');
          return {
            hasTitle: !!(c.querySelector('h2') && c.querySelector('h2').textContent.trim()),
            hasMeta: !!c.querySelector('.card-meta'),
            metaText: c.querySelector('.card-meta').textContent.replace(/\\s+/g, ' ').trim(),
            href: link ? link.href : null,
            protocolOk: link ? /^https?:/.test(link.getAttribute('href') || '') : false,
            target: link ? link.getAttribute('target') : null,
            rel: link ? link.getAttribute('rel') : null,
            hasActions: c.querySelectorAll('.card-actions button').length,
            categoryClass: c.className
          };
        })
      };
    `);

    assert.ok(cards.count > 0, 'Feed cards must render');
    for (const card of cards.sample) {
      assert.ok(card.hasTitle, 'Each card must keep a title');
      assert.ok(card.hasMeta && card.metaText.length > 0, 'Each card must keep its category metadata');
      assert.ok(card.protocolOk, 'Card links must stay http(s) links');
      assert.equal(card.target, '_blank', 'Card links must keep target=_blank');
      assert.match(card.rel, /noopener/, 'Card links must keep rel=noopener');
      assert.equal(card.hasActions, 2, 'Each card must keep its save and share actions');
    }

    const danglingSeparators = cards.sample.filter(c => /·\s*·|\|\s*·|·\s*\|/.test(c.metaText));
    assert.equal(
      danglingSeparators.length,
      0,
      `Card metadata must not render empty separators, saw ${JSON.stringify(cards.sample.map(c => c.metaText))}`
    );
  });

  await t.test('cards show contextual chips only for data that provides them', async () => {
    await driver.setWindowRect(1280, 900);

    // News cards carry no subject data: no chip may be invented for them.
    const newsChips = await driver.executeScript(`
      document.querySelector('.filter[data-cat="news"]').click();
      return new Promise(resolve => setTimeout(() => resolve({
        cards: document.querySelectorAll('#feed .card').length,
        withChipRow: document.querySelectorAll('#feed .card .card-chips').length,
        chips: document.querySelectorAll('#feed .card .card-chips .chip').length
      }), 300));
    `);
    assert.ok(newsChips.cards > 0, 'Expected news cards');
    assert.equal(newsChips.withChipRow, 0, 'Cards without subject data must not render a chip row');
    assert.equal(newsChips.chips, 0, 'Cards without subject data must not render chips');

    // Paper subject data is read from the fixture in Node and handed to the
    // page as a script argument. The card assertions therefore depend on the
    // checked-in data file only, never on an in-page HTTP request.
    const papersFixture = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'data', 'papers.json'), 'utf8'));
    const paperSubjects = (papersFixture.items || []).map(item => [
      item.title,
      Array.isArray(item.categories) ? item.categories : []
    ]);

    // Papers carry arXiv subject codes: exactly one chip, matching the data.
    const papers = await driver.executeScript(`
      const byTitle = new Map(arguments[0]);
      document.querySelector('.filter[data-cat="papers"]').click();
      return new Promise(resolve => setTimeout(() => {
        const cards = Array.from(document.querySelectorAll('#feed .card'));
        resolve(cards.map(c => {
          const title = c.querySelector('h2').textContent.trim();
          const categories = byTitle.get(title) || [];
          return {
            title: title.slice(0, 40),
            chips: Array.from(c.querySelectorAll('.card-chips .chip')).map(ch => ch.textContent.trim()),
            expected: categories.length ? (categories[0] || '') : '',
            hasSubjectClass: c.classList.contains('papers'),
            categoryLabel: c.querySelector('.cat-label').textContent.trim()
          };
        }));
      }, 300));
    `, [paperSubjects]);

    assert.ok(papers.length > 0, 'Expected paper cards');
    for (const card of papers) {
      assert.ok(card.hasSubjectClass, 'Paper cards must keep their category class');
      assert.ok(card.categoryLabel.length > 0, 'Category label must remain text, not only a chip');
      assert.ok(card.chips.length <= 1, `Cards must stay restrained, found ${card.chips.length} chips`);
      if (card.chips.length) {
        assert.match(card.chips[0], /^[a-z-]+(\.[a-z-]+)?\.[A-Z]{2}$/, 'Chip must be a real arXiv subject code');
        assert.equal(card.chips[0], card.expected, `Chip must match the item's own subject data (${card.title})`);
      }
    }

    await driver.executeScript(`document.querySelector('.filter[data-cat="all"]').click();`);
    await sleep(300);
  });

  await t.test('chips are readable in both light and dark themes', async () => {
    await driver.setWindowRect(1280, 900);
    await driver.executeScript(`document.querySelector('.filter[data-cat="papers"]').click();`);
    await sleep(400);

    const readChips = () => driver.executeScript(`
      const root = getComputedStyle(document.documentElement);
      const chips = Array.from(document.querySelectorAll('#feed .card .card-chips .chip'));
      const badges = Array.from(document.querySelectorAll('#feed .card .hw-badge'));
      const describe = (el) => {
        const s = getComputedStyle(el);
        return { color: s.color, background: s.backgroundColor, border: s.borderTopColor, text: el.textContent.trim() };
      };
      return {
        theme: document.documentElement.getAttribute('data-theme'),
        papersToken: root.getPropertyValue('--papers').trim(),
        lineToken: root.getPropertyValue('--line').trim(),
        panelToken: root.getPropertyValue('--panel').trim(),
        chip: chips.length ? describe(chips[0]) : null,
        badge: badges.length ? describe(badges[0]) : null
      };
    `);

    await driver.executeScript("document.documentElement.setAttribute('data-theme','light');");
    await sleep(200);
    const light = await readChips();

    await driver.executeScript("document.documentElement.setAttribute('data-theme','dark');");
    await sleep(200);
    const dark = await readChips();

    await driver.executeScript("document.documentElement.setAttribute('data-theme','light');");
    await sleep(150);

    assert.equal(light.theme, 'light');
    assert.ok(light.chip, 'Expected at least one chip to inspect');
    assert.notEqual(dark.chip.color, light.chip.color, 'Chip text must change with the theme');
    assert.notEqual(dark.chip.background, light.chip.background, 'Chip surface must change with the theme');
    assert.notEqual(dark.chip.border, light.chip.border, 'Chip border must change with the theme');
    assert.notEqual(light.chip.color, light.papersToken.toLowerCase(), 'Chip colour must come from a theme token, not a literal');

    const toRgb = (hex) => {
      const clean = hex.trim().replace('#', '');
      const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
      const n = parseInt(full, 16);
      return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
    };
    assert.equal(dark.chip.color, toRgb(dark.papersToken), 'Dark chip must use the dark --papers token');
    assert.equal(light.chip.border, toRgb(light.lineToken), 'Light chip border must use the --line token');
    assert.equal(dark.chip.background, toRgb(dark.panelToken), 'Dark chip surface must use the --panel token');
  });

  await t.test('Hardware chip still marks hardware cards after the restyle', async () => {
    await driver.setWindowRect(1280, 900);
    await driver.executeScript(`document.querySelector('.filter[data-cat="all"]').click();`);
    await sleep(300);

    const beforeToggle = await driver.executeScript(`
      return { total: document.querySelectorAll('#feed .card').length, badges: document.querySelectorAll('#feed .card .hw-badge').length };
    `);
    assert.ok(beforeToggle.total > 0, 'Expected cards before the hardware filter');
    assert.ok(
      beforeToggle.badges < beforeToggle.total,
      'Only hardware-related cards should carry the Hardware chip'
    );

    const hwEl = await driver.findElement('#hwToggle');
    await driver.click(hwEl);
    await sleep(500);

    const filtered = await driver.executeScript(`
      const cards = Array.from(document.querySelectorAll('#feed .card'));
      return {
        total: cards.length,
        badges: cards.filter(c => c.querySelector('.hw-badge')).length,
        hardwareClass: cards.filter(c => c.classList.contains('is-hardware')).length,
        badgeText: cards.length && cards[0].querySelector('.hw-badge') ? cards[0].querySelector('.hw-badge').textContent.trim() : null,
        allLinksPresent: cards.every(c => !!c.querySelector('h2 a')),
        pressed: document.getElementById('hwToggle').getAttribute('aria-pressed')
      };
    `);

    assert.ok(filtered.total > 0, 'Hardware filter must show results');
    assert.equal(filtered.badges, filtered.total, 'Every hardware-filtered card must keep its Hardware chip');
    assert.equal(filtered.hardwareClass, filtered.total, 'Hardware-filtered cards must keep the is-hardware class');
    assert.match(filtered.badgeText, /Hardware/i, 'Hardware chip must keep its wording');
    assert.equal(filtered.pressed, 'true', 'Hardware toggle must report pressed state');
    assert.ok(filtered.allLinksPresent, 'Filtered cards must keep working links');

    await driver.click(hwEl);
    await sleep(400);
  });

  await t.test('cards render without images and stay readable', async () => {
    await driver.setWindowRect(1280, 900);
    await driver.executeScript(`document.querySelector('.filter[data-cat="all"]').click();`);
    await sleep(400);

    const media = await driver.executeScript(`
      const cards = Array.from(document.querySelectorAll('#feed .card'));
      return {
        cards: cards.length,
        images: document.querySelectorAll('#feed .card img').length,
        backgrounds: cards.filter(c => getComputedStyle(c).backgroundImage !== 'none').length,
        titles: cards.filter(c => c.querySelector('h2') && c.querySelector('h2').textContent.trim()).length,
        heights: cards.slice(0, 6).map(c => Math.round(c.getBoundingClientRect().height))
      };
    `);

    assert.ok(media.cards > 0, 'Expected cards');
    assert.equal(media.images, 0, 'No card images may be introduced; the feed has no reliable image field');
    assert.equal(media.backgrounds, 0, 'Cards must not depend on remote background images');
    assert.equal(media.titles, media.cards, 'Every card must keep readable title text without an image');
  });

  await t.test('Latest Stories titles stay readable without breaking the carousel', async () => {
    await driver.setWindowRect(1280, 900);
    await sleep(300);

    const titles = await driver.executeScript(`
      const row = document.getElementById('latestRow');
      const cards = Array.from(row.querySelectorAll('.latest-card'));
      const headings = cards.map(c => c.querySelector('h3'));
      const first = headings[0];
      const style = getComputedStyle(first);
      const lineHeight = parseFloat(style.lineHeight) || 1;
      const original = first.textContent;
      const baselineHeight = first.offsetHeight;
      const probeText = new Array(40).join('Extended headline used to measure the clamp ');
      first.textContent = probeText;
      const longHeight = first.offsetHeight;
      const longLines = Math.round((longHeight / lineHeight) * 10) / 10;
      first.textContent = original;

      // Same text in an unclamped twin, so the clamp is measured against
      // what the headline would occupy if it were never truncated. This
      // works on any engine: no vendor display value is involved. Every
      // override must win the cascade, because the card stylesheet applies
      // the clamp with !important.
      const probe = first.cloneNode(true);
      const off = (prop, value) => probe.style.setProperty(prop, value, 'important');
      probe.textContent = probeText;
      off('position', 'absolute');
      off('visibility', 'hidden');
      off('pointer-events', 'none');
      off('display', 'block');
      off('overflow', 'visible');
      off('height', 'auto');
      off('max-height', 'none');
      off('-webkit-line-clamp', 'none');
      off('line-clamp', 'none');
      off('-webkit-box-orient', 'horizontal');
      off('width', first.clientWidth + 'px');
      off('font-family', style.fontFamily);
      off('font-size', style.fontSize);
      off('font-weight', style.fontWeight);
      off('line-height', style.lineHeight);
      off('letter-spacing', style.letterSpacing);
      first.parentNode.appendChild(probe);
      const naturalLines = Math.round((probe.getBoundingClientRect().height / lineHeight) * 10) / 10;
      probe.remove();

      const rect = row.getBoundingClientRect();
      const fullyVisible = cards.filter(c => {
        const b = c.getBoundingClientRect();
        return b.left >= rect.left - 1 && b.right <= rect.right + 1;
      }).length;

      return {
        cardCount: cards.length,
        fullyVisible: fullyVisible,
        baselineLines: Math.round((baselineHeight / lineHeight) * 10) / 10,
        longLines: longLines,
        naturalLines: naturalLines,
        overflow: style.overflow,
        maxHeight: style.maxHeight,
        clippedNow: headings.filter(h => h.scrollHeight > h.clientHeight + 1).length,
        sectionHeight: Math.round(document.querySelector('.latest').getBoundingClientRect().height),
        rowOverflow: getComputedStyle(row).overflowX,
        rowSnap: getComputedStyle(row).scrollSnapType
      };
    `);

    assert.ok(titles.cardCount > 0, 'Latest Stories must render cards');
    // The clamp is a rendering behaviour, not a vendor-prefixed declaration.
    // Firefox resolves display: -webkit-box / -webkit-line-clamp to its own
    // internal values, so asserting on the computed display string or on
    // webkitBoxOrient/-webkit-line-clamp tests the engine, not the design.
    // Instead the title is measured: it wraps, it is allowed four lines, and
    // a headline that would need more is truncated by an overflow:hidden box
    // rather than growing the card.
    assert.equal(titles.overflow, 'hidden', 'A very long headline must be clipped by an overflow:hidden box instead of stretching the card');
    assert.ok(titles.maxHeight === 'none' || titles.maxHeight === '', 'The title must not be capped by a fixed max-height; the clamp is what limits it');
    assert.ok(
      titles.baselineLines >= 1 && titles.baselineLines <= 4,
      `A real headline must occupy at most the four allowed lines, measured ${titles.baselineLines}`
    );
    assert.ok(
      titles.naturalLines > titles.longLines,
      `A long headline must be truncated, but it measured the same ${titles.longLines} lines unclamped (${titles.naturalLines})`
    );
    assert.ok(
      titles.longLines > 1 && titles.longLines <= 4,
      `A long headline must expand to several lines but never more than four, measured ${titles.longLines}`
    );
    assert.equal(titles.clippedNow, 0, 'Current Latest titles must not be clipped at all');
    assert.ok(
      titles.fullyVisible >= 4 && titles.fullyVisible <= 5,
      `Desktop must still show 4-5 complete cards, measured ${titles.fullyVisible}`
    );
    assert.ok(titles.sectionHeight <= 260, `Latest Stories must stay compact, measured ${titles.sectionHeight}px`);
    assert.equal(titles.rowOverflow, 'auto', 'Latest Stories must keep native horizontal scrolling');
    assert.match(titles.rowSnap, /x/, 'Latest Stories must keep scroll snapping');
  });

  await t.test('renders Recent Items and enforces XSS protection', async () => {
    const safeTitle = 'Safe Test Recent Story';
    const safeUrl = 'https://example.com/safe-story';

    // 1. Test safe item rendering
    await driver.executeScript(`
      localStorage.setItem('techDashboardRecents', JSON.stringify([
        { title: ${JSON.stringify(safeTitle)}, url: ${JSON.stringify(safeUrl)} }
      ]));
    `);
    await driver.refresh();
    await sleep(500);

    const safeResult = await driver.executeScript(`
      const items = Array.from(document.querySelectorAll("#recentArticles .recent-item"));
      return items.map(a => ({ text: a.textContent.trim(), href: a.href }));
    `);
    assert.ok(safeResult.length >= 1, 'Expected at least 1 recent article item rendered');
    assert.equal(safeResult[0].text, safeTitle);
    assert.equal(safeResult[0].href, safeUrl);

    // 2. Test XSS / HTML injection resistance
    const maliciousTitle = '<img src=x onerror="window.__recentInjection=true">';
    const maliciousUrl = 'https://example.com/malicious';

    await driver.executeScript(`
      localStorage.setItem('techDashboardRecents', JSON.stringify([
        { title: ${JSON.stringify(maliciousTitle)}, url: ${JSON.stringify(maliciousUrl)} },
        { title: ${JSON.stringify(safeTitle)}, url: ${JSON.stringify(safeUrl)} }
      ]));
    `);
    await driver.refresh();
    await sleep(500);

    const xssCheck = await driver.executeScript(`
      const imgCount = document.querySelectorAll("#recentArticles img").length;
      const injectionFlag = window.__recentInjection === true;
      const firstItem = document.querySelector("#recentArticles .recent-item");
      return {
        imgCount,
        injectionFlag,
        text: firstItem ? firstItem.textContent : null,
        innerHTML: firstItem ? firstItem.innerHTML : null
      };
    `);

    assert.equal(xssCheck.imgCount, 0, 'No img tags should be created inside #recentArticles');
    assert.equal(xssCheck.injectionFlag, false, 'XSS script injection must not execute');
    assert.equal(xssCheck.text, maliciousTitle, 'Malicious payload must be treated as literal text');

    // Clean up recents localStorage
    await driver.executeScript('localStorage.removeItem("techDashboardRecents");');
    await driver.refresh();
    await sleep(300);
  });

  await t.test('desktop sidebar renders the expected navigation', async () => {
    await driver.setWindowRect(1280, 900);
    await driver.executeScript(`
      try { localStorage.removeItem('techDashboardRecents'); } catch (e) {}
    `);
    await driver.refresh();
    for (let i = 0; i < 50; i++) {
      const cards = await driver.executeScript('return document.querySelectorAll("#feed .card").length;');
      if (cards > 0) break;
      await sleep(100);
    }
    await sleep(200);

    const sidebar = await driver.executeScript(`
      const filters = document.getElementById('filters');
      const rect = filters.getBoundingClientRect();
      return {
        visible: rect.width > 0 && rect.height > 0,
        width: Math.round(rect.width),
        headings: Array.from(filters.querySelectorAll('.sidebar-section > .sidebar-heading')).map(h => h.textContent.trim()),
        items: Array.from(filters.querySelectorAll('.sidebar-item')).map(el => ({
          id: el.id || el.dataset.cat || '',
          text: el.textContent.trim()
        })),
        menuToggle: getComputedStyle(document.getElementById('menuToggle')).display,
        backdrop: getComputedStyle(document.getElementById('sidebarBackdrop')).display,
        drawerHead: getComputedStyle(document.querySelector('.sidebar-drawer-head')).display,
        accountSection: !!document.querySelector('.sidebar-section.sidebar-account #syncSettingsBtn'),
        docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    `);

    assert.ok(sidebar.visible, 'Sidebar must be visible on desktop');
    assert.ok(sidebar.width >= 180, `Sidebar should keep its desktop width, measured ${sidebar.width}px`);
    assert.ok(
      sidebar.headings.includes('TOPICS') && sidebar.headings.includes('LIBRARY'),
      `Sidebar should keep its TOPICS and LIBRARY groups, found ${JSON.stringify(sidebar.headings)}`
    );
    assert.ok(sidebar.headings.includes('ACCOUNT'), 'Log in should live in its own ACCOUNT group');
    const ids = sidebar.items.map(i => i.id);
    for (const expected of ['all', 'news', 'papers', 'reviews', 'reddit', 'hwToggle', 'savedToggle', 'digestsNav', 'syncSettingsBtn']) {
      assert.ok(ids.includes(expected), `Sidebar must expose navigation item "${expected}", found ${JSON.stringify(ids)}`);
    }
    assert.ok(sidebar.accountSection, 'Log in button must be grouped under ACCOUNT, not mixed into the content filters');
    assert.equal(sidebar.menuToggle, 'none', 'Mobile menu control must stay hidden on desktop');
    assert.equal(sidebar.backdrop, 'none', 'Drawer backdrop must stay hidden on desktop');
    assert.equal(sidebar.drawerHead, 'none', 'Drawer header must stay hidden on desktop');
    assert.equal(sidebar.docOverflow, false, 'Desktop sidebar must not cause horizontal overflow');
  });

  await t.test('Home stays the active sidebar item on load', async () => {
    const state = await driver.executeScript(`
      const all = document.querySelector('.filter[data-cat="all"]');
      const others = Array.from(document.querySelectorAll('.filter[data-cat]')).filter(b => b.dataset.cat !== 'all');
      return {
        homePressed: all.getAttribute('aria-pressed'),
        otherPressed: others.map(b => b.getAttribute('aria-pressed')),
        homeBg: getComputedStyle(all).backgroundColor,
        idleBg: getComputedStyle(others[0]).backgroundColor
      };
    `);

    assert.equal(state.homePressed, 'true', 'Home must be pressed by default');
    assert.ok(state.otherPressed.every(p => p === 'false'), 'No other category may be active on load');
    assert.notEqual(state.homeBg, state.idleBg, 'Active Home item must remain visually distinct from idle items');
  });

  await t.test('Digests navigation link is present and usable', async () => {
    const digests = await driver.executeScript(`
      const el = document.getElementById('digestsNav');
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        href: el.getAttribute('href'),
        label: el.textContent.trim(),
        visible: rect.width > 0 && rect.height > 0,
        inViewport: rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1
      };
    `);

    assert.ok(digests, '#digestsNav must exist in the sidebar');
    assert.equal(digests.tag, 'A', 'Digests entry must be a real link');
    assert.match(digests.href, /digests\.html$/, 'Digests link must point at digests.html');
    assert.match(digests.label, /Digests/i, 'Digests link must be labelled');
    assert.ok(digests.visible && digests.inViewport, 'Digests link must be visible on desktop');
  });

  await t.test('empty RECENT group is hidden instead of looking unfinished', async () => {
    await driver.executeScript(`try { localStorage.removeItem('techDashboardRecents'); } catch (e) {}`);
    await driver.refresh();
    for (let i = 0; i < 50; i++) {
      const cards = await driver.executeScript('return document.querySelectorAll("#feed .card").length;');
      if (cards > 0) break;
      await sleep(100);
    }
    await sleep(200);

    const empty = await driver.executeScript(`
      const section = document.getElementById('recentSection');
      return {
        stored: localStorage.getItem('techDashboardRecents'),
        recentItems: document.querySelectorAll('#recentArticles .recent-item').length,
        display: getComputedStyle(section).display,
        height: Math.round(section.getBoundingClientRect().height)
      };
    `);

    assert.ok(!empty.stored || empty.stored === '[]', 'Test must start with no stored recents');
    assert.equal(empty.recentItems, 0, 'No recent items should be rendered without stored data');
    assert.equal(empty.display, 'none', 'Empty RECENT group must be hidden rather than shown empty');

    // Recents must still appear once real items exist (no fake content added).
    await driver.executeScript(`
      localStorage.setItem('techDashboardRecents', JSON.stringify([
        { title: 'Sidebar regression story', url: 'https://example.com/sidebar-regression' }
      ]));
    `);
    await driver.refresh();
    for (let i = 0; i < 50; i++) {
      const cards = await driver.executeScript('return document.querySelectorAll("#feed .card").length;');
      if (cards > 0) break;
      await sleep(100);
    }
    await sleep(200);

    const populated = await driver.executeScript(`
      const section = document.getElementById('recentSection');
      return {
        recentItems: document.querySelectorAll('#recentArticles .recent-item').length,
        display: getComputedStyle(section).display,
        text: section.textContent
      };
    `);

    assert.equal(populated.recentItems, 1, 'A single stored recent must render exactly one item');
    assert.notEqual(populated.display, 'none', 'RECENT group must appear when it has content');
    assert.match(populated.text, /Sidebar regression story/, 'RECENT group must show the stored title');

    await driver.executeScript(`try { localStorage.removeItem('techDashboardRecents'); } catch (e) {}`);
    await driver.refresh();
    for (let i = 0; i < 50; i++) {
      const cards = await driver.executeScript('return document.querySelectorAll("#feed .card").length;');
      if (cards > 0) break;
      await sleep(100);
    }
    await sleep(200);
  });

  await t.test('mobile drawer starts closed and does not obscure the page', async () => {
    await driver.setWindowRect(390, 844);
    await sleep(400);

    const closed = await driver.executeScript(`
      const filters = document.getElementById('filters');
      const backdrop = document.getElementById('sidebarBackdrop');
      const toggle = document.getElementById('menuToggle');
      const search = document.getElementById('search');
      const fRect = filters.getBoundingClientRect();
      const sRect = search.getBoundingClientRect();
      const viewport = document.documentElement.clientWidth;
      return {
        open: document.body.classList.contains('sidebar-open'),
        expanded: toggle.getAttribute('aria-expanded'),
        controls: toggle.getAttribute('aria-controls'),
        toggleVisible: getComputedStyle(toggle).display !== 'none',
        visibility: getComputedStyle(filters).visibility,
        drawerRight: Math.round(fRect.right),
        backdropDisplay: getComputedStyle(backdrop).display,
        searchInsideViewport: sRect.left >= -1 && sRect.right <= viewport + 1,
        docOverflow: document.documentElement.scrollWidth > viewport,
        searchInteractive: !document.querySelector('.row2').inert
      };
    `);

    assert.equal(closed.open, false, 'Drawer must start closed');
    assert.equal(closed.expanded, 'false', 'Menu control must report collapsed state');
    assert.equal(closed.controls, 'filters', 'Menu control must reference the drawer it toggles');
    assert.ok(closed.toggleVisible, 'Menu control must be available on mobile');
    assert.equal(closed.visibility, 'hidden', 'Closed drawer must be hidden from view and focus');
    assert.ok(closed.drawerRight <= 1, `Closed drawer must sit off-screen, right edge at ${closed.drawerRight}px`);
    assert.equal(closed.backdropDisplay, 'none', 'Backdrop must not block the page while closed');
    assert.ok(closed.searchInsideViewport, 'Search must sit inside the viewport while the drawer is closed');
    assert.equal(closed.docOverflow, false, 'Mobile layout must not overflow horizontally');
    assert.ok(closed.searchInteractive, 'Search must stay interactive while the drawer is closed');
  });

  await t.test('mobile drawer opens from the menu control and covers the page with a backdrop', async () => {
    await driver.setWindowRect(390, 844);
    await sleep(300);
    await driver.executeScript(`
      if (document.body.classList.contains('sidebar-open')) document.getElementById('sidebarClose').click();
    `);
    await sleep(200);

    const toggleEl = await driver.findElement('#menuToggle');
    assert.ok(toggleEl, '#menuToggle must exist');
    await driver.click(toggleEl);
    await sleep(400);

    const open = await driver.executeScript(`
      const filters = document.getElementById('filters');
      const backdrop = document.getElementById('sidebarBackdrop');
      const fRect = filters.getBoundingClientRect();
      const bRect = backdrop.getBoundingClientRect();
      const viewport = document.documentElement.clientWidth;
      const navIds = Array.from(filters.querySelectorAll('.sidebar-item')).map(el => el.id || el.dataset.cat);
      return {
        open: document.body.classList.contains('sidebar-open'),
        expanded: document.getElementById('menuToggle').getAttribute('aria-expanded'),
        visibility: getComputedStyle(filters).visibility,
        onScreen: fRect.left >= -1 && fRect.right <= viewport + 1,
        backdropTag: backdrop.tagName,
        backdropDisplay: getComputedStyle(backdrop).display,
        backdropLabel: (backdrop.getAttribute('aria-label') || '').trim(),
        backdropCovers: bRect.width >= viewport - 1 && bRect.height >= document.documentElement.clientHeight - 1,
        mainInert: document.querySelector('main').inert,
        footerInert: document.querySelector('footer').inert,
        searchInert: document.querySelector('.row2').inert,
        navIds,
        digestsVisible: document.getElementById('digestsNav').getBoundingClientRect().width > 0,
        accountVisible: document.getElementById('syncSettingsBtn').getBoundingClientRect().width > 0,
        docOverflow: document.documentElement.scrollWidth > viewport
      };
    `);

    assert.equal(open.open, true, 'Menu control must open the drawer');
    assert.equal(open.expanded, 'true', 'Menu control must report expanded state');
    assert.equal(open.visibility, 'visible', 'Open drawer must be visible');
    assert.ok(open.onScreen, 'Open drawer must sit fully inside the viewport');
    assert.equal(open.backdropTag, 'BUTTON', 'Backdrop must be a real button');
    assert.equal(open.backdropDisplay, 'block', 'Backdrop must be shown while the drawer is open');
    assert.ok(open.backdropLabel.length > 0, 'Backdrop must carry an accessible label');
    assert.ok(open.backdropCovers, 'Backdrop must cover the page behind the drawer');
    assert.ok(open.mainInert && open.footerInert && open.searchInert, 'Page content behind the drawer must be inert while open');
    assert.ok(open.digestsVisible && open.accountVisible, 'Drawer must keep every navigation destination reachable');
    assert.ok(open.navIds.includes('digestsNav') && open.navIds.includes('syncSettingsBtn'), 'Drawer must keep all existing nav links');
    assert.equal(open.docOverflow, false, 'Open drawer must not cause horizontal page overflow');

    await driver.executeScript("document.getElementById('sidebarClose').click();");
    await sleep(300);
  });

  await t.test('drawer close button, backdrop click, and Escape all close it', async () => {
    await driver.setWindowRect(390, 844);
    await sleep(300);
    await driver.executeScript(`
      if (document.body.classList.contains('sidebar-open')) document.getElementById('sidebarClose').click();
    `);
    await sleep(200);

    const drawerState = () => driver.executeScript(`
      return {
        open: document.body.classList.contains('sidebar-open'),
        expanded: document.getElementById('menuToggle').getAttribute('aria-expanded'),
        visibility: getComputedStyle(document.getElementById('filters')).visibility,
        backdrop: getComputedStyle(document.getElementById('sidebarBackdrop')).display,
        focusId: document.activeElement ? document.activeElement.id : '',
        mainInert: document.querySelector('main').inert
      };
    `);

    // 1. Close button.
    let toggleEl = await driver.findElement('#menuToggle');
    await driver.click(toggleEl);
    await sleep(350);
    assert.equal((await drawerState()).open, true, 'Drawer must be open before the close-button check');

    const closeEl = await driver.findElement('#sidebarClose');
    assert.ok(closeEl, '#sidebarClose must exist inside the drawer');
    await driver.click(closeEl);
    await sleep(400);
    let state = await drawerState();
    assert.equal(state.open, false, 'Close button must close the drawer');
    assert.equal(state.expanded, 'false', 'Menu control must report collapsed after close button');
    assert.equal(state.visibility, 'hidden', 'Drawer must be hidden after close button');
    assert.equal(state.backdrop, 'none', 'Backdrop must be removed after close button');
    assert.equal(state.mainInert, false, 'Page content must become interactive again');
    assert.equal(state.focusId, 'menuToggle', 'Focus must return to the menu control after closing');

    // 2. Backdrop click, outside the drawer.
    toggleEl = await driver.findElement('#menuToggle');
    await driver.click(toggleEl);
    await sleep(350);
    assert.equal((await drawerState()).open, true, 'Drawer must be open before the backdrop check');

    const viewport = await driver.executeScript('return { w: window.innerWidth, h: window.innerHeight };');
    await driver.pointerClickAt(Math.round(viewport.w - 24), Math.round(viewport.h - 60));
    await sleep(400);
    state = await drawerState();
    assert.equal(state.open, false, 'Clicking the backdrop must close the drawer');
    assert.equal(state.visibility, 'hidden', 'Drawer must be hidden after a backdrop click');

    // 3. Escape.
    toggleEl = await driver.findElement('#menuToggle');
    await driver.click(toggleEl);
    await sleep(350);
    assert.equal((await drawerState()).open, true, 'Drawer must be open before the Escape check');

    await driver.pressKey(KEY_ESCAPE);
    await sleep(400);
    state = await drawerState();
    assert.equal(state.open, false, 'Escape must close the drawer');
    assert.equal(state.expanded, 'false', 'Menu control must report collapsed after Escape');
    assert.equal(state.visibility, 'hidden', 'Drawer must be hidden after Escape');
    assert.equal(state.mainInert, false, 'Page content must be interactive again after Escape');
  });

  await t.test('drawer renders correctly in both light and dark themes', async () => {
    await driver.setWindowRect(390, 844);
    await sleep(300);
    await driver.executeScript(`
      if (document.body.classList.contains('sidebar-open')) document.getElementById('sidebarClose').click();
    `);
    await sleep(200);

    const toggleEl = await driver.findElement('#menuToggle');
    await driver.click(toggleEl);
    await sleep(350);

    const readDrawer = () => driver.executeScript(`
      const filters = document.getElementById('filters');
      const close = document.getElementById('sidebarClose');
      const filtersStyle = getComputedStyle(filters);
      const closeStyle = getComputedStyle(close);
      return {
        theme: document.documentElement.getAttribute('data-theme'),
        surface: filtersStyle.backgroundColor,
        border: filtersStyle.borderRightColor,
        closeSurface: closeStyle.backgroundColor,
        closeBorder: closeStyle.borderTopColor,
        closeColor: closeStyle.color,
        shadow: filtersStyle.boxShadow
      };
    `);

    await driver.executeScript("document.documentElement.setAttribute('data-theme','light');");
    await sleep(200);
    const light = await readDrawer();

    await driver.executeScript("document.documentElement.setAttribute('data-theme','dark');");
    await sleep(200);
    const dark = await readDrawer();

    assert.equal(light.theme, 'light');
    assert.equal(dark.theme, 'dark');
    assert.notEqual(dark.surface, light.surface, 'Drawer surface must follow the theme');
    assert.notEqual(dark.border, light.border, 'Drawer border must follow the theme');
    assert.notEqual(dark.closeColor, light.closeColor, 'Drawer close control must stay legible in dark mode');
    assert.equal(dark.closeSurface, dark.surface, 'Drawer controls must reuse the theme surface');
    assert.equal(dark.closeBorder, dark.border, 'Drawer controls must reuse the theme border');
    assert.notEqual(dark.shadow, 'none', 'Open drawer must be visually distinct from the page');

    await driver.executeScript("document.documentElement.setAttribute('data-theme','light');");
    await sleep(150);
    const restored = await readDrawer();
    assert.equal(restored.surface, light.surface, 'Drawer surface must return to the light theme value');

    await driver.executeScript("document.getElementById('sidebarClose').click();");
    await sleep(300);
  });

  await t.test('drawer controls are keyboard reachable with a visible focus ring', async () => {
    await driver.setWindowRect(390, 844);
    await sleep(300);
    await driver.executeScript(`
      if (document.body.classList.contains('sidebar-open')) document.getElementById('sidebarClose').click();
    `);
    await sleep(200);

    const toggleEl = await driver.findElement('#menuToggle');
    await driver.click(toggleEl);
    await sleep(350);
    assert.equal(
      await driver.executeScript('return document.body.classList.contains("sidebar-open");'),
      true,
      'Drawer must be open before the keyboard traversal check'
    );

    const seen = [];
    let closeFocused = false;
    for (let i = 0; i < 12 && !closeFocused; i++) {
      const current = await driver.executeScript(
        'return document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : "";'
      );
      seen.push(current);
      if (current === 'sidebarClose') { closeFocused = true; break; }
      await driver.pressKey(KEY_TAB);
      await sleep(120);
    }

    assert.ok(closeFocused, `Tab must reach the drawer close control, traversal was ${JSON.stringify(seen)}`);

    const focusRing = await driver.executeScript(`
      const el = document.activeElement;
      const style = getComputedStyle(el);
      return {
        id: el.id,
        tag: el.tagName,
        focusVisible: el.matches(':focus-visible'),
        outlineWidth: parseFloat(style.outlineWidth) || 0,
        outlineStyle: style.outlineStyle
      };
    `);

    assert.equal(focusRing.tag, 'BUTTON', 'Keyboard focus must land on a real button');
    assert.ok(focusRing.focusVisible, 'Drawer control must register as keyboard-focused (:focus-visible)');
    assert.ok(
      focusRing.outlineWidth >= 1 && focusRing.outlineStyle !== 'none',
      'Keyboard-focused drawer control must show a visible focus ring'
    );

    await driver.pressKey(KEY_ESCAPE);
    await sleep(300);
    await driver.setWindowRect(1280, 900);
    await sleep(300);
  });

  await t.test('renders responsive layouts without horizontal overflow', async () => {
    // Desktop: 1280x900
    await driver.setWindowRect(1280, 900);
    await sleep(300);
    const desktopOverflow = await driver.executeScript(`
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    `);
    assert.equal(desktopOverflow, false, 'Desktop layout (1280x900) should not cause horizontal overflow');

    // Mobile: 390x844
    await driver.setWindowRect(390, 844);
    await sleep(300);
    const mobileOverflow = await driver.executeScript(`
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    `);
    assert.equal(mobileOverflow, false, 'Mobile layout (390x844) should not cause horizontal overflow');

    const mobileElements = await driver.executeScript(`
      return {
        hasStatus: !!document.getElementById('status'),
        hasFeed: !!document.getElementById('feed')
      };
    `);
    assert.ok(mobileElements.hasStatus && mobileElements.hasFeed, 'Key elements must be present in mobile view');
  });

  await t.test('verifies no fatal console or local resource errors', async () => {
    const resourceErrors = await driver.executeScript(`
      return window.performance.getEntriesByType('resource')
        .filter(r => r.name.includes('/data/') || r.name.includes('recent-items.js'))
        .filter(r => r.duration === 0 && r.transferSize === 0);
    `);
    assert.equal(resourceErrors.length, 0, `Local dashboard resources failed to load: ${JSON.stringify(resourceErrors)}`);
  });

  // --- React dashboard (public/app-react.html) ---
  //
  // This page compiles JSX in the browser via babel-standalone and loads
  // React/ReactDOM from cdnjs, so it only renders when those CDN assets are
  // reachable. If they are not, the suite skips rather than reporting a pile
  // of failures that have nothing to do with the app.
  const reactUrl = `http://127.0.0.1:${serverInfo.port}/app-react.html`;
  let reactReachable = true;
  for (const asset of [
    'https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.5/babel.min.js'
  ]) {
    try {
      const res = await fetch(asset, { method: 'GET' });
      if (!res.ok) reactReachable = false;
    } catch {
      reactReachable = false;
    }
  }

  // React mounts asynchronously (CDN scripts + babel compile + data fetches),
  // so every wait below polls for the filter bar rather than readyState.
  const waitForReactFilters = async () => {
    for (let i = 0; i < 100; i++) {
      const count = await driver.executeScript('return document.querySelectorAll(".filter").length;');
      if (count >= 5) return true;
      await sleep(100);
    }
    return false;
  };

  // Switch themes through the real UI. Writing data-theme directly would
  // desync it from React's lightMode state, leaving .wrap.light-mode stale.
  const clickThemeToggle = async () => {
    await driver.executeScript('document.querySelector(".theme-toggle").click();');
    await sleep(400);
  };

  if (!reactReachable) {
    await t.test('React dashboard requires reachable CDN assets', () => {
      t.skip('Skipping app-react.html coverage: React/ReactDOM/babel-standalone could not be fetched from cdnjs.cloudflare.com');
    });
    return;
  }

  await t.test('React dashboard loads and renders its category filters', async () => {
    await driver.navigate(reactUrl);

    const mounted = await waitForReactFilters();
    assert.ok(mounted, 'app-react.html did not render 5 category .filter buttons within timeout');

    const labels = await driver.executeScript(`
      return Array.from(document.querySelectorAll('.controls .filter'))
        .map(b => b.textContent.trim());
    `);
    assert.deepEqual(labels, ['All', 'News', 'AI papers', 'Reviews', 'Reddit'], `Unexpected filter labels: ${JSON.stringify(labels)}`);
  });

  await t.test('React filter buttons keep pill geometry (guards swallowed .filter rule)', async () => {
    // If the base .filter rule is ever dropped by CSS parse-error recovery,
    // buttons silently fall back to the UA default: square corners and the
    // platform's light grey. Radius is therefore the load-bearing assertion.
    const geometry = await driver.executeScript(`
      return Array.from(document.querySelectorAll('.controls .filter')).map(b => {
        const s = getComputedStyle(b);
        return { label: b.textContent.trim(), radius: s.borderTopLeftRadius };
      });
    `);
    assert.equal(geometry.length, 5, `Expected 5 filter buttons, found ${geometry.length}`);
    for (const btn of geometry) {
      assert.equal(btn.radius, '999px', `Filter "${btn.label}" lost its pill radius (got ${btn.radius}); the base .filter rule is not being applied`);
    }
  });

  await t.test('React idle filters use dark-mode surface, text and border tokens', async () => {
    // Land in dark mode first (localStorage is shared with the main dashboard).
    const currentTheme = await driver.executeScript('return document.documentElement.getAttribute("data-theme");');
    if (currentTheme !== 'dark') {
      await clickThemeToggle();
    }

    const probe = await driver.executeScript(`
      const cs = getComputedStyle(document.documentElement);
      const token = name => cs.getPropertyValue(name).trim();
      const idle = Array.from(document.querySelectorAll('.filter'))
        .filter(b => !b.classList.contains('active'));
      const sample = idle[0];
      const s = sample ? getComputedStyle(sample) : null;
      return {
        theme: document.documentElement.getAttribute('data-theme'),
        wrapLightMode: document.querySelector('.wrap').classList.contains('light-mode'),
        idleCount: idle.length,
        tokens: {
          panelRaised: token('--panel-raised'),
          textMuted: token('--text-muted'),
          line: token('--line')
        },
        actual: s ? {
          background: s.backgroundColor,
          color: s.color,
          border: s.borderTopColor
        } : null
      };
    `);

    assert.equal(probe.theme, 'dark', `Expected dark theme, got ${probe.theme}`);
    assert.equal(probe.wrapLightMode, false, '.wrap must not carry light-mode while the theme is dark');
    assert.ok(probe.idleCount >= 4, `Expected at least 4 idle filters, found ${probe.idleCount}`);
    assert.ok(probe.actual, 'No idle filter button found to inspect');

    const hexToRgb = (hex) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex);
      if (!m) return null;
      const int = parseInt(m[1], 16);
      return `rgb(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255})`;
    };

    const expectedBg = hexToRgb(probe.tokens.panelRaised);
    const expectedColor = hexToRgb(probe.tokens.textMuted);
    const expectedBorder = hexToRgb(probe.tokens.line);

    assert.ok(expectedBg, `Could not parse --panel-raised token: ${probe.tokens.panelRaised}`);
    assert.ok(expectedColor, `Could not parse --text-muted token: ${probe.tokens.textMuted}`);
    assert.ok(expectedBorder, `Could not parse --line token: ${probe.tokens.line}`);

    assert.equal(probe.actual.background, expectedBg, 'Idle filter background must follow --panel-raised, not the browser default');
    assert.equal(probe.actual.color, expectedColor, 'Idle filter text must follow --text-muted');
    assert.equal(probe.actual.border, expectedBorder, 'Idle filter border must follow --line');
  });

  await t.test('React active filter paints its category accent', async () => {
    const readActive = () => driver.executeScript(`
      const cs = getComputedStyle(document.documentElement);
      const active = document.querySelector('.filter.active');
      if (!active) return null;
      const s = getComputedStyle(active);
      return {
        label: active.textContent.trim(),
        dot: s.getPropertyValue('--dot').trim(),
        background: s.backgroundColor,
        news: cs.getPropertyValue('--news').trim(),
        papers: cs.getPropertyValue('--papers').trim()
      };
    `);

    const clickByLabel = async (label) => {
      await driver.executeScript(`
        const btn = Array.from(document.querySelectorAll('.controls .filter'))
          .find(b => b.textContent.trim() === ${JSON.stringify(label)});
        if (btn) btn.click();
      `);
      await sleep(300);
    };

    const hexToRgb = (hex) => {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex);
      if (!m) return null;
      const int = parseInt(m[1], 16);
      return `rgb(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255})`;
    };

    await clickByLabel('News');
    let active = await readActive();
    assert.ok(active, 'No .filter.active element after selecting News');
    assert.equal(active.label, 'News', `Expected News to be active, got ${active.label}`);
    assert.equal(active.dot, active.news, 'Active News filter --dot must resolve to the --news accent');

    // Compare while News is still the active button; re-read after switching.
    const expectedNews = hexToRgb(active.news);
    if (expectedNews) {
      assert.equal(active.background, expectedNews, 'Active News filter background must paint the category accent');
    }

    await clickByLabel('AI papers');
    active = await readActive();
    assert.ok(active, 'No .filter.active element after selecting AI papers');
    assert.equal(active.label, 'AI papers', `Expected AI papers to be active, got ${active.label}`);
    assert.equal(active.dot, active.papers, 'Active AI papers filter --dot must resolve to the --papers accent');

    const expectedPapers = hexToRgb(active.papers);
    if (expectedPapers) {
      assert.equal(active.background, expectedPapers, 'Active AI papers filter background must paint the category accent');
    }
  });

  await t.test('React "All" filter carries a valid accent', async () => {
    // CAT_COLOR previously had no "all" key, so React dropped the inline
    // --dot and the button fell through to the var(--dot, var(--news))
    // default. An empty --dot is the regression signal.
    await driver.executeScript(`
      const btn = Array.from(document.querySelectorAll('.controls .filter'))
        .find(b => b.textContent.trim() === 'All');
      if (btn) btn.click();
    `);
    await sleep(300);

    const all = await driver.executeScript(`
      const active = document.querySelector('.filter.active');
      if (!active) return null;
      const s = getComputedStyle(active);
      return {
        label: active.textContent.trim(),
        inlineStyle: active.getAttribute('style') || '',
        dot: s.getPropertyValue('--dot').trim(),
        background: s.backgroundColor
      };
    `);

    assert.ok(all, 'No .filter.active element after selecting All');
    assert.equal(all.label, 'All', `Expected All to be active, got ${all.label}`);
    assert.ok(all.dot.length > 0, 'Active All filter has no --dot; CAT_COLOR is missing the "all" key');
    assert.ok(all.inlineStyle.includes('--dot'), 'Active All filter is missing the inline --dot declaration');
  });

  await t.test('React filters remain usable after switching back to light mode', async () => {
    await clickThemeToggle();

    const light = await driver.executeScript(`
      const cs = getComputedStyle(document.documentElement);
      const idle = Array.from(document.querySelectorAll('.filter'))
        .filter(b => !b.classList.contains('active'));
      const sample = idle[0];
      const s = sample ? getComputedStyle(sample) : null;
      return {
        theme: document.documentElement.getAttribute('data-theme'),
        wrapLightMode: document.querySelector('.wrap').classList.contains('light-mode'),
        wrapBackground: getComputedStyle(document.querySelector('.wrap')).backgroundColor,
        panelRaised: cs.getPropertyValue('--panel-raised').trim(),
        idleCount: idle.length,
        actualBackground: s ? s.backgroundColor : null,
        radius: s ? s.borderTopLeftRadius : null
      };
    `);

    assert.equal(light.theme, 'light', `Expected light theme after toggling back, got ${light.theme}`);
    assert.equal(light.wrapLightMode, true, '.wrap must carry light-mode while the theme is light');
    assert.ok(light.idleCount >= 4, `Expected at least 4 idle filters in light mode, found ${light.idleCount}`);

    const m = /^#?([0-9a-f]{6})$/i.exec(light.panelRaised);
    assert.ok(m, `Could not parse --panel-raised token: ${light.panelRaised}`);
    const int = parseInt(m[1], 16);
    const expectedBg = `rgb(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255})`;

    assert.equal(light.actualBackground, expectedBg, 'Idle filter background in light mode must follow the light --panel-raised token');
    assert.equal(light.radius, '999px', 'Filter pills must keep their geometry in light mode');
  });

  await t.test('React dashboard reports no local resource failures', async () => {
    const failures = await driver.executeScript(`
      return Array.from(document.querySelectorAll('.grid .card')).length;
    `);
    assert.ok(failures > 0, 'React dashboard rendered no cards; its local data fetches may have failed');

    const localFailures = await driver.executeScript(`
      return window.performance.getEntriesByType('resource')
        .filter(r => r.name.includes('/data/'))
        .filter(r => r.duration === 0 && r.transferSize === 0)
        .map(r => r.name);
    `);
    assert.equal(localFailures.length, 0, `React dashboard data fetches failed: ${JSON.stringify(localFailures)}`);

    const reactPresent = await driver.executeScript('return typeof window.React !== "undefined" && typeof window.ReactDOM !== "undefined";');
    assert.equal(reactPresent, true, 'React/ReactDOM globals missing; CDN assets did not load');
  });
});
