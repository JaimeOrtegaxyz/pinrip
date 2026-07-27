/*
 * Read Pinterest's cookies out of a locally installed Chromium-family browser,
 * so pinrip scrapes as the same logged-in user you see in your own browser.
 *
 * Every Chromium fork stores cookies the same way: a SQLite DB per profile,
 * values encrypted with AES-128-CBC under a key derived from a password the
 * OS keeps (macOS Keychain, Linux keyring). Only the roots and the key's
 * service name differ, so one reader covers Chrome, Brave, Edge, Arc, ...
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// key: what the user types for --browser. label/keychain: how the browser
// names itself to the OS. mac/linux: where it keeps its profile tree.
const BROWSERS = [
  { key: 'chrome', label: 'Chrome', keychain: 'Chrome', mac: 'Google/Chrome', linux: 'google-chrome' },
  { key: 'brave', label: 'Brave', keychain: 'Brave', mac: 'BraveSoftware/Brave-Browser', linux: 'BraveSoftware/Brave-Browser' },
  { key: 'edge', label: 'Microsoft Edge', keychain: 'Microsoft Edge', mac: 'Microsoft Edge', linux: 'microsoft-edge' },
  { key: 'arc', label: 'Arc', keychain: 'Arc', mac: 'Arc', linux: null },
  { key: 'vivaldi', label: 'Vivaldi', keychain: 'Vivaldi', mac: 'Vivaldi', linux: 'vivaldi' },
  { key: 'opera', label: 'Opera', keychain: 'Opera', mac: 'com.operasoftware.Opera', linux: 'opera' },
  { key: 'chromium', label: 'Chromium', keychain: 'Chromium', mac: 'Chromium', linux: 'chromium' },
];

// Directories inside a profile tree that never hold a cookie DB.
const SKIP_DIRS = new Set([
  'Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
  'Crashpad', 'Safe Browsing', 'ShaderCache', 'GrShaderCache', 'component_crx_cache',
  'Extensions', 'Service Worker', 'IndexedDB', 'Local Storage', 'Session Storage', 'blob_storage',
]);

function browserRoot(b) {
  if (process.platform === 'darwin') {
    return b.mac && path.join(os.homedir(), 'Library', 'Application Support', b.mac);
  }
  if (process.platform === 'linux') {
    return b.linux && path.join(os.homedir(), '.config', b.linux);
  }
  return null;
}

// Cookie DBs live at <profile>/Cookies on older builds and <profile>/Network/Cookies
// on newer ones; Arc nests everything under User Data. A shallow walk covers all.
function findProfiles(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isFile() && e.name === 'Cookies') {
        const rel = path.relative(root, path.dirname(p)).replace(/\/?Network$/, '');
        out.push({ file: p, profile: rel || 'Default' });
      } else if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) {
        walk(p, depth + 1);
      }
    }
  };
  walk(root, 0);
  return out;
}

function sqlite(file, sql) {
  // Copy first: the browser may be running and holding a write lock.
  const tmp = path.join(os.tmpdir(), `pinrip-cookies-${process.pid}-${path.basename(path.dirname(file))}`);
  fs.copyFileSync(file, tmp);
  for (const ext of ['-wal', '-journal']) {
    if (fs.existsSync(file + ext)) fs.copyFileSync(file + ext, tmp + ext);
  }
  try {
    const out = execFileSync('sqlite3', ['-readonly', '-separator', '\x01', tmp, sql], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return out.trim() ? out.trim().split('\n') : [];
  } finally {
    for (const ext of ['', '-wal', '-journal']) fs.rmSync(tmp + ext, { force: true });
  }
}

const COOKIE_SQL =
  "select host_key, name, path, expires_utc, is_secure, is_httponly, samesite, hex(encrypted_value) " +
  "from cookies where host_key like '%pinterest%'";

// Names present only once Pinterest has actually authenticated you. Checked
// without decrypting, so profile discovery costs no keychain prompt.
const AUTH_HINTS = ['__Secure-s_a', '_auth'];

/** Every browser profile on this machine that holds Pinterest cookies. */
function findCandidates() {
  const found = [];
  for (const b of BROWSERS) {
    const root = browserRoot(b);
    if (!root || !fs.existsSync(root)) continue;
    for (const p of findProfiles(root)) {
      let rows;
      try {
        rows = sqlite(p.file, "select name from cookies where host_key like '%pinterest%'");
      } catch {
        continue;
      }
      if (!rows.length) continue;
      found.push({
        browser: b,
        profile: p.profile,
        file: p.file,
        count: rows.length,
        looksLoggedIn: rows.includes('__Secure-s_a'),
        id: `${b.key}:${p.profile}`,
      });
    }
  }
  // Most likely session first: real auth cookie, then richest cookie jar.
  return found.sort((a, b) => b.looksLoggedIn - a.looksLoggedIn || b.count - a.count);
}

