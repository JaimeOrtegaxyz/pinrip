---
name: pinrip
description: Moodboard scout. Reads the project in the current folder, decides what a seasoned designer would go looking for on Pinterest for the thing you asked (logo, posters, packaging, onboarding illustrations, a whole visual world…), runs those searches with the pinrip CLI and files the images by direction in a named folder. Use on /pinrip, or when the user wants visual references, a moodboard, or Pinterest inspiration for a project. A bare Pinterest URL is just ripped.
argument-hint: [what to scout, e.g. logo · posters · packaging] [count, default 200]
---

# pinrip — moodboard scout

You are the designer's research hand. The user says what they need references
for; you read the project, decide the territories worth searching, run the
searches through `pinrip`, and hand back a folder they can open and think in.

Ask: `$ARGUMENTS`

## 1. Parse the ask

- **Subject** — what to scout: `logo`, `posters`, `packaging`, `empty states`,
  `type`, `a whole visual world`… anything after the command that isn't a
  number or destination.
- **Count** — a bare number, `80 refs`, `40 images`, `--limit 30`. Words:
  "a few / quick / handful" ≈ 30, "deep / exhaustive" ≈ 400. **Default 200.**
  Treat it as "at least about N", not exact.
- **Destination** — `into <folder>`, `--out <folder>`. Otherwise see §5.
- **Steering** — anything else is brief: "but warmer", "not Swiss", "for the
  README, not the app". Honour it.
- **A Pinterest URL** → not a moodboard. Just run
  `pinrip <url> [--limit N] [--out folder]` and report.
- **Nothing at all** → do §2 first, then ask one question: "What should I
  scout for <project>?" with 3–4 options tailored to what you read (e.g. for
  a CLI: *the whole visual world* · *logo & mark* · *README/site look* ·
  *typography*), plus the count. If you can't ask (non-interactive), scout the
  whole visual world.

Prereq: `command -v pinrip`. If missing, stop and give the install steps
(clone → `npm install` → `npx playwright install chromium` → `npm link`).

## 2. Read the project

Spend two minutes here; the brief depends on it. In the current folder, look
at whatever exists of: README / docs / landing copy, package or manifest,
design docs (PARTI.md, BRIEF*, brand/, design/), CSS tokens or theme, the
logo/assets (open the images), screenshots, the voice of the UI copy, git log
subject lines — and the conversation so far. Also `ls
~/Downloads/pinterest-rip/<project>/` for earlier scouting to build on rather
than repeat.

Write yourself a four-line read:
1. **What it is, for whom** — in plain words.
2. **Register** — era, temperature, seriousness, craft level, humour or none.
   Name it precisely ("Ulm-school sober", "zine-punk", "1970s NASA manual",
   "Muji-quiet", "Memphis-loud").
3. **What it already has** — existing marks, palettes, type, that references
   should sit beside, not fight.
4. **What it must not become** — the obvious wrong turn.

If the folder isn't a project (home dir, empty, unrelated), scout the subject
on its own terms; if the subject is too vague to do that, ask one question.

## 3. Write the brief — think like a designer, not a search box

Define **2–4 directions**. A direction is a territory a good art director
would name in a kickoff — a school, a lineage, an adjacent industry that
solved the same problem — with one line of *why it fits this project*, and
**2–4 searches** each. Do not settle for one obvious direction: the user wants
a catalog of possibilities, not a single vector.

Shape the set along more than one axis: **era** (interwar / postwar / 70s /
Y2K / now), **geography** (Swiss, Dutch, Japanese, Polish, Czech, Cuban,
Brazilian, Scandinavian design cultures each have distinct, well-pinned
corpora), **medium & technique** (letterpress, risograph, screenprint,
blind emboss, sign paint, engraving, CRT, plotter), **tone**. Include at least
one **lateral** direction from outside the obvious artifact class — for a
logo: hallmarks & maker's marks, cartographic symbols, railway heraldry,
pharmacy signage, bookplate monograms, cattle brands; for posters: matchbox
labels, protest print, record sleeves, scientific diagrams, wayfinding,
theatre bills; for UI: instrument panels, timetables, ledgers, field guides.

**How Pinterest search behaves**, and therefore how to word queries:
- It is a lay search over what people pinned. 2–5 words, noun-anchored on the
  artifact (`poster`, `logo`, `wordmark`, `monogram`, `book cover`,
  `packaging`, `signage`, `type specimen`, `editorial layout`, `title card`),
  plus one or two precise modifiers. No sentences, no quotes or operators, no
  negatives.
