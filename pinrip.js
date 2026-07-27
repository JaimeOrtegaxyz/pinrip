#!/usr/bin/env node
/*
 * pinrip — download the images of a Pinterest page as full-res originals.
 *
 * Usage:
 *   pinrip <pinterest-url>            rip up to 50 images
 *   pinrip <url> --out <folder>       land this rip in a specific folder
 *   pinrip use <folder>               sticky: land ALL rips there until "use off"
 *   pinrip use                        show the sticky folder, if any
 *   pinrip use off                    back to naming folders after the page
 *   pinrip <url> --limit 80           different cap
 *   pinrip <url> --allow-dupes        re-download images already in the folder
 *   pinrip <url> --headed             watch the browser work
 *
 *   pinrip login                      borrow the Pinterest session from your browser
 *   pinrip login --list               list the browser profiles it can borrow from
 *   pinrip login --browser brave      borrow from a specific browser / profile
 *          [--profile "Profile 1"]
 *   pinrip login --window             log in by hand in a pinrip window instead
 *   pinrip status                     check which account pinrip rips as
 *   pinrip logout                     forget the saved session
 *
 * Logged out, Pinterest serves a public, truncated feed — genuinely different
 * images from the ones you see while browsing, and it stops feeding related
 * pins after ~25–30. Every rip prints which of the two you're getting.
 *
 * Output: ~/Downloads/pinterest-rip/<folder>/<hash>.<ext> where <folder> is
 * --out, else the sticky folder, else a slug of the page title. Folder names
 * containing "/" are treated as paths instead of names under pinterest-rip.
 * Images already present in the destination folder are skipped, so ripping
 * into the same folder twice only adds what's new; the same image can still
 * land in different folders.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { findCandidates, readCookies } = require('./cookies');

const RIP_ROOT = path.join(os.homedir(), 'Downloads', 'pinterest-rip');
const PROFILE_DIR = path.join(os.homedir(), '.pinrip', 'profile');
const STICKY_FILE = path.join(os.homedir(), '.pinrip', 'session');
const COOKIE_FILE = path.join(os.homedir(), '.pinrip', 'cookies.json');
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

function parseArgs(argv) {
  const args = { limit: 50, url: null, headed: false, allowDupes: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--headed') args.headed = true;
    else if (a === '--allow-dupes') args.allowDupes = true;
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10) || 50;
    else if (a === '--out') args.out = argv[++i];
    else if (!a.startsWith('-')) args.url = a;
  }
  return args;
}

function slugify(s) {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'pinterest-page'
  );
}

function hashOf(name) {
  return path.basename(name).replace(/\.[a-z0-9]+$/i, '');
}

function hashesInFolder(dir) {
  try {
    return new Set(fs.readdirSync(dir).map(hashOf));
  } catch {
    return new Set();
  }
}

/* ---------------------------------------------------------------- session */

function loadSession() {
  try {
    const s = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
    return s.cookies?.length ? s : null;
  } catch {
    return null;
  }
}

function saveSession(cookies, source) {
  const keep = cookies.filter((c) => /pinterest/.test(c.domain));
  fs.mkdirSync(path.dirname(COOKIE_FILE), { recursive: true });
  fs.writeFileSync(COOKIE_FILE, JSON.stringify({ source, savedAt: new Date().toISOString(), cookies: keep }, null, 2), {
    mode: 0o600,
  });
  return keep.length;
}

async function applySession(context) {
  const saved = loadSession();
  if (!saved) return false;
  try {
    await context.clearCookies({ domain: /pinterest/ });
    await context.addCookies(saved.cookies);
    return true;
  } catch (e) {
    console.error(`Saved session could not be applied (${e.message}) — continuing logged out.`);
    return false;
  }
}

// Ask Pinterest, don't trust the jar: a stale or rejected session comes back
// with _auth reset to 0 on the first page load.
async function authState(page) {
  const cookies = await page.context().cookies('https://www.pinterest.com/');
  const auth = cookies.find((c) => c.name === '_auth')?.value;
  if (!auth || auth === '0') return { loggedIn: false, user: null };
  // The header avatar links to the viewer on every page. Page data also carries
  // usernames, but on a board or pin those belong to its owner, not to you.
  const user = await page
    .evaluate(() => {
      const hp = document.querySelector('[data-test-id="header-profile"]');
      const a = hp && (hp.closest('a[href^="/"]') || hp.querySelector('a[href^="/"]'));
      const href = a?.getAttribute('href');
      return href && /^\/[A-Za-z0-9_]+\/$/.test(href) ? href.slice(1, -1) : null;
    })
    .catch(() => null);
  return { loggedIn: true, user: user && `@${user}` };
}