function keyFor(browser) {
  if (process.platform === 'darwin') {
    const service = `${browser.keychain} Safe Storage`;
    let pw;
    for (const args of [['-s', service, '-a', browser.keychain], ['-s', service]]) {
      try {
        pw = execFileSync('security', ['find-generic-password', '-w', ...args], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        break;
      } catch {
        /* try the next lookup shape */
      }
    }
    if (!pw) throw new Error(`macOS Keychain has no "${service}" entry, or access was denied.`);
    return crypto.pbkdf2Sync(pw, 'saltysalt', 1003, 16, 'sha1');
  }
  if (process.platform === 'linux') {
    let pw = 'peanuts'; // Chromium's fallback when no keyring is available
    try {
      pw =
        execFileSync('secret-tool', ['lookup', 'application', browser.key], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim() || pw;
    } catch {
      /* no secret-tool, or nothing stored — fall back */
    }
    return crypto.pbkdf2Sync(pw, 'saltysalt', 1, 16, 'sha1');
  }
  throw new Error(`Reading browser cookies isn't supported on ${process.platform} yet.`);
}

function decryptValue(hex, key, hostKey) {
  const blob = Buffer.from(hex, 'hex');
  if (blob.length <= 3) return null;
  const version = blob.subarray(0, 3).toString('latin1');
  // v20 is Windows app-bound encryption — unreadable outside the browser process.
  if (version !== 'v10' && version !== 'v11') return null;

  const d = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '));
  d.setAutoPadding(false);
  let out;
  try {
    out = Buffer.concat([d.update(blob.subarray(3)), d.final()]);
  } catch {
    return null;
  }
  const pad = out[out.length - 1];
  if (pad >= 1 && pad <= 16) out = out.subarray(0, out.length - pad);

  // Chrome 127+ binds a value to its host by prepending SHA-256(host_key).
  if (out.length >= 32) {
    const stamp = crypto.createHash('sha256').update(hostKey).digest();
    if (stamp.equals(out.subarray(0, 32))) out = out.subarray(32);
  }
  const s = out.toString('utf8');
  return /[\x00-\x08\x0e-\x1f]/.test(s) ? null : s;
}

const SAMESITE = { '-1': 'Lax', 0: 'None', 1: 'Lax', 2: 'Strict' };

/**
 * Decrypt one profile's Pinterest cookies into Playwright's addCookies() shape.
 * On macOS the first call raises a Keychain prompt.
 */
function readCookies(candidate) {
  const key = keyFor(candidate.browser);
  const now = Date.now() / 1000;
  const cookies = [];
  let unreadable = 0;

  for (const row of sqlite(candidate.file, COOKIE_SQL)) {
    const [host, name, cookiePath, expiresUtc, secure, httpOnly, samesite, hex] = row.split('\x01');
    const value = decryptValue(hex, key, host);
    if (value === null) {
      unreadable++;
      continue;
    }
    // Chrome timestamps are microseconds since 1601-01-01; 0 means session cookie.
    const expires = Number(expiresUtc) ? Number(expiresUtc) / 1e6 - 11644473600 : -1;
    if (expires !== -1 && expires < now) continue;

    const isSecure = secure === '1';
    let sameSite = SAMESITE[samesite] || 'Lax';
    if (sameSite === 'None' && !isSecure) sameSite = 'Lax';

    cookies.push({
      name,
      value,
      domain: host,
      path: cookiePath || '/',
      expires,
      httpOnly: httpOnly === '1',
      secure: isSecure,
      sameSite,
    });
  }

  if (!cookies.length) {
    throw new Error(
      unreadable
        ? `Could not decrypt ${candidate.browser.label}'s cookies — the encryption key was rejected.`
        : `No Pinterest cookies in ${candidate.browser.label} (${candidate.profile}).`
    );
  }
  return { cookies, unreadable };
}

module.exports = { BROWSERS, findCandidates, readCookies, AUTH_HINTS };
