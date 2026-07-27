<p align="center">
  <img src="pinrip-logo.svg" alt="pinrip" height="130">
</p>

<br>

I hate downloading Pinterest images by hand. So I built pinrip.

Use a nice CLI command to download images from a page (pin, board, search,
profile) as full-resolution originals.

<img src="assets/pinrip-preview.webp" alt="A folder of full-res images ripped from a Pinterest board">

```
pinrip <pinterest-url>              # rip up to 50 images
pinrip use <folder>                 # sticky: all rips land there until "use off"
pinrip use                          # show the sticky folder
pinrip use off                      # back to folders named after the page
pinrip <url> --out <folder>         # one-off destination for this rip
pinrip <url> --limit 80             # different cap
pinrip <url> --allow-dupes          # re-download images already in the folder
pinrip <url> --headed               # watch the browser work

pinrip login                        # rip as yourself (see below)
pinrip status                       # which account pinrip rips as
pinrip logout                       # forget the session
```

Images land in `~/Downloads/pinterest-rip/<folder>/`, named by pin hash —
where `<folder>` is `--out`, else the sticky folder, else a slug of the page
title. Plain names live under `pinterest-rip/`; anything with a `/` is used as
a path. Images already in the destination folder are skipped, so ripping into
the same folder twice only adds what's new.

<img src="assets/pinrip-explainer.gif" alt="pinrip running in a terminal">

## Rip as yourself

Logged out, Pinterest serves a generic public feed — different images from the
ones you see while browsing, and it stops after ~25–30. Every rip prints which
of the two you're getting.

`pinrip login` borrows the Pinterest session from the browser you already use,
so the scraper sees the feed you do:

```
pinrip login                                 # auto-detect the browser
pinrip login --list                          # what it can borrow from
pinrip login --browser brave --profile "Profile 1"
```

It reads Chrome, Brave, Edge, Arc, Vivaldi, Opera and Chromium, on macOS and
Linux. Only `pinterest.com` cookies are copied, into `~/.pinrip/cookies.json`
(mode 600) — on macOS that raises one Keychain prompt for the browser's "Safe
Storage" key. Nothing is sent anywhere, and `pinrip logout` deletes it.

If you browse Pinterest somewhere pinrip can't read (Safari, Firefox, Windows),
`pinrip login --window` lets you log in by hand instead. Use your email and
password there — Google refuses OAuth in an automated browser. Either way the
session is checked against Pinterest before pinrip reports success.

## How it works

Headless Chromium (Playwright) opens the page and auto-scrolls, collecting
`i.pinimg.com` URLs as it goes — Pinterest virtualizes the DOM, so they have to
be read while scrolling. Each thumbnail (`236x/`, `736x/`, …) is then upgraded
to `/originals/`, with extension fallbacks.

Only the page's own pins are collected. Promoted pins and suggestion tiles look
like part of the grid but give themselves away by where they point — an ad links
off Pinterest, a suggestion links to a search — so pinrip sorts by the link
rather than the picture, and prints how many it skipped.

The saved session is re-applied at the start of every rip and written back
afterwards, so Pinterest's cookie rotation doesn't quietly expire it.

## Install

```
git clone https://github.com/JaimeOrtegaxyz/pinrip.git
cd pinrip
npm install
npx playwright install chromium
npm link        # puts `pinrip` on your PATH
```

`pinrip login` also uses the `sqlite3` CLI to read the browser's cookie
database — it ships with macOS and most Linux distros.

## License

MIT — see [LICENSE](LICENSE).

<br>

<img src="assets/pinrip-lattice.svg" alt="" width="100%">
