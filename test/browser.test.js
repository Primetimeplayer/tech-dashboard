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

// Wall-clock budget for the whole suite (the subtests carry no individual
// timeouts). It was 60s, which the suite already spent almost entirely before
// the mobile-viewport regressions were added; 180s keeps headroom for slower
// machines without skipping or shortening any test.
test('browser regression suite (headless Firefox + direct WebDriver)', { timeout: 180000 }, async (t) => {
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

  // Puts every filter control back to its on-load state so each filter test
  // starts from a known, unfiltered baseline.
  const RESET_FILTERS_SCRIPT = `
    const applySelect = (id, value) => {
      const el = document.getElementById(id);
      if (el.value !== value) {
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    };
    document.querySelector('.filter[data-cat="all"]').click();
    applySelect('sourceFilter', 'all');
    applySelect('dateFilter', 'all');
    if (document.getElementById('hwToggle').getAttribute('aria-pressed') === 'true') document.getElementById('hwToggle').click();
    if (document.getElementById('savedToggle').getAttribute('aria-pressed') === 'true') document.getElementById('savedToggle').click();
    const searchBox = document.getElementById('search');
    if (searchBox.value) {
      searchBox.value = '';
      searchBox.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  `;

  const pickSource = `
    const sel = document.getElementById('sourceFilter');
    return Array.from(sel.options).map(o => o.value).find(v => v !== 'all');
  `;

  await t.test('source and time-range filters narrow the feed and Clear filters restores it', async () => {
    await driver.setWindowRect(1280, 900);
    await driver.executeScript(RESET_FILTERS_SCRIPT);
    await sleep(250);

    const controls = await driver.executeScript(`
      return {
        sourceDisplay: getComputedStyle(document.getElementById('sourceFilter')).display,
        dateDisplay: getComputedStyle(document.getElementById('dateFilter')).display,
        sourceOptions: document.getElementById('sourceFilter').options.length,
        dateOptions: Array.from(document.getElementById('dateFilter').options).map(o => o.value),
        clearHidden: document.getElementById('clearFilters').hidden,
        baseline: document.querySelectorAll('#feed .card').length
      };
    `);

    assert.notEqual(controls.sourceDisplay, 'none', 'Source filter must be visible to the user');
    assert.notEqual(controls.dateDisplay, 'none', 'Time-range filter must be visible to the user');
    assert.ok(controls.sourceOptions > 1, `Source filter must be populated, found ${controls.sourceOptions} options`);
    assert.deepEqual(controls.dateOptions, ['all', 'today', 'week'], 'Time range must offer any time / today / this week');
    assert.equal(controls.clearHidden, true, 'Clear filters must stay hidden while nothing is filtered');
    assert.ok(controls.baseline > 0, 'Feed must render cards before filtering');

    const narrowedSource = await driver.executeScript(pickSource);
    const narrowed = await driver.executeScript(`
      const source = arguments[0];
      const sel = document.getElementById('sourceFilter');
      sel.value = source;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return new Promise(resolve => setTimeout(() => resolve({
        source,
        clearHidden: document.getElementById('clearFilters').hidden,
        count: document.querySelectorAll('#feed .card').length,
        allMatch: Array.from(document.querySelectorAll('#feed .card .card-meta'))
          .every(meta => meta.textContent.includes(source))
      }), 150));
    `, [narrowedSource]);

    assert.equal(narrowed.clearHidden, false, 'Clear filters must appear once a source filter is active');
    assert.ok(narrowed.count > 0, 'A source chosen from the data must still have results');
    assert.ok(narrowed.count <= controls.baseline, 'Source filtering must not add cards');
    assert.equal(narrowed.allMatch, true, 'Every rendered card must belong to the selected source');

    const timeRange = await driver.executeScript(`
      const sel = document.getElementById('dateFilter');
      const read = value => new Promise(resolve => {
        sel.value = value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        setTimeout(() => resolve({
          value,
          cards: document.querySelectorAll('#feed .card').length,
          empty: !!document.querySelector('#feed .empty')
        }), 150);
      });
      return (async () => [await read('today'), await read('week'), await read('all')])();
    `);

    assert.ok(timeRange[0].cards <= timeRange[1].cards, 'Today must be a subset of this week');
    assert.ok(timeRange[1].cards <= timeRange[2].cards, 'This week must be a subset of any time');
    assert.equal(timeRange[2].empty, false, 'The unfiltered time range must not show the empty state');

    // Narrow again, then reset through the visible control.
    await driver.executeScript(`
      const source = arguments[0];
      const sel = document.getElementById('sourceFilter');
      sel.value = source;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    `, [await driver.executeScript(pickSource)]);
    await sleep(200);

    const clearEl = await driver.findElement('#clearFilters');
    await driver.click(clearEl);
    await sleep(300);

    const restored = await driver.executeScript(`
      return {
        clearHidden: document.getElementById('clearFilters').hidden,
        source: document.getElementById('sourceFilter').value,
        date: document.getElementById('dateFilter').value,
        cards: document.querySelectorAll('#feed .card').length,
        allPressed: document.querySelector('.filter[data-cat="all"]').getAttribute('aria-pressed'),
        hwPressed: document.getElementById('hwToggle').getAttribute('aria-pressed'),
        savedPressed: document.getElementById('savedToggle').getAttribute('aria-pressed')
      };
    `);

    assert.equal(restored.clearHidden, true, 'Clear filters must hide itself once nothing is filtered');
    assert.equal(restored.source, 'all', 'Reset must restore the source filter');
    assert.equal(restored.date, 'all', 'Reset must restore the time-range filter');
    assert.equal(restored.allPressed, 'true', 'Reset must restore the active category');
    assert.equal(restored.hwPressed, 'false', 'Reset must clear the Hardware toggle');
    assert.equal(restored.savedPressed, 'false', 'Reset must clear the Saved toggle');
    assert.equal(restored.cards, controls.baseline, 'Reset must restore the original card count');
  });

  await t.test('a filter combination with no matches falls back to the existing empty state', async () => {
    await driver.setWindowRect(1280, 900);
    await driver.executeScript(RESET_FILTERS_SCRIPT);
    await sleep(250);

    const emptySource = await driver.executeScript(pickSource);
    const empty = await driver.executeScript(`
      const sel = document.getElementById('sourceFilter');
      sel.value = arguments[0];
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const searchBox = document.getElementById('search');
      searchBox.value = 'zzzz-no-headline-can-ever-match-this-zzzz';
      searchBox.dispatchEvent(new Event('input', { bubbles: true }));
      return new Promise(resolve => setTimeout(() => {
        const msg = document.querySelector('#feed .empty');
        resolve({
          cards: document.querySelectorAll('#feed .card').length,
          message: msg ? msg.textContent.trim() : '',
          messageVisible: msg ? getComputedStyle(msg).display !== 'none' : false,
          clearHidden: document.getElementById('clearFilters').hidden,
          count: document.getElementById('resultCount').textContent
        });
      }, 400));
    `, [emptySource]);

    assert.equal(empty.cards, 0, 'No cards may render when nothing matches');
    assert.match(empty.message, /Nothing matches/i, 'Zero results must reuse the existing empty state');
    assert.equal(empty.messageVisible, true, 'The empty state must actually be shown');
    assert.equal(empty.clearHidden, false, 'Clear filters must be offered when a filter yields nothing');
    assert.match(empty.count, /^0 of /, 'Result count must report zero matches');

    const clearEl = await driver.findElement('#clearFilters');
    await driver.click(clearEl);
    await sleep(300);

    const restored = await driver.executeScript(`
      return {
        cards: document.querySelectorAll('#feed .card').length,
        empty: !!document.querySelector('#feed .empty'),
        search: document.getElementById('search').value,
        clearHidden: document.getElementById('clearFilters').hidden
      };
    `);

    assert.ok(restored.cards > 0, 'Clearing the filters must bring the feed back');
    assert.equal(restored.empty, false, 'The empty state must go away once results exist');
    assert.equal(restored.search, '', 'Clear filters must also clear the search box');
    assert.equal(restored.clearHidden, true, 'Clear filters must hide itself after resetting');
  });

  await t.test('save toggle exposes its pressed state and confirms the change immediately', async () => {
    await driver.setWindowRect(1280, 900);
    await driver.executeScript(RESET_FILTERS_SCRIPT);
    await sleep(250);

    const before = await driver.executeScript(`
      const btn = document.querySelector('#feed .save-btn');
      if (!btn) return null;
      const cs = getComputedStyle(btn);
      return {
        link: btn.dataset.link,
        pressed: btn.getAttribute('aria-pressed'),
        label: btn.textContent.trim(),
        color: cs.color,
        background: cs.backgroundColor
      };
    `);
    assert.ok(before, 'Feed must render a save button');
    assert.equal(before.pressed, 'false', 'An unsaved card must report aria-pressed="false"');
    assert.match(before.label, /Save/, 'Unsaved card must show the Save label');

    await driver.executeScript(`document.querySelector('#feed .save-btn').click();`);
    await sleep(120);

    const after = await driver.executeScript(`
      const link = arguments[0];
      const btn = Array.from(document.querySelectorAll('#feed .save-btn')).find(b => b.dataset.link === link);
      if (!btn) return null;
      const cs = getComputedStyle(btn);
      return {
        pressed: btn.getAttribute('aria-pressed'),
        label: btn.textContent.trim(),
        active: btn.classList.contains('active'),
        pulsing: btn.classList.contains('save-pulse'),
        color: cs.color,
        background: cs.backgroundColor
      };
    `, [before.link]);

    assert.ok(after, 'The card must still render its save button after toggling');
    assert.equal(after.pressed, 'true', 'Saving must flip aria-pressed to "true"');
    assert.match(after.label, /Saved/, 'Saving must update the label');
    assert.equal(after.active, true, 'Saving must apply the active visual state');
    assert.equal(after.pulsing, true, 'Saving must play the one-shot confirmation animation');
    assert.notEqual(after.color, before.color, 'Active save state must change the button colour');
    assert.notEqual(after.background, before.background, 'Active save state must change the button surface');

    // Put the saved item back so later tests start from a clean library.
    await driver.executeScript(`
      const link = arguments[0];
      const btn = Array.from(document.querySelectorAll('#feed .save-btn')).find(b => b.dataset.link === link);
      if (btn) btn.click();
    `, [before.link]);
    await sleep(150);

    const restored = await driver.executeScript(`
      const link = arguments[0];
      const btn = Array.from(document.querySelectorAll('#feed .save-btn')).find(b => b.dataset.link === link);
      return btn ? btn.getAttribute('aria-pressed') : null;
    `, [before.link]);
    assert.equal(restored, 'false', 'Un-saving must return aria-pressed to "false"');
  });

  await t.test('share reports the copy result through a self-clearing status message', async () => {
    await driver.setWindowRect(1280, 900);
    await driver.executeScript(RESET_FILTERS_SCRIPT);
    await sleep(250);

    const hasShare = await driver.executeScript(`return !!document.querySelector('#feed .share-btn');`);
    assert.equal(hasShare, true, 'Feed must render a share button');

    await driver.executeScript(`document.querySelector('#feed .share-btn').click();`);
    await sleep(300);

    const feedback = await driver.executeScript(`
      const fb = document.querySelector('#feed .share-feedback');
      if (!fb) return null;
      const btn = fb.previousElementSibling;
      return {
        role: fb.getAttribute('role'),
        live: fb.getAttribute('aria-live'),
        atomic: fb.getAttribute('aria-atomic'),
        message: fb.textContent.trim(),
        parentIsActions: fb.parentElement.classList.contains('card-actions'),
        buttonLabel: btn ? btn.textContent.trim() : ''
      };
    `);

    assert.ok(feedback, 'Sharing must surface immediate feedback');
    assert.equal(feedback.role, 'status', 'Share feedback must be announced as a status message');
    assert.equal(feedback.live, 'polite', 'Share feedback must use a polite live region');
    assert.equal(feedback.parentIsActions, true, 'Share feedback must sit next to the button that triggered it');
    assert.match(
      feedback.message,
      /^(Link copied\. Share it anywhere\.|Copy failed\. Select the link and copy it manually\.)$/,
      `Share feedback must state the actual outcome, saw "${feedback.message}"`
    );
    assert.notEqual(feedback.buttonLabel, '', 'The share button must keep a readable label');

    await sleep(1400);
    const cleared = await driver.executeScript(`return document.querySelectorAll('#feed .share-feedback').length;`);
    assert.equal(cleared, 0, 'Share feedback must clear itself instead of lingering');
  });

  await t.test('slash shortcut skips editable surfaces but still focuses search', async () => {
    await driver.setWindowRect(1280, 900);

    const result = await driver.executeScript(`
      const searchBox = document.getElementById('search');
      if (document.activeElement === searchBox) searchBox.blur();

      const fire = el => el.dispatchEvent(new KeyboardEvent('keydown', {
        key: '/', bubbles: true, cancelable: true
      }));

      const textarea = document.createElement('textarea');
      textarea.id = 'slashTextareaProbe';
      document.body.appendChild(textarea);
      textarea.focus();
      fire(textarea);
      const afterTextarea = document.activeElement.id;

      const editable = document.createElement('div');
      editable.id = 'slashEditableProbe';
      editable.setAttribute('contenteditable', 'true');
      document.body.appendChild(editable);
      editable.focus();
      fire(editable);
      const afterEditable = document.activeElement.id;

      const select = document.getElementById('sourceFilter');
      select.focus();
      fire(select);
      const afterSelect = document.activeElement.id;

      if (document.activeElement === searchBox) searchBox.blur();
      const neutral = document.body;
      fire(neutral);
      const afterNeutral = document.activeElement.id;

      textarea.remove();
      editable.remove();
      if (document.activeElement === searchBox) searchBox.blur();
      return { afterTextarea, afterEditable, afterSelect, afterNeutral };
    `);

    assert.equal(result.afterTextarea, 'slashTextareaProbe', 'A focused textarea must keep focus when / is pressed');
    assert.equal(result.afterEditable, 'slashEditableProbe', 'A contenteditable region must keep focus when / is pressed');
    assert.equal(result.afterSelect, 'sourceFilter', 'A focused select must keep focus when / is pressed');
    assert.equal(result.afterNeutral, 'search', 'A neutral page must still focus the search box on /');
  });

  await t.test('search and filter controls show a strong focus ring in both themes', async () => {
    await driver.setWindowRect(1280, 900);
    await driver.executeScript(RESET_FILTERS_SCRIPT);
    await sleep(250);

    const originalTheme = await driver.executeScript(`
      return document.documentElement.getAttribute('data-theme');
    `);
    const themes = [originalTheme, originalTheme === 'light' ? 'dark' : 'light'];
    const report = [];

    const probeFocus = async () => await driver.executeScript(`
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      return {
        id: el.id,
        tag: el.tagName,
        focusVisible: el.matches(':focus-visible'),
        width: parseFloat(cs.outlineWidth) || 0,
        style: cs.outlineStyle,
        color: cs.outlineColor
      };
    `);

    for (const theme of themes) {
      await driver.executeScript(`document.documentElement.setAttribute('data-theme', arguments[0]);`, [theme]);

      const searchEl = await driver.findElement('#search');
      await driver.sendKeys(searchEl, '');
      await sleep(60);
      // The search paints its ring on the whole rounded field, not on the
      // bare <input> inside it, so measure the container while confirming
      // the input itself draws no outline.
      const searchFocus = await driver.executeScript(`
        const input = document.getElementById('search');
        const box = input.closest('.search-row');
        const boxStyle = getComputedStyle(box);
        const inputStyle = getComputedStyle(input);
        return {
          id: box.className,
          tag: box.tagName,
          focusVisible: input.matches(':focus-visible'),
          width: parseFloat(boxStyle.outlineWidth) || 0,
          style: boxStyle.outlineStyle,
          color: boxStyle.outlineColor,
          inputWidth: parseFloat(inputStyle.outlineWidth) || 0,
          inputStyle: inputStyle.outlineStyle
        };
      `);

      // The hidden filter selects are deliberately out of the tab order
      // (tabindex="-1"), so keyboard traversal no longer lands on them. Nudge
      // the keyboard first — a scripted focus() only matches :focus-visible
      // when the last real input was a keypress — then focus the select
      // directly and read its ring.
      await driver.performActions([{
        type: 'key',
        id: 'keyboard',
        actions: [
          { type: 'keyDown', value: String.fromCharCode(0xe008) }, // Shift
          { type: 'keyUp', value: String.fromCharCode(0xe008) }
        ]
      }]);
      await sleep(60);
      await driver.executeScript('document.getElementById("sourceFilter").focus();');
      await sleep(60);
      const selectFocus = await probeFocus();

      report.push({ theme, searchFocus, selectFocus });
    }

    await driver.executeScript(`
      document.documentElement.setAttribute('data-theme', arguments[0]);
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    `, [originalTheme]);

    for (const entry of report) {
      const { theme, searchFocus, selectFocus } = entry;
      assert.equal(searchFocus.focusVisible, true, `Search must be :focus-visible in ${theme} theme`);
      assert.ok(
        searchFocus.width >= 2 && searchFocus.style !== 'none',
        `The rounded search field must show a solid focus ring of at least 2px in ${theme} theme (got ${searchFocus.width}px ${searchFocus.style})`
      );
      assert.ok(
        searchFocus.inputStyle === 'none' || searchFocus.inputWidth === 0,
        `The inner search input must not draw its own square outline in ${theme} theme (got ${searchFocus.inputWidth}px ${searchFocus.inputStyle})`
      );
      assert.ok(selectFocus, `A filter select must be present to measure its focus ring in ${theme} theme`);
      assert.equal(selectFocus.focusVisible, true, `Filter select must be :focus-visible in ${theme} theme`);
      assert.ok(
        selectFocus.width >= 2 && selectFocus.style !== 'none',
        `Filter select focus ring must be solid and at least 2px in ${theme} theme (got ${selectFocus.width}px ${selectFocus.style})`
      );
    }
  });

  // Shared browser-side helpers for the accessibility subtests below.
  // resolveBg() walks up the DOM compositing semi-transparent layers, so the
  // measured ratio is against the surface the text is actually painted on,
  // not just the element's own background-color.
  const COLOR_HELPERS = `
    function lum(r, g, b) {
      const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return f(r) * 0.2126 + f(g) * 0.7152 + f(b) * 0.0722;
    }
    function parseColor(str) {
      const m = (str || '').match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/);
      if (!m) return null;
      return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
    }
    function contrastOf(fg, bg) {
      if (!fg || !bg) return null;
      const a = lum(fg.r, fg.g, fg.b), b = lum(bg.r, bg.g, bg.b);
      return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
    }
    function resolveBg(el, d) {
      d = d || 0;
      if (!el || d > 30) return { r: 255, g: 255, b: 255, a: 1 };
      const bg = parseColor(getComputedStyle(el).backgroundColor);
      if (!bg) return resolveBg(el.parentElement, d + 1);
      if (bg.a >= 0.999) return bg;
      if (bg.a <= 0.001) return resolveBg(el.parentElement, d + 1);
      const p = resolveBg(el.parentElement, d + 1);
      return {
        r: Math.round(bg.r * bg.a + p.r * (1 - bg.a)),
        g: Math.round(bg.g * bg.a + p.g * (1 - bg.a)),
        b: Math.round(bg.b * bg.a + p.b * (1 - bg.a)),
        a: 1
      };
    }
    function probeText(sel) {
      const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
      if (!el) return null;
      const cs = getComputedStyle(el);
      const bg = resolveBg(el);
      return { fg: cs.color, bg: 'rgb(' + bg.r + ', ' + bg.g + ', ' + bg.b + ')', ratio: contrastOf(parseColor(cs.color), bg) };
    }
    function probeBorder(sel) {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const fg = parseColor(cs.borderTopColor);
      const own = resolveBg(el);
      const outside = resolveBg(el.parentElement);
      return {
        border: cs.borderTopColor,
        own: contrastOf(fg, own),
        outside: contrastOf(fg, outside),
        width: parseFloat(cs.borderTopWidth) || 0
      };
    }
  `;

  // A programmatic focus() only lands :focus-visible when the last real input
  // was a keypress, so the focus subtest nudges the keyboard first.
  const KEYBOARD_NUDGE = [
    { type: 'key', id: 'keyboard', actions: [
      { type: 'keyDown', value: String.fromCharCode(0xe008) },
      { type: 'keyUp', value: String.fromCharCode(0xe008) }
    ] }
  ];

  await t.test('main feed renders visibly instead of the loading skeleton', async () => {
    await driver.setWindowRect(1280, 900);
    await driver.executeScript(RESET_FILTERS_SCRIPT);
    await sleep(300);

    const readState = await driver.executeScript(`
      const feed = document.getElementById('feed');
      const skel = document.getElementById('skeleton');
      const card = document.querySelector('#feed .card');
      const fr = feed.getBoundingClientRect();
      const cr = card ? card.getBoundingClientRect() : { width: 0, height: 0 };
      return {
        cards: document.querySelectorAll('#feed .card').length,
        feedDisplay: getComputedStyle(feed).display,
        feedHeight: Math.round(fr.height),
        skeletonDisplay: getComputedStyle(skel).display,
        cardW: Math.round(cr.width),
        cardH: Math.round(cr.height)
      };
    `);

    assert.ok(readState.cards > 0, 'Feed must render cards once the data has loaded');
    assert.notEqual(readState.feedDisplay, 'none', 'The feed must be visible after load, not left on display:none');
    assert.ok(readState.feedHeight > 0, `The feed must occupy page height (got ${readState.feedHeight}px)`);
    assert.equal(readState.skeletonDisplay, 'none', 'The loading skeleton must be hidden once cards are rendered');
    assert.ok(readState.cardW > 0 && readState.cardH > 0, 'Cards must have a real box so they can be seen and focused');

    await driver.executeScript(`document.querySelector('.filter[data-cat="papers"]').click();`);
    await sleep(300);

    const afterFilter = await driver.executeScript(`
      const feed = document.getElementById('feed');
      const skel = document.getElementById('skeleton');
      return {
        cards: document.querySelectorAll('#feed .card').length,
        feedDisplay: getComputedStyle(feed).display,
        skeletonDisplay: getComputedStyle(skel).display
      };
    `);

    assert.ok(afterFilter.cards > 0, 'Filtering to a category must still render cards');
    assert.notEqual(afterFilter.feedDisplay, 'none', 'Re-rendering must not leave the feed hidden');
    assert.equal(afterFilter.skeletonDisplay, 'none', 'Re-rendering must not bring the skeleton back');

    await driver.executeScript(RESET_FILTERS_SCRIPT);
    await sleep(200);
  });

  await t.test('themed text meets WCAG AA contrast in light and dark modes', async () => {
    await driver.setWindowRect(1280, 900);
    await driver.executeScript(RESET_FILTERS_SCRIPT);
    await sleep(300);

    const originalTheme = await driver.executeScript("return document.documentElement.getAttribute('data-theme');");

    const probe = async (theme) => {
      await driver.executeScript("document.documentElement.setAttribute('data-theme', arguments[0]);", [theme]);
      await sleep(200);
      return await driver.executeScript(COLOR_HELPERS + `
        // Reddit has no items in the sample data, so inject a hidden probe
        // card: a category accent nobody can currently see must still be
        // compliant before Reddit data returns.
        const injected = document.createElement('article');
        injected.className = 'card reddit';
        injected.style.display = 'none';
        injected.innerHTML = '<div class="card-meta"><span class="cat-label">Probe</span></div>';
        document.body.appendChild(injected);
        const redditLabel = probeText('.card.reddit .cat-label');
        injected.remove();

        return {
          theme: document.documentElement.getAttribute('data-theme'),
          cardMeta: probeText('#feed .card-meta'),
          metaSeparator: probeText('#feed .card-meta > span:nth-child(2)'),
          metaTime: probeText('#feed .card-meta > span:last-child'),
          metaThird: probeText('#feed .card-meta > span:nth-child(3)'),
          catNews: probeText('#feed .card.news .cat-label'),
          catPapers: probeText('#feed .card.papers .cat-label'),
          catReviews: probeText('#feed .card.reviews .cat-label'),
          catReddit: redditLabel,
          resultCount: probeText('#resultCount'),
          status: probeText('#status'),
          tagline: probeText('.tagline'),
          latestLabelCount: probeText('.latest-label > span'),
          footer: probeText('footer'),
          footerLink: probeText('footer a'),
          clearFilters: probeText('#clearFilters'),
          searchHint: probeText('.search-hint'),
          cardTitle: probeText('#feed .card h2 a'),
          cardSummary: probeText('#feed .card p'),
          saveBtn: probeText('#feed .save-btn'),
          shareBtn: probeText('#feed .share-btn'),
          sidebarItem: probeText('.sidebar-item'),
          sidebarHeading: probeText('.sidebar-heading'),
          chip: probeText('#feed .chip'),
          hwBadge: probeText('#feed .hw-badge'),
          latestCat: probeText('.latest-card .cat'),
          latestTitle: probeText('.latest-card h3')
        };
      `);
    };

    for (const theme of ['light', 'dark']) {
      const report = await probe(theme);
      assert.equal(report.theme, theme);
      for (const [name, entry] of Object.entries(report)) {
        if (name === 'theme' || !entry) continue;
        assert.notEqual(entry.ratio, null, `${name} (${theme}): could not compute a ratio for ${entry.fg}`);
        assert.ok(
          entry.ratio >= 4.5,
          `${name} (${theme}): contrast ${entry.ratio}:1 — ${entry.fg} on ${entry.bg} must meet AA 4.5:1`
        );
      }
    }

    await driver.executeScript("document.documentElement.setAttribute('data-theme', arguments[0]);", [originalTheme]);
    await sleep(150);
  });

  await t.test('control boundaries keep 3:1 non-text contrast in both themes', async () => {
    await driver.setWindowRect(1280, 900);
    await driver.executeScript(RESET_FILTERS_SCRIPT);
    await sleep(300);

    const originalTheme = await driver.executeScript("return document.documentElement.getAttribute('data-theme');");

    const probe = async (theme) => {
      await driver.executeScript("document.documentElement.setAttribute('data-theme', arguments[0]);", [theme]);
      await sleep(200);
      return await driver.executeScript(COLOR_HELPERS + `
        return {
          theme: document.documentElement.getAttribute('data-theme'),
          sourceFilter: probeBorder('#sourceFilter'),
          dateFilter: probeBorder('#dateFilter'),
          searchRow: probeBorder('.row2 .search-row'),
          clearFilters: probeBorder('#clearFilters'),
          loadMore: probeBorder('#loadMoreBtn'),
          themeToggle: probeBorder('#themeToggle'),
          menuToggle: probeBorder('#menuToggle')
        };
      `);
    };

    for (const theme of ['light', 'dark']) {
      const report = await probe(theme);
      assert.equal(report.theme, theme);
      for (const [name, entry] of Object.entries(report)) {
        if (name === 'theme' || !entry) continue;
        assert.ok(entry.width >= 1, `${name} (${theme}): needs a visible border (got ${entry.width}px ${entry.border})`);
        const weakest = Math.min(entry.own, entry.outside);
        assert.ok(
          weakest >= 3,
          `${name} (${theme}): border ${entry.border} is only ${weakest}:1 against its own surface (${entry.own}:1) or the page around it (${entry.outside}:1); control boundaries need 3:1`
        );
      }
    }

    await driver.executeScript("document.documentElement.setAttribute('data-theme', arguments[0]);", [originalTheme]);
    await sleep(150);
  });

  await t.test('every interactive control shows a keyboard focus ring in both themes', async () => {
    await driver.setWindowRect(1280, 900);
    await driver.executeScript(RESET_FILTERS_SCRIPT);
    await sleep(300);

    const originalTheme = await driver.executeScript("return document.documentElement.getAttribute('data-theme');");

    // The controls the page actually shows: toolbar, sidebar, masthead,
    // article cards, carousel arrows, and the "clear filters" pill (which only
    // exists while something is filtered).
    const DESKTOP_CONTROLS = [
      '#search',
      '.controls select',
      '.row2 select',
      '#clearFilters',
      '.theme-toggle',
      '#loadMoreBtn',
      '.filter',
      '.sidebar-item',
      '.mast-right a',
      '.latest-nav-btn:not([disabled])',
      '#feed .card h2 a',
      '#feed .save-btn',
      '#feed .share-btn'
    ];

    const probeControls = async (selectors) => {
      await driver.performActions(KEYBOARD_NUDGE);
      await sleep(80);
      return await driver.executeScript(`
        const selectors = arguments[0];
        const out = [];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (!el) { out.push({ sel, present: false }); continue; }
          const wasHidden = el.hidden === true;
          if (wasHidden) el.hidden = false;
          const restoreDisplay = getComputedStyle(el).display;
          if (restoreDisplay === 'none') { el.style.display = 'inline-block'; }
          // The search field paints its ring on the rounded container rather
          // than the bare input, so read the ring from the container while
          // still focusing the input that receives keyboard focus.
          const ringEl = el.id === 'search' ? el.closest('.search-row') : el;
          el.focus();
          const cs = getComputedStyle(ringEl);
          out.push({
            sel,
            present: true,
            active: document.activeElement === el,
            focusVisible: el.matches(':focus-visible'),
            width: parseFloat(cs.outlineWidth) || 0,
            style: cs.outlineStyle
          });
          el.blur();
          if (wasHidden) el.hidden = true;
          if (el.style.display) el.style.removeProperty('display');
        }
        return out;
      `, [selectors]);
    };

    const assertRings = (results, theme, label) => {
      assert.ok(results.length > 0, `${label}: nothing probed`);
      for (const result of results) {
        if (!result.present) continue;
        assert.ok(result.active, `${label} (${theme}): ${result.sel} must receive keyboard focus`);
        assert.equal(result.focusVisible, true, `${label} (${theme}): ${result.sel} must match :focus-visible`);
        assert.ok(
          result.style !== 'none' && result.width >= 2,
          `${label} (${theme}): ${result.sel} focus ring must be solid and at least 2px (got ${result.width}px ${result.style})`
        );
      }
    };

    for (const theme of ['light', 'dark']) {
      await driver.executeScript("document.documentElement.setAttribute('data-theme', arguments[0]);", [theme]);
      await sleep(200);
      const results = await probeControls(DESKTOP_CONTROLS);
      assertRings(results, theme, 'desktop controls');
    }

    // Mobile-only controls: the menu toggle, and the drawer close button that
    // only exists once the navigation drawer is open.
    await driver.setWindowRect(390, 844);
    await sleep(300);
    await driver.performActions(KEYBOARD_NUDGE);

    const menuRing = await probeControls(['#menuToggle']);
    assertRings(menuRing, 'dark', 'mobile menu toggle');

    const menuToggleEl = await driver.findElement('#menuToggle');
    assert.ok(menuToggleEl, '#menuToggle must exist on mobile');
    await driver.click(menuToggleEl);
    await sleep(350);

    // The drawer was opened with a pointer click, so the browser is in "mouse"
    // modality and a scripted focus() would not match :focus-visible. Walk the
    // real Tab order instead — that is how a keyboard user reaches this button
    // and it is the state the ring has to hold up in.
    let closeRing = null;
    for (let i = 0; i < 12 && !closeRing; i++) {
      await driver.performActions([
        { type: 'key', id: 'keyboard', actions: [
          { type: 'keyDown', value: KEY_TAB },
          { type: 'keyUp', value: KEY_TAB }
        ] }
      ]);
      await sleep(60);
      const reached = await driver.executeScript(`
        const el = document.activeElement;
        if (!el || el.id !== 'sidebarClose') return null;
        const cs = getComputedStyle(el);
        return {
          sel: '#sidebarClose',
          present: true,
          active: true,
          focusVisible: el.matches(':focus-visible'),
          width: parseFloat(cs.outlineWidth) || 0,
          style: cs.outlineStyle
        };
      `);
      if (reached) closeRing = reached;
    }
    assert.ok(closeRing, 'Keyboard focus must reach the drawer close button');
    assertRings([closeRing], 'dark', 'drawer close button');

    await driver.setWindowRect(1280, 900);
    await driver.executeScript("document.documentElement.setAttribute('data-theme', arguments[0]);", [originalTheme]);
    await driver.executeScript(RESET_FILTERS_SCRIPT);
    await sleep(200);
  });

  await t.test('theme toggle exposes its state through its accessible name', async () => {
    await driver.setWindowRect(1280, 900);
    await driver.executeScript(RESET_FILTERS_SCRIPT);
    await sleep(300);

    // Earlier subtests set data-theme directly (which skips the toggle's own
    // click handler), so the icon and its label can be a step behind the
    // attribute. Two real clicks put both back in step and land on the same
    // theme this test started in.
    for (let i = 0; i < 2; i++) {
      const syncEl = await driver.findElement('#themeToggle');
      assert.ok(syncEl, '#themeToggle must exist');
      await driver.click(syncEl);
      await sleep(300);
    }

    const readToggle = await driver.executeScript(`
      const btn = document.getElementById('themeToggle');
      const theme = document.documentElement.getAttribute('data-theme');
      const other = theme === 'light' ? 'dark' : 'light';
      return {
        theme,
        label: (btn.getAttribute('aria-label') || '').trim(),
        title: (btn.getAttribute('title') || '').trim(),
        iconHidden: !!btn.querySelector('svg[aria-hidden="true"]'),
        expected: 'Switch to ' + other + ' theme',
        hasPressed: btn.hasAttribute('aria-pressed')
      };
    `);

    assert.equal(readToggle.label, readToggle.expected, `Theme toggle in ${readToggle.theme} must name the theme it switches to`);
    assert.equal(readToggle.title, readToggle.expected, 'Theme toggle tooltip must match its accessible name');
    assert.equal(readToggle.iconHidden, true, 'The theme icon must be hidden from assistive technology');
    assert.match(readToggle.label, /^(Switch to (light|dark) theme|Toggle light and dark theme)$/,
      `Theme toggle must expose a readable state name (got "${readToggle.label}")`);

    const toggleEl = await driver.findElement('#themeToggle');
    assert.ok(toggleEl, '#themeToggle must exist');
    await driver.click(toggleEl);
    await sleep(350);

    const afterClick = await driver.executeScript(`
      const btn = document.getElementById('themeToggle');
      const theme = document.documentElement.getAttribute('data-theme');
      const other = theme === 'light' ? 'dark' : 'light';
      return { theme, label: (btn.getAttribute('aria-label') || '').trim(), expected: 'Switch to ' + other + ' theme' };
    `);

    assert.notEqual(afterClick.theme, readToggle.theme, 'Clicking the toggle must switch the theme');
    assert.equal(afterClick.label, afterClick.expected, `After switching to ${afterClick.theme} the label must name the theme it switches to`);

    const toggleAgain = await driver.findElement('#themeToggle');
    await driver.click(toggleAgain);
    await sleep(350);

    const restored = await driver.executeScript(`
      const btn = document.getElementById('themeToggle');
      return { theme: document.documentElement.getAttribute('data-theme'), label: (btn.getAttribute('aria-label') || '').trim() };
    `);
    assert.equal(restored.theme, readToggle.theme, 'Theme must be restored after the accessibility check');
    assert.equal(restored.label, readToggle.label, 'Accessible name must return to its original value');
  });

  await t.test('heading structure has one h1 and no skipped levels', async () => {
    await driver.setWindowRect(1280, 900);
    await driver.executeScript(RESET_FILTERS_SCRIPT);
    await sleep(300);

    const report = await driver.executeScript(`
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      const visible = headings.filter(h => {
        const cs = getComputedStyle(h);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
      });
      const outline = visible.map(h => ({ level: Number(h.tagName.slice(1)), text: (h.textContent || '').trim().slice(0, 60) }));
      const noscriptH1 = document.querySelectorAll('noscript h1').length;
      return { outline, noscriptH1, firstIsH1: outline.length > 0 && outline[0].level === 1 };
    `);

    assert.ok(report.outline.length > 0, 'Page must expose headings');
    assert.ok(report.firstIsH1, `The first heading on the page must be the h1 wordmark (got level ${report.outline[0] && report.outline[0].level})`);
    assert.equal(report.noscriptH1, 0,
      'A second h1 inside <noscript> would still be parsed when scripting is off; the live document must have exactly one h1');

    const h1s = report.outline.filter(h => h.level === 1);
    assert.equal(h1s.length, 1, `Exactly one visible h1 is expected (found ${h1s.length}: ${h1s.map(h => h.text).join(' | ')})`);

    for (let i = 1; i < report.outline.length; i++) {
      const jump = report.outline[i].level - report.outline[i - 1].level;
      assert.ok(
        jump <= 1,
        `Heading level jumps from h${report.outline[i - 1].level} ("${report.outline[i - 1].text}") to h${report.outline[i].level} ("${report.outline[i].text}")`
      );
    }

    const sectionNames = report.outline.filter(h => h.level === 2).map(h => h.text);
    assert.ok(sectionNames.some(t => /latest stories/i.test(t)), 'The Latest Stories section must carry an h2');
    assert.ok(sectionNames.some(t => /top stories/i.test(t)), 'The main feed section must carry an h2');
  });

  await t.test('page stays responsive with every item rendered (no virtualization needed)', async () => {
    await driver.setWindowRect(1280, 900);
    await driver.executeScript(RESET_FILTERS_SCRIPT);
    await sleep(300);

    // Measured before deciding anything: with the sample data the whole feed
    // is only 76 items, so the page renders every card directly. These bounds
    // are deliberately loose — they exist to catch a real regression (an
    // accidental full re-render per keystroke, a runaway DOM), not to encode
    // the exact numbers measured today.
    const perf = await driver.executeScript(`
      return new Promise((resolve) => {
        const feed = document.getElementById('feed');
        const cardsAtStart = feed.querySelectorAll('.card').length;

        const t0 = performance.now();
        window.scrollTo(0, 0);
        const scrollMs = performance.now() - t0;

        const docHeight = document.documentElement.scrollHeight;
        const nodes = document.getElementsByTagName('*').length;

        // Expand the entire feed so the full-height page is what gets measured.
        const expand = document.getElementById('loadMoreBtn');
        if (expand) {
          while (!expand.hidden && expand.offsetParent !== null) {
            expand.click();
            if (expand.hidden || expand.offsetParent === null) break;
          }
        }
        const allCards = feed.querySelectorAll('.card').length;
        const fullHeight = document.documentElement.scrollHeight;
        const fullNodes = document.getElementsByTagName('*').length;

        const t1 = performance.now();
        window.scrollTo(0, fullHeight);
        const scrollFullMs = performance.now() - t1;
        window.scrollTo(0, 0);

        // Restore the paginated state for the subtests that follow.
        const allBtn = document.querySelector('.filter[data-cat="all"]');
        if (allBtn) allBtn.click();

        resolve({
          cardsAtStart,
          allCards,
          docHeight,
          fullHeight,
          nodes,
          fullNodes,
          scrollMs: Math.round(scrollMs * 100) / 100,
          scrollFullMs: Math.round(scrollFullMs * 100) / 100
        });
      });
    `);

    assert.ok(perf.allCards >= perf.cardsAtStart, 'Expanding the feed must not lose cards');
    assert.ok(perf.fullHeight >= perf.docHeight, 'The fully expanded page cannot be shorter than the paginated one');
    assert.ok(perf.fullNodes >= perf.nodes, 'Expanding the feed adds DOM nodes');

    // Deliberately generous ceiling: 76 cards at roughly 300px each is well
    // under this. It only trips if the page grows an order of magnitude or a
    // scroll handler starts doing per-frame layout work.
    assert.ok(perf.fullHeight < 60000, `Fully expanded page height ${perf.fullHeight}px is far beyond the expected range; re-check whether rendering needs work`);
    assert.ok(perf.fullNodes < 6000, `Fully expanded DOM node count ${perf.fullNodes} is far beyond the expected range`);
    assert.ok(perf.scrollFullMs < 500, `Scrolling the full page took ${perf.scrollFullMs}ms; scroll handling may be doing per-frame layout work`);
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
      layout.fullyVisible >= 6 && layout.fullyVisible <= 6,
      `Expected 6 fully visible cards on desktop, measured ${layout.fullyVisible}`
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
    // The search bar now sits in the masthead beside Signal, so traversal
    // crosses the header controls and the sidebar first: 13 Tabs to reach
    // the next control (latestPrev is disabled at the scroll start, so it is
    // skipped). The keys go through key actions — element sendKeys re-focuses
    // #search on every call, which would restart traversal each time.
    const searchEl = await driver.findElement('#search');
    assert.ok(searchEl, '#search must exist to start keyboard traversal');
    await driver.sendKeys(searchEl, '');

    let focusedId = null;
    for (let i = 0; i < 13 && focusedId !== 'latestNext'; i++) {
      await driver.pressKey(KEY_TAB);
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

  await t.test('Latest strip is sized for comfortable swiping at narrow widths', async () => {
    await driver.setWindowRect(390, 844);
    await sleep(400);

    const strip = await driver.executeScript(`
      const row = document.getElementById('latestRow');
      const cards = Array.from(row.querySelectorAll('.latest-card'));
      const card = cards[0];
      const cs = getComputedStyle(row);
      const rr = row.getBoundingClientRect();
      const cr = card.getBoundingClientRect();
      return {
        cardCount: cards.length,
        cardWidth: Math.round(cr.width),
        fullyVisible: cr.left >= rr.left - 1 && cr.right <= rr.right + 1,
        snap: cs.scrollSnapType,
        overscroll: cs.overscrollBehaviorX,
        docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        scrollable: row.scrollWidth > row.clientWidth
      };
    `);

    assert.ok(strip.cardCount > 1, 'Narrow screens must keep every story card in the strip');
    assert.ok(
      strip.cardWidth >= 200,
      `Cards must be readable at 390px (found ${strip.cardWidth}px wide)`
    );
    assert.ok(strip.fullyVisible, 'The first card must be fully visible without scrolling');
    assert.match(strip.snap, /x/, 'Touch scrolling must keep scroll snapping');
    assert.equal(
      strip.overscroll,
      'contain',
      'Swiping the strip must not chain into page-level horizontal scroll'
    );
    assert.equal(strip.docOverflow, false, 'Narrow layout must not cause page-level horizontal overflow');
    assert.ok(strip.scrollable, 'Strip must remain horizontally scrollable');

    await driver.setWindowRect(1280, 900);
    await sleep(300);
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
      const thumbs = cards.map(card => {
        const img = card.querySelector('.story-thumb');
        if (!img) return null;
        const cs = getComputedStyle(img);
        const box = img.getBoundingClientRect();
        const copy = card.querySelector('.story-copy');
        const copyBox = copy ? copy.getBoundingClientRect() : null;
        return {
          src: img.getAttribute('src') || '',
          width: Math.round(box.width),
          height: Math.round(box.height),
          fit: cs.objectFit,
          radius: cs.borderRadius,
          rightOfText: !copyBox || box.left >= copyBox.right - 2
        };
      }).filter(Boolean);
      return {
        cards: cards.length,
        images: thumbs.length,
        thumbs,
        backgrounds: cards.filter(c => getComputedStyle(c).backgroundImage !== 'none').length,
        titles: cards.filter(c => c.querySelector('h2') && c.querySelector('h2').textContent.trim()).length,
        heights: cards.slice(0, 6).map(c => Math.round(c.getBoundingClientRect().height))
      };
    `);

    assert.ok(media.cards > 0, 'Expected cards');
    assert.ok(media.images <= media.cards, 'A card must not render more than one thumbnail');
    for (const thumb of media.thumbs) {
      assert.match(thumb.src, /^https?:\/\//, 'Thumbnail src must be an http(s) image URL');
      assert.equal(thumb.width, 96, 'Feed thumbnail must be 96px wide');
      assert.equal(thumb.height, 96, 'Feed thumbnail must be 96px tall');
      assert.equal(thumb.fit, 'cover', 'Feed thumbnail must use object-fit: cover');
      assert.equal(thumb.radius, '12px', 'Feed thumbnail must use a 12px corner radius');
      assert.equal(thumb.rightOfText, true, 'Feed thumbnail must sit to the right of the story text');
    }
    const picks = await driver.executeScript(`
      return Array.from(document.querySelectorAll('#feed .pick-card')).map(card => {
        const img = card.querySelector('.pick-thumb');
        const copy = card.querySelector('.story-copy');
        const copyBox = copy ? copy.getBoundingClientRect() : null;
        const box = img ? img.getBoundingClientRect() : null;
        const favicon = Array.from(card.querySelectorAll('.source-favicon')).find((el) => !el.hidden && getComputedStyle(el).display !== 'none');
        const faviconBox = favicon ? favicon.getBoundingClientRect() : null;
        const name = card.querySelector('.source-name');
        const time = card.querySelector('.meta-time');
        return {
          hasImg: !!img,
          src: img ? (img.getAttribute('src') || '') : '',
          width: box ? Math.round(box.width) : 0,
          height: box ? Math.round(box.height) : 0,
          fit: img ? getComputedStyle(img).objectFit : '',
          radius: img ? getComputedStyle(img).borderRadius : '',
          rightOfText: !box || !copyBox || box.left >= copyBox.right - 2,
          favicon: faviconBox ? Math.round(faviconBox.width) : 0,
          name: name ? name.textContent.trim() : '',
          nameSize: name ? parseFloat(getComputedStyle(name).fontSize) : 0,
          nameWeight: name ? getComputedStyle(name).fontWeight : '',
          time: time ? time.textContent.trim() : ''
        };
      });
    `);
    assert.ok(picks.length > 0, 'Picks for you must render compact cards');
    for (const pick of picks) {
      assert.equal(pick.favicon, 16, 'Pick cards must show a 16px publisher favicon');
      assert.ok(pick.name.length > 0, 'Pick cards must show the publisher name');
      assert.ok(pick.nameSize >= 12 && pick.nameSize <= 13, 'Pick publisher name must be 12–13px');
      assert.ok(Number(pick.nameWeight) >= 600, 'Pick publisher name must be bold');
      assert.ok(pick.time.length > 0, 'Pick cards must show a relative timestamp');
      if (!pick.hasImg) continue;
      assert.match(pick.src, /^https?:\/\//, 'Pick thumbnail src must be an http(s) image URL');
      assert.equal(pick.width, 72, 'Pick thumbnail must be 72px wide');
      assert.equal(pick.height, 72, 'Pick thumbnail must be 72px tall');
      assert.equal(pick.fit, 'cover', 'Pick thumbnail must use object-fit: cover');
      assert.equal(pick.radius, '8px', 'Pick thumbnail must use an 8px corner radius');
      assert.equal(pick.rightOfText, true, 'Pick thumbnail must sit to the right of the story text');
    }
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
      titles.fullyVisible >= 6 && titles.fullyVisible <= 6,
      `Desktop must still show 6 complete cards, measured ${titles.fullyVisible}`
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
        accountSection: !!document.getElementById('syncSettingsBtn'),
        docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    `);

    assert.ok(sidebar.visible, 'Sidebar must be visible on desktop');
    assert.ok(sidebar.width >= 180, `Sidebar should keep its desktop width, measured ${sidebar.width}px`);
    assert.ok(
      sidebar.headings.includes('TOPICS') && sidebar.headings.includes('LIBRARY'),
      `Sidebar should keep its TOPICS and LIBRARY groups, found ${JSON.stringify(sidebar.headings)}`
    );
    assert.equal(sidebar.accountSection, false, 'Log in is not part of the navigation');
    const ids = sidebar.items.map(i => i.id);
    for (const expected of ['all', 'news', 'papers', 'reviews', 'reddit', 'hwToggle', 'savedToggle', 'digestsNav']) {
      assert.ok(ids.includes(expected), `Sidebar must expose navigation item "${expected}", found ${JSON.stringify(ids)}`);
    }
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
        accountVisible: !!document.getElementById('syncSettingsBtn'),
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
    assert.ok(open.digestsVisible, 'Drawer must keep every navigation destination reachable');
    assert.equal(open.accountVisible, false, 'Log in is not part of the drawer');
    assert.ok(open.navIds.includes('digestsNav'), 'Drawer must keep the digests link');
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

  await t.test('mobile drawer stays compact, keeps the feed visible, and swipes closed', async () => {
    await driver.setWindowRect(390, 844);
    await sleep(300);
    await driver.executeScript(`
      if (document.body.classList.contains('sidebar-open')) document.getElementById('sidebarClose').click();
    `);
    await sleep(200);

    const toggleEl = await driver.findElement('#menuToggle');
    await driver.click(toggleEl);
    await sleep(400);

    const compact = await driver.executeScript(`
      const filters = document.getElementById('filters');
      const backdrop = document.getElementById('sidebarBackdrop');
      const fRect = filters.getBoundingClientRect();
      const viewport = document.documentElement.clientWidth;
      const color = getComputedStyle(backdrop).backgroundColor;
      const match = color.match(/rgba?\\(([^)]+)\\)/);
      const parts = match ? match[1].split(',').map(v => parseFloat(v)) : [];
      const alpha = parts.length === 4 ? parts[3] : (parts.length === 3 ? 1 : 0);
      const closeRect = document.getElementById('sidebarClose').getBoundingClientRect();
      return {
        viewport,
        width: Math.round(fRect.width),
        fraction: fRect.width / viewport,
        visibleBeside: Math.round(viewport - fRect.right),
        scrimAlpha: alpha,
        closeWidth: Math.round(closeRect.width),
        closeHeight: Math.round(closeRect.height)
      };
    `);

    assert.ok(compact.width >= 200, `Drawer must stay usable, found ${compact.width}px`);
    assert.ok(
      compact.fraction <= 0.66,
      `Drawer must not take over the viewport (occupies ${Math.round(compact.fraction * 100)}% of it)`
    );
    assert.ok(
      compact.visibleBeside >= 100,
      `Feed must stay visible beside the open drawer (${compact.visibleBeside}px uncovered)`
    );
    assert.ok(
      compact.scrimAlpha > 0 && compact.scrimAlpha <= 0.4,
      `Backdrop must stay light enough to read the page through (alpha ${compact.scrimAlpha})`
    );
    assert.ok(
      compact.closeWidth >= 40 && compact.closeHeight >= 40,
      `Close control must be a comfortable touch target (${compact.closeWidth}x${compact.closeHeight})`
    );

    // A mostly-vertical drag is a scroll gesture, not a dismissal.
    const vertical = await driver.executeScript(`
      const filters = document.getElementById('filters');
      const fire = (type, x, y) => {
        const ev = new Event(type, { bubbles: true, cancelable: true });
        ev.touches = [{ clientX: x, clientY: y }];
        ev.changedTouches = [{ clientX: x, clientY: y }];
        filters.dispatchEvent(ev);
      };
      fire('touchstart', 200, 300);
      fire('touchend', 206, 430);
      return document.body.classList.contains('sidebar-open');
    `);
    assert.equal(vertical, true, 'A vertical swipe must not dismiss the drawer');

    // A left swipe dismisses it and hands the page back.
    const swiped = await driver.executeScript(`
      const filters = document.getElementById('filters');
      const fire = (type, x, y) => {
        const ev = new Event(type, { bubbles: true, cancelable: true });
        ev.touches = [{ clientX: x, clientY: y }];
        ev.changedTouches = [{ clientX: x, clientY: y }];
        filters.dispatchEvent(ev);
      };
      fire('touchstart', 200, 300);
      fire('touchend', 120, 312);
      return new Promise(resolve => setTimeout(() => resolve({
        open: document.body.classList.contains('sidebar-open'),
        expanded: document.getElementById('menuToggle').getAttribute('aria-expanded'),
        mainInert: document.querySelector('main').inert,
        backdrop: getComputedStyle(document.getElementById('sidebarBackdrop')).display
      }), 350));
    `);

    assert.equal(swiped.open, false, 'Swiping the drawer left must dismiss it');
    assert.equal(swiped.expanded, 'false', 'Menu control must report collapsed after the swipe');
    assert.equal(swiped.mainInert, false, 'Feed must become interactive again after the swipe');
    assert.equal(swiped.backdrop, 'none', 'Backdrop must be removed after the swipe');
  });

  await t.test('search placeholder stays whole and readable on narrow screens', async () => {
    await driver.setWindowRect(390, 844);
    await sleep(350);

    const narrow = await driver.executeScript(`
      const el = document.getElementById('search');
      if (document.activeElement === el) el.blur();
      const cs = getComputedStyle(el);
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = (cs.fontWeight || '400') + ' ' + cs.fontSize + ' ' + (cs.fontFamily || 'sans-serif');
      const usable = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return {
        placeholder: el.placeholder,
        fontSize: parseFloat(cs.fontSize),
        measured: Math.ceil(ctx.measureText(el.placeholder).width),
        usable: Math.round(usable)
      };
    `);

    const wideText = 'Search headlines and summaries… (press / to focus)';
    assert.ok(narrow.placeholder.length > 0, 'Narrow screens must keep a placeholder');
    assert.notEqual(narrow.placeholder, wideText, 'Narrow screens must not use the wording that overflows');
    assert.match(narrow.placeholder, /press \//, 'Narrow placeholder must keep the "/" shortcut hint');
    assert.ok(narrow.fontSize >= 12, `Placeholder must stay readable (font-size ${narrow.fontSize}px)`);
    assert.ok(
      narrow.measured <= narrow.usable + 4,
      `Placeholder must fit without truncation (needs ${narrow.measured}px, has ${narrow.usable}px)`
    );

    await driver.setWindowRect(1280, 900);
    await sleep(350);
    const wide = await driver.executeScript(`
      return {
        placeholder: document.getElementById('search').placeholder,
        fontSize: parseFloat(getComputedStyle(document.getElementById('search')).fontSize)
      };
    `);
    assert.equal(wide.placeholder, wideText, 'Desktop must keep the full placeholder wording');
    assert.ok(wide.fontSize >= 14, `Desktop search typography must be unchanged (font-size ${wide.fontSize}px)`);
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
      return Array.from(document.querySelectorAll('.category-nav .nav-label'))
        .map(b => b.textContent.trim());
    `);
    assert.deepEqual(labels, ['All News', 'Software & Dev', 'AI & Research', 'Chips & Silicon', 'Gaming & Consoles', 'Space & Rockets', 'Cybersecurity', 'Gadgets & Hardware'], `Unexpected filter labels: ${JSON.stringify(labels)}`);
  });

  await t.test('React category nav is one transparent row', async () => {
    const geometry = await driver.executeScript(`
      const nav = document.querySelector('.category-nav');
      const navStyle = getComputedStyle(nav);
      return {
        wrap: navStyle.flexWrap,
        overflowX: navStyle.overflowX,
        items: Array.from(nav.querySelectorAll('.filter')).map(b => {
          const s = getComputedStyle(b);
          return {
            label: b.querySelector('.nav-label').textContent.trim(),
            radius: s.borderTopLeftRadius,
            background: s.backgroundColor,
            borderWidth: s.borderTopWidth,
            shadow: s.boxShadow
          };
        })
      };
    `);
    assert.equal(geometry.wrap, 'nowrap', 'Category nav must stay on one row');
    assert.equal(geometry.overflowX, 'auto', 'Category nav must scroll horizontally instead of wrapping');
    assert.equal(geometry.items.length, 8, `Expected 8 filter buttons, found ${geometry.items.length}`);
    for (const btn of geometry.items) {
      assert.equal(btn.radius, '0px', `Filter "${btn.label}" should not use a pill or square tab`);
      assert.equal(btn.background, 'rgba(0, 0, 0, 0)', `Filter "${btn.label}" background should be transparent`);
      assert.equal(btn.borderWidth, '0px', `Filter "${btn.label}" should have no border`);
      assert.equal(btn.shadow, 'none', `Filter "${btn.label}" should have no box shadow`);
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
          borderWidth: s.borderTopWidth,
          shadow: s.boxShadow
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

    const expectedColor = hexToRgb(probe.tokens.textMuted);

    assert.ok(expectedColor, `Could not parse --text-muted token: ${probe.tokens.textMuted}`);

    assert.equal(probe.actual.background, 'rgba(0, 0, 0, 0)', 'Idle filter background must stay transparent');
    assert.equal(probe.actual.color, expectedColor, 'Idle filter text must follow --text-muted');
    assert.equal(probe.actual.borderWidth, '0px', 'Idle filter must not draw a tab border');
    assert.equal(probe.actual.shadow, 'none', 'Idle filter must not draw a tab shadow');
  });

  await t.test('React active filter stays transparent and keeps its accent token', async () => {
    const readActive = () => driver.executeScript(`
      const cs = getComputedStyle(document.documentElement);
      const active = document.querySelector('.filter.active');
      if (!active) return null;
      const s = getComputedStyle(active);
      return {
        label: active.querySelector('.nav-label').textContent.trim(),
        dot: s.getPropertyValue('--dot').trim(),
        background: s.backgroundColor,
        shadow: s.boxShadow,
        news: cs.getPropertyValue('--news').trim(),
        papers: cs.getPropertyValue('--papers').trim()
      };
    `);

    const clickByLabel = async (label) => {
      await driver.executeScript(`
        const btn = Array.from(document.querySelectorAll('.category-nav .filter'))
          .find(b => b.querySelector('.nav-label').textContent.trim() === ${JSON.stringify(label)});
        if (btn) btn.click();
      `);
      await sleep(300);
    };

    await clickByLabel('Software & Dev');
    let active = await readActive();
    assert.ok(active, 'No .filter.active element after selecting Software & Dev');
    assert.equal(active.label, 'Software & Dev', `Expected Software & Dev to be active, got ${active.label}`);
    assert.equal(active.dot, active.news, 'Active Software & Dev filter --dot must resolve to the --news accent');

    // Compare while Software & Dev is still the active button; re-read after switching.
    assert.equal(active.background, 'rgba(0, 0, 0, 0)', 'Active Software & Dev filter must stay transparent');
    assert.equal(active.shadow, 'none', 'Active Software & Dev filter must not use a tab shadow');

    await clickByLabel('AI & Research');
    active = await readActive();
    assert.ok(active, 'No .filter.active element after selecting AI & Research');
    assert.equal(active.label, 'AI & Research', `Expected AI & Research to be active, got ${active.label}`);
    assert.equal(active.dot, active.papers, 'Active AI & Research filter --dot must resolve to the --papers accent');

    assert.equal(active.background, 'rgba(0, 0, 0, 0)', 'Active AI & Research filter must stay transparent');
    assert.equal(active.shadow, 'none', 'Active AI & Research filter must not use a tab shadow');
  });

  await t.test('React "All" filter carries a valid accent', async () => {
    // CAT_COLOR previously had no "all" key, so React dropped the inline
    // --dot and the button fell through to the var(--dot, var(--news))
    // default. An empty --dot is the regression signal.
    await driver.executeScript(`
      const btn = Array.from(document.querySelectorAll('.category-nav .filter'))
        .find(b => b.querySelector('.nav-label').textContent.trim() === 'All News');
      if (btn) btn.click();
    `);
    await sleep(300);

    const all = await driver.executeScript(`
      const active = document.querySelector('.filter.active');
      if (!active) return null;
      const s = getComputedStyle(active);
      return {
        label: active.querySelector('.nav-label').textContent.trim(),
        inlineStyle: active.getAttribute('style') || '',
        dot: s.getPropertyValue('--dot').trim(),
        background: s.backgroundColor
      };
    `);

    assert.ok(all, 'No .filter.active element after selecting All');
    assert.equal(all.label, 'All News', `Expected All News to be active, got ${all.label}`);
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

    assert.equal(light.actualBackground, 'rgba(0, 0, 0, 0)', 'Idle filter background in light mode must stay transparent');
    assert.equal(light.radius, '0px', 'Filters must not regain a pill or square tab in light mode');
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