// Pinterest rotates session cookies as you browse; keep the saved copy current
// so a working login doesn't quietly go stale.
async function refreshSession(context) {
  const saved = loadSession();
  if (!saved) return;
  try {
    saveSession(await context.cookies(), saved.source);
  } catch {
    /* not worth failing a finished rip over */
  }
}

/* ----------------------------------------------------------------- scrape */

// Collect pinimg URLs currently in the DOM (largest srcset entry, no avatars).
function collectInPage() {
  const found = [];
  for (const img of document.querySelectorAll('img')) {
    let u = img.currentSrc || img.src;
    if (img.srcset) {
      const parts = img.srcset
        .split(',')
        .map((s) => s.trim().split(' '))
        .filter((p) => p[0]);
      parts.sort((a, b) => (parseInt(b[1]) || 0) - (parseInt(a[1]) || 0));
      if (parts[0]) u = parts[0][0];
    }
    if (!u || !u.includes('i.pinimg.com')) continue;
    if (/\/(30x30|60x60|75x75|75x75_RS|140x140)\//.test(u)) continue;
    found.push(u);
  }
  // Best effort: keep signup/login walls from blocking the scroll.
  for (const sel of [
    '[data-test-id="fullPageSignupModal"]',
    '[data-test-id="giftWrap"]',
    '[data-test-id="unauth-upsell"]',
  ]) {
    document.querySelector(sel)?.remove();
  }
  document.documentElement.style.overflow = 'auto';
  document.body.style.overflow = 'auto';
  window.scrollBy(0, window.innerHeight * 1.5);
  return { urls: found, y: window.scrollY, title: document.title };
}

async function launchContext({ headless }) {
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    viewport: { width: 1440, height: 1000 },
    userAgent: UA,
    // Look less like a robot: Pinterest and Google both gate on these.
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });
}

async function scrape(url, { limit, headed }) {
  const context = await launchContext({ headless: !headed });
  try {
    await applySession(context);
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);

    const auth = await authState(page);
    if (auth.loggedIn) console.log(`Logged in${auth.user ? ` as ${auth.user}` : ''} — ripping your feed.`);
    else
      console.log(
        'Not logged in — Pinterest is serving the public feed, which differs from what\n' +
          '  you see in your browser and dries up after ~25–30 related pins. Fix: pinrip login'
      );

    const urls = new Set();
    let title = '';
    let lastY = -1;
    let stall = 0;
    const deadline = Date.now() + 120000;

    while (urls.size < limit && stall < 8 && Date.now() < deadline) {
      const r = await page.evaluate(collectInPage);
      for (const u of r.urls) {
        if (urls.size >= limit) break;
        urls.add(u);
      }
      title = r.title || title;
      stall = r.y === lastY ? stall + 1 : 0;
      lastY = r.y;
      await page.waitForTimeout(700);
    }
    if (auth.loggedIn) await refreshSession(context);
    return { urls: [...urls], title };
  } finally {
    await context.close();
  }
}

/* --------------------------------------------------------------- download */

// Candidate URLs to try for one scraped image, best quality first.
function candidatesFor(url) {
  const p = url.replace('https://i.pinimg.com/', '');
  if (p.startsWith('originals/')) return [p];
  const rest = p.replace(/^(webp\/)?[0-9]+x[0-9]*(_RS)?\//, '');
  const stem = rest.replace(/\.[a-z0-9]+$/i, '');
  const ext = rest.split('.').pop().toLowerCase();
  const exts = [ext, ...['jpg', 'png', 'webp', 'gif'].filter((e) => e !== ext)];
  return [...exts.map((e) => `originals/${stem}.${e}`), p];
}

async function downloadOne(url, destDir) {
  const hash = hashOf(url);
  for (const c of candidatesFor(url)) {
    try {
      const res = await fetch(`https://i.pinimg.com/${c}`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const file = path.join(destDir, `${hash}.${c.split('.').pop()}`);
      fs.writeFileSync(file, buf);
      return { hash, ok: true, original: c.startsWith('originals/') };
    } catch {
      /* try next candidate */
    }
  }
  return { hash, ok: false };
}

async function downloadAll(urls, destDir, concurrency = 6) {
  const queue = [...urls];
  const results = [];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const u = queue.shift();
        results.push(await downloadOne(u, destDir));
      }
    })
  );
  return results;
}

