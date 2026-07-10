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
 *   pinrip --login                    open a window to log in to Pinterest
 *                                     (session persists for future runs)
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

const RIP_ROOT = path.join(os.homedir(), 'Downloads', 'pinterest-rip');
const PROFILE_DIR = path.join(os.homedir(), '.pinrip', 'profile');
const SESSION_FILE = path.join(os.homedir(), '.pinrip', 'session');
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

function parseArgs(argv) {
  const args = { limit: 50, url: null, login: false, headed: false, allowDupes: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--login') args.login = true;
    else if (a === '--headed') args.headed = true;
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

async function scrape(url, { limit, headed }) {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !headed,
    viewport: { width: 1440, height: 1000 },
    userAgent: UA,
  });
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);

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
    return { urls: [...urls], title };
  } finally {
    await context.close();
  }
}

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

async function login() {
  console.log('Opening Pinterest — log in, then close the window.');
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    userAgent: UA,
  });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://www.pinterest.com/login/');
  await new Promise((resolve) => context.on('close', resolve));
  console.log('Session saved. Future rips will use it.');
}

function currentSession() {
  try {
    return fs.readFileSync(SESSION_FILE, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function handleUse(name) {
  if (!name) {
    const s = currentSession();
    console.log(s ? `Rips currently land in: ${resolveDest(s)}` : 'No sticky folder — rips are named after the page.');
  } else if (name === 'off' || name === '--clear') {
    fs.rmSync(SESSION_FILE, { force: true });
    console.log('Sticky folder cleared — rips will be named after the page again.');
  } else {
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    fs.writeFileSync(SESSION_FILE, name);
    console.log(`All rips will now land in ${resolveDest(name)} — until \`pinrip use off\`.`);
  }
}

function resolveDest(name) {
  return name.includes('/') ? path.resolve(name.replace(/^~\//, os.homedir() + '/')) : path.join(RIP_ROOT, name);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === 'use') return handleUse(argv[1]);
  const args = parseArgs(argv);

  if (args.login) return login();
  if (!args.url || !/pinterest\.[a-z.]+\//i.test(args.url)) {
    console.log('Usage: pinrip <pinterest-url> [--out folder] [--limit 50] [--allow-dupes] [--headed]');
    console.log('       pinrip use [<folder>|off]   sticky folder for all rips');
    console.log('       pinrip --login');
    process.exit(args.url ? 1 : 0);
  }

  fs.mkdirSync(RIP_ROOT, { recursive: true });
  console.log(`Scraping ${args.url} (cap ${args.limit}) ...`);
  const { urls, title } = await scrape(args.url, args);
  if (!urls.length) {
    console.error('No images found — Pinterest may be walling the page. Try: pinrip --login');
    process.exit(1);
  }

  const sticky = currentSession();
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
