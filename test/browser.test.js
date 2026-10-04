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
