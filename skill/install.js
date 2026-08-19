/*
 * pinrip skill — put the /pinrip moodboard-scout skill where agent harnesses
 * look for it.
 *
 *   pinrip skill                 status: where it is installed, and whether it's current
 *   pinrip skill install         copy skill/SKILL.md into every harness present
 *   pinrip skill install --to <dir>   … or into one specific skills directory
 *   pinrip skill uninstall       remove it again
 *
 * Also run from package.json's postinstall, so `npm install` / `npm link` /
 * `npm install -g` install the skill for anyone who has a harness. Only
 * harnesses whose home directory already exists are touched; without one,
 * nothing happens. Set PINRIP_SKIP_SKILL=1 to opt out.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const SOURCE = path.join(__dirname, 'SKILL.md');

const HARNESSES = [
  { label: 'Claude Code', home: '.claude', skills: path.join('.claude', 'skills') },
  { label: 'Codex', home: '.codex', skills: path.join('.codex', 'skills') },
];

const home = (p) => path.join(os.homedir(), p);
const pretty = (p) => p.replace(os.homedir(), '~');

function targets(to) {
  if (to) return [{ label: to, dir: path.resolve(to.replace(/^~\//, os.homedir() + '/')), present: true }];
  return HARNESSES.map((h) => ({
    label: h.label,
    dir: path.join(home(h.skills), 'pinrip'),
    present: fs.existsSync(home(h.home)),
  }));
}

function installedState(dir) {
  const file = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(file)) return 'missing';
  return fs.readFileSync(file, 'utf8') === fs.readFileSync(SOURCE, 'utf8') ? 'current' : 'outdated';
}

function install({ to = null, quiet = false } = {}) {
  const list = targets(to).filter((t) => t.present);
  if (!list.length) {
    if (!quiet) console.log('No agent harness found (~/.claude or ~/.codex). Point at one: pinrip skill install --to <skills dir>');
    return [];
  }
  const done = [];
  for (const t of list) {
    const state = installedState(t.dir);
    if (state === 'current') {
      if (!quiet) console.log(`${t.label}: /pinrip skill already current at ${pretty(t.dir)}`);
      continue;
    }
    fs.mkdirSync(t.dir, { recursive: true });
    fs.copyFileSync(SOURCE, path.join(t.dir, 'SKILL.md'));
    console.log(`${t.label}: /pinrip skill ${state === 'outdated' ? 'updated' : 'installed'} → ${pretty(t.dir)}`);
    done.push(t);
  }
  return done;
}

function uninstall({ to = null } = {}) {
  let removed = 0;
  for (const t of targets(to)) {
    if (!fs.existsSync(path.join(t.dir, 'SKILL.md'))) continue;
    fs.rmSync(t.dir, { recursive: true, force: true });
    console.log(`${t.label}: removed ${pretty(t.dir)}`);
    removed++;
  }
  if (!removed) console.log('The /pinrip skill was not installed anywhere.');
}

function status() {
  for (const t of targets()) {
    if (!t.present) {
      console.log(`${t.label}: not on this machine`);
      continue;
    }
    const state = installedState(t.dir);
    console.log(
      state === 'current'
        ? `${t.label}: /pinrip installed and current — ${pretty(t.dir)}`
        : state === 'outdated'
          ? `${t.label}: /pinrip installed but outdated — run \`pinrip skill install\``
          : `${t.label}: /pinrip not installed — run \`pinrip skill install\``
    );
  }
  console.log(`Skill source: ${pretty(SOURCE)}`);
}

// `pinrip skill [install|uninstall|status] [--to <dir>]`
function handleSkill(argv) {
  const cmd = argv.find((a) => !a.startsWith('-')) || 'status';
  const to = argv.includes('--to') ? argv[argv.indexOf('--to') + 1] : null;
  if (cmd === 'install') return install({ to });
  if (cmd === 'uninstall') return uninstall({ to });
  if (cmd === 'status') return status();
  console.log('Usage: pinrip skill [install [--to <skills dir>] | uninstall | status]');
  process.exit(1);
}

// npm postinstall: quiet, best-effort, never fails the install.
function postinstall() {
  if (process.env.CI || process.env.PINRIP_SKIP_SKILL) return;
  try {
    const done = install({ quiet: true });
    if (done.length) console.log('  (the /pinrip moodboard skill — remove with `pinrip skill uninstall`)');
  } catch {
    /* a skill that didn't install is not worth a broken npm install */
  }
}

module.exports = { handleSkill, install, uninstall, status, postinstall };

if (require.main === module) {
  if (process.argv[2] === '--postinstall') postinstall();
  else handleSkill(process.argv.slice(2));
}