/* ------------------------------------------------------------ login flows */

async function verifySession() {
  const context = await launchContext({ headless: true });
  try {
    await applySession(context);
    const page = context.pages()[0] || (await context.newPage());
    await page.goto('https://www.pinterest.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);
    return await authState(page);
  } finally {
    await context.close();
  }
}

function describe(c) {
  return `${c.browser.label} (${c.profile})${c.looksLoggedIn ? ' — signed in' : ''}`;
}

async function importFromBrowser({ browser, profile }) {
  const all = findCandidates();
  if (!all.length) {
    throw new Error(
      'No browser profile with Pinterest cookies found.\n' +
        'pinrip can read Chrome, Brave, Edge, Arc, Vivaldi, Opera and Chromium.\n' +
        'If you browse Pinterest somewhere else, use: pinrip login --window'
    );
  }
  let matches = all;
  if (browser) matches = matches.filter((c) => c.browser.key === browser.toLowerCase());
  if (profile) matches = matches.filter((c) => c.profile.toLowerCase() === profile.toLowerCase());
  if (!matches.length) {
    throw new Error(`No such browser/profile. Available:\n  ${all.map((c) => `${c.id}  ${describe(c)}`).join('\n  ')}`);
  }

  const pick = matches[0];
  const rivals = matches.filter((c) => c.looksLoggedIn).length;
  if (rivals > 1 && !browser) {
    console.log(`Several signed-in profiles found; using ${pick.id}. Pick another with --browser/--profile:`);
    for (const c of matches) console.log(`  ${c.id}  ${describe(c)}`);
  }

  console.log(`Reading Pinterest cookies from ${describe(pick)} ...`);
  if (process.platform === 'darwin') console.log('(macOS will ask permission to read the browser\'s encryption key)');
  const { cookies, unreadable } = readCookies(pick);
  const n = saveSession(cookies, pick.id);
  if (unreadable) console.log(`(${unreadable} cookies were unreadable and skipped)`);
  console.log(`Saved ${n} cookies to ${COOKIE_FILE}`);
  return pick;
}

async function loginWindow() {
  console.log('Opening Pinterest — log in, and pinrip will save the session automatically.');
  console.log('Note: "Continue with Google" is usually refused inside an automated window.');
  console.log('Use your Pinterest email + password, or quit and run `pinrip login` to borrow');
  console.log('the session from your everyday browser instead.\n');

  const context = await launchContext({ headless: false });
  let closed = false;
  context.on('close', () => (closed = true));
  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://www.pinterest.com/login/');

  let captured = null;
  while (!closed) {
    await new Promise((r) => setTimeout(r, 2000));
    if (closed) break;
    try {
      const cookies = await context.cookies();
      const auth = cookies.find((c) => c.domain.includes('pinterest') && c.name === '_auth')?.value;
      if (auth && auth !== '0') {
        captured = cookies;
        break;
      }
    } catch {
      break; // window went away mid-poll
    }
  }

  if (captured) {
    const n = saveSession(captured, 'window');
    console.log(`\n✓ Logged in — ${n} cookies saved. Closing the window.`);
    if (!closed) await context.close();
    return true;
  }
  console.log('\nWindow closed without a completed login — nothing saved.');
  return false;
}

async function handleLogin(argv) {
  const opts = { window: false, list: false, browser: null, profile: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--window') opts.window = true;
    else if (argv[i] === '--list') opts.list = true;
    else if (argv[i] === '--browser') opts.browser = argv[++i];
    else if (argv[i] === '--profile') opts.profile = argv[++i];
  }

  if (opts.list) {
    const all = findCandidates();
    if (!all.length) return console.log('No browser profile with Pinterest cookies found.');
    console.log('Profiles pinrip can borrow a session from:');
    for (const c of all) console.log(`  ${c.id.padEnd(24)} ${describe(c)}`);
    return;
  }

  if (opts.window) {
    if (!(await loginWindow())) process.exit(1);
  } else {
    await importFromBrowser(opts);
  }

  process.stdout.write('Checking the session with Pinterest ... ');
  const auth = await verifySession();
  if (auth.loggedIn) {
    console.log(`✓ logged in${auth.user ? ` as ${auth.user}` : ''}.`);
  } else {
    console.log('✗ Pinterest still sees an anonymous session.');
    console.log('The cookies may be stale — sign in again in your browser, then rerun `pinrip login`.');
    process.exit(1);
  }
}

async function handleStatus() {
  const saved = loadSession();
  if (!saved) {
    console.log('No saved session — rips run logged out. Fix: pinrip login');
    return;
  }
  const when = (saved.savedAt || '').slice(0, 16).replace('T', ' ');
  console.log(`Session from ${saved.source || 'unknown'}${when ? `, saved ${when}` : ''}.`);
  process.stdout.write('Checking with Pinterest ... ');
  const auth = await verifySession();
  console.log(auth.loggedIn ? `✓ logged in${auth.user ? ` as ${auth.user}` : ''}.` : '✗ expired — rerun `pinrip login`.');
  if (!auth.loggedIn) process.exit(1);
}

function handleLogout() {
  const had = fs.existsSync(COOKIE_FILE);
  fs.rmSync(COOKIE_FILE, { force: true });
  fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  console.log(had ? 'Session forgotten — rips will run logged out.' : 'No session was saved.');
}

/* ------------------------------------------------------------ destination */

function stickyFolder() {
  try {
    return fs.readFileSync(STICKY_FILE, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function resolveDest(name) {
  return name.includes('/') ? path.resolve(name.replace(/^~\//, os.homedir() + '/')) : path.join(RIP_ROOT, name);
}

function handleUse(name) {
  if (!name) {
    const s = stickyFolder();
    console.log(s ? `Rips currently land in: ${resolveDest(s)}` : 'No sticky folder — rips are named after the page.');
  } else if (name === 'off' || name === '--clear') {
    fs.rmSync(STICKY_FILE, { force: true });
    console.log('Sticky folder cleared — rips will be named after the page again.');
  } else {
    fs.mkdirSync(path.dirname(STICKY_FILE), { recursive: true });
    fs.writeFileSync(STICKY_FILE, name);
    console.log(`All rips will now land in ${resolveDest(name)} — until \`pinrip use off\`.`);
  }
}

function usage(code) {
  console.log('Usage: pinrip <pinterest-url> [--out folder] [--limit 50] [--allow-dupes] [--headed]');
  console.log('       pinrip use [<folder>|off]   sticky folder for all rips');
  console.log('       pinrip login [--list|--window|--browser <b> --profile <p>]');
  console.log('       pinrip status | logout');
  process.exit(code);
}

/* ------------------------------------------------------------------- main */

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (cmd === 'use') return handleUse(argv[1]);
  if (cmd === 'logout') return handleLogout();
  if (cmd === 'status') return handleStatus();
  if (cmd === 'login') return handleLogin(argv.slice(1));
  if (argv.includes('--login')) return handleLogin(argv.filter((a) => a !== '--login')); // pre-1.1 spelling

  const args = parseArgs(argv);
  if (!args.url || !/pinterest\.[a-z.]+\//i.test(args.url)) usage(args.url ? 1 : 0);

  fs.mkdirSync(RIP_ROOT, { recursive: true });
  console.log(`Scraping ${args.url} (cap ${args.limit}) ...`);
  const { urls, title } = await scrape(args.url, args);
  if (!urls.length) {
    console.error('No images found — Pinterest may be walling the page. Try: pinrip login');
    process.exit(1);
  }

  const sticky = stickyFolder();
  const folder = args.out || sticky;
  const destDir = folder ? resolveDest(folder) : path.join(RIP_ROOT, slugify(title.replace(/\s*\|\s*Pinterest.*$/i, '')));
  if (folder && !args.out) console.log(`(sticky folder: ${folder})`);
  fs.mkdirSync(destDir, { recursive: true });

  const seen = args.allowDupes ? new Set() : hashesInFolder(destDir);
  const fresh = urls.filter((u) => !seen.has(hashOf(u)));
  const skipped = urls.length - fresh.length;

  console.log(
    `Collected ${urls.length} images${skipped ? ` (${skipped} already in folder)` : ''} — downloading ${fresh.length} ...`
  );
  const results = await downloadAll(fresh, destDir);
  const ok = results.filter((r) => r.ok);
  const fullRes = ok.filter((r) => r.original).length;

  console.log(`Done: ${ok.length}/${fresh.length} saved (${fullRes} full-res) → ${destDir}`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) console.log(`Failed: ${failed.map((f) => f.hash).join(', ')}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