- Named movements, studios and designers work when they're heavily pinned
  (Müller-Brockmann, Vignelli, Crouwel, Aicher, Rand, Bass, Weingart, Karel
  Martens, Experimental Jetset, Studio Dumbar, Tadanori Yokoo, Ikko Tanaka,
  Bruno Munari, Olivetti, Braun, Penguin, Pentagram…). Obscure names return
  five pins and a page of padding — pair every sharp query with an anchor
  query that is sure to be populated.
- Per direction: one **anchor** (`swiss international style poster`), then
  **sharp** ones (`müller-brockmann tonhalle poster`, `wim crouwel stedelijk
  catalogue`, `letterpress wood type playbill`).
- At most one style adjective, and skip `minimal`, `geometric`, `modern`,
  `clean`, `best` altogether — they rank listicle covers and font promos
  above real work. Anchor on a subject noun instead: `crochet hook logo`,
  not `hook logo minimal geometric`.
- Never: generic adjectives alone (`modern logo`, `aesthetic`, `creative`),
  the project's own name, commas inside a query (commas split searches).

Reference is adjacent, not literal: look for people who solved a *similar*
problem beautifully, not for the thing itself. A moodboard for a Pinterest
downloader's logo is not "download icon" — it is marks about pulling,
collecting, pins, magpies, archives.

Worked example — this very repo (pinrip, a blunt one-word CLI that pulls
full-res images off Pinterest; sober-playful, monospace README, red pin
logo), ask `/pinrip logo`:
- *Postwar Swiss/German trademarks* — the register is that plain and exact.
  `swiss trademark 1960s`, `otl aicher pictogram`, `gerstner kutter logo`
- *Pin, hook, magpie: the gesture of taking* — the verb is the brand.
  `single line logo pin`, `magpie logo mark`, `hook logo minimal geometric`
- *Tool marks & hallmarks* — a CLI is a tool; tools get stamped.
  `hallmark maker's mark stamp`, `hardware brand logo 1950s`, `blacksmith touchmark`
- *Red one-word wordmarks* — sits beside the existing red pin.
  `red wordmark logo lowercase`, `monospace wordmark logo`

Show the brief before running: directions, the why-line, the queries, the
target. Then go — don't wait for approval unless the user asked to be asked.

## 4. Size it

- Target N (default 200). Count queries k across the brief — typically 8–12
  for 200, 4–6 for 50. Per-search cap: `limit = ceil(1.3 × N / k)`, clamped
  to 8…60.
- Logged out, Pinterest's public feed dries up around 25–30 per search; more
  queries beat a bigger cap. `test -f ~/.pinrip/cookies.json` is a cheap
  hint; the rip itself prints `Logged in as …` or `Not logged in`.
- Logged in, a search fills a cap of 10–30 in seconds; logged out, budget
  about a minute per search. Say roughly how long before starting.

## 5. Run

- Root: `~/Downloads/pinterest-rip/<project-slug>/<subject-slug>/`, unless the
  ask names a destination (`--out` semantics: a plain name goes under
  `pinterest-rip/`, anything with `/` is a path). Each direction gets its own
  subfolder `NN-<direction-slug>/`, so the moodboard is browsable by idea.
  Re-scouting the same subject adds to the same folders (pinrip skips images
  already there) and new directions get new folders.
- One `pinrip` call per direction, **sequential** (they share a browser
  profile — never run two at once):

  ```
  pinrip "anchor query, sharp query, sharp query" --limit <cap> --out "<root>/01-<dir>" 2>&1 | tee -a "<root>/rip.log"
  ```

  Give the call a long timeout (10 min); if the harness can't, run it in the
  background and poll the log. Keep ≤4 queries per call.
- Read each `Done: X/Y saved … → <folder>` line. When every direction has
  run, sum them. If the total is under 0.85 × N, do a **top-up**: 3–5 fresh
  queries — same territories that yielded best, or a lateral fourth — into
  the same folders. At most two top-ups; then report the honest number.
- Write `<root>/BRIEF.md` (append if it exists): date, the four-line read,
  each direction with its why-line, its queries and how many it yielded, the
  total vs. target. That file is what makes the folder a moodboard rather
  than a pile.

## 6. Report

Short. The read in two lines; a table of directions with count and folder;
total vs. target; the root path; one line about the session if it ran logged
out (`pinrip login` gets the real feed and more per search) — once, not
naggy. On macOS finish with `open "<root>"` so it's on screen. Then offer the
obvious follow-ups: more of one direction, swap a direction, go warmer/older/
louder — a follow-up reuses the same root.

Don't paste rip logs. Don't apologise for Pinterest being Pinterest.
