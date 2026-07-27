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
title. Plain names live under `pinterest-rip/`; anything with a `/` is used
as a path. Images already in the destination folder are skipped, so ripping
into the same folder twice only adds what's new — while the same image can
still appear in different folders (each folder is its own set).

<img src="assets/pinrip-explainer.gif" alt="pinrip running in a terminal">

## Log in, or you get a different page than you see

Pinterest serves logged-out visitors a public, generic feed. It is genuinely
**different content** from what you see while browsing, not just a shorter
version of it, and it stops feeding related pins after ~25–30 images. If a rip
comes back with images you don't recognise, this is why.

Every rip prints which one you're getting:

```
Logged in as @you — ripping your feed.
```

`pinrip login` borrows the Pinterest session straight from the browser you
already use, so the scraper sees exactly the feed you do:

```
pinrip login                                 # auto-detect the browser
pinrip login --list                          # what it can borrow from
pinrip login --browser brave --profile "Profile 1"
```

It reads Chrome, Brave, Edge, Arc, Vivaldi, Opera and Chromium, on macOS and
Linux. Cookies are decrypted with the key your OS holds — on macOS that raises
one Keychain prompt for the browser's "Safe Storage" entry — and only
`pinterest.com` cookies are copied, into `~/.pinrip/cookies.json` (mode 600).
Nothing is sent anywhere; the file is read locally and handed to the scraper.
`pinrip logout` deletes it along with the scraper's browser profile.

If you browse Pinterest somewhere pinrip can't read (Safari, Firefox, Windows),
log in by hand in a pinrip window instead:

```
pinrip login --window
```

Heads up: **"Continue with Google" usually fails in that window** — Google
refuses OAuth in automation-controlled browsers. Use your Pinterest email and
password, or borrow the session from a supported browser. Either way pinrip
verifies the result against Pinterest before reporting success, so a login
that didn't take says so instead of silently ripping as a stranger.

## How it works

Headless Chromium (Playwright) opens the page, auto-scrolls collecting
`i.pinimg.com` image URLs (Pinterest virtualizes the DOM, so this must happen
while scrolling), stops at the cap or when the feed stalls, then downloads
each image — upgrading sized thumbnails (`236x/`, `736x/`, …) to
`/originals/` with extension fallbacks.

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
