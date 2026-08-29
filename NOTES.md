# NOTES — Cv-Thalweg

Working notes for this repo. `README.md` is what a reader needs; this is what a
session needs before it touches anything.

## State

- Version 0.1.0, on `main`.
- Not deployed yet. Not linked from the hub, and it must not be until the owner
  says so — that is his call and nobody else's.
- The proxy ships as a Pages Function at `/bathy`, so connecting Pages deploys
  it too. There is no separate Worker to stand up and no origin to paste.

## What only the owner can do

- Connect the repository to Cloudflare Pages: build command none, output
  directory `public`. That is the entire deploy.
- Add two repository secrets: `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID`. That is the whole setup. Pushing to `main` then
  creates the Pages project and deploys it; there is no dashboard step.
- Decide whether Thalweg goes on the hub at all, and when.
- Repo metadata — description, website, topics, social preview — is a GitHub UI
  step a session token cannot perform.

**Deploying is CI's job, not a session's.** This was got wrong once, at the
cost of three round trips asking for dashboard steps and network allowances
that were never needed. The pattern across these repos is a GitHub Actions
workflow holding two repo secrets, and the workflow creates the Pages project
itself — read `noahjefferson/.github/workflows/deploy.yml` before proposing
anything else.

Two things that look like they should help and do not. The Cloudflare MCP
server is authenticated to the account but read-only for Workers: it can list
and read them, and cannot deploy one or create a Pages project. And this
session's environment, "Admin Overhead", carries no Cloudflare credential and
cannot reach `api.cloudflare.com`, so a session cannot deploy by hand either —
every app here has its own environment, and this repo was worked from the
general one.

## The two things still unverified

Both hosts are unreachable from the network this was built on, and both are
handled in the app rather than assumed. Re-run `node tools/verify.mjs` from a
network that can reach them and the answer will be in the output.

- NOAA raster chart tiles, `tileservice.charts.noaa.gov`. The layer switches
  itself off with a message if the first tiles do not arrive.
- The CARTO dark basemap. The Layers panel names the host that did not answer.

## Things found by running it that would not have been found by reading it

Worth carrying to LESSONS in the hub; each cost real time here.

- **A rejected ArcGIS rendering rule is not an error.** It is HTTP 200,
  `image/png`, and about a hundred bytes of empty picture. Any probe built
  around `onerror` measures nothing, because the failure is indistinguishable
  from clear water. The only way to know a rule works is to run it and look at
  the bytes. An explicit `ColorRamp` object is silently ignored; only a named
  ramp applies.
- **`isFinite(null)` is `true`.** Every position in this app arrives from JSON
  where a missing value is null, and the loose test drew a gauge that had
  answered with nothing at latitude zero, in the Gulf of Guinea, coloured as
  though it had a temperature. "Is this a number" has to mean the type as well.
- **An Esri WKT can carry two UNIT declarations.** The horizontal one is inside
  PROJCS; a vertical coordinate system appended afterwards ends the string with
  the VERTICAL unit. Reading the last one in the whole string ran two surveys
  measured in feet through a metre conversion and put them in the Trinity Alps.
  Take the last UNIT inside PROJCS, not the last UNIT.
- **`[hidden]` loses to any class selector that sets `display`.** The update
  strip announced a new version on the very first load, before there was
  anything to update from, because `.strip{display:flex}` outranked the
  attribute. State the rule once, with `!important`.
- **A cache-first service worker will freeze a service directory.** The whole
  point of enumerating DWR's REST directory instead of listing layers in source
  is that a survey published next month appears without a redeploy — and
  caching that directory response first quietly undoes it. Cache-first belongs
  to finished things: a depth tile, a basemap tile. A directory and a query go
  network-first with the cache as the fallback.
- **Styling hung off an ARIA role reaches whatever later takes that role.**
  `[role=tabpanel]` carried the padding and scrolling meant for a panel of
  prose. When the map became a tabpanel under the breakpoint it inherited
  both, and sat inset eleven pixels on every side of a phone screen — small
  enough to read as deliberate. A role is a statement about meaning; using it
  as a style hook makes every future element of that meaning inherit a
  decision made for something else.
- **The furthest downstream gauge on a tidal river measures the tide.**
  Rio Vista was reading MINUS eighty-five thousand cubic feet a second while
  the river card was being built — a true measurement of a flooding tide
  pushing the Sacramento backwards, and no description at all of what the
  river is carrying. "How much water is coming down" has to come from the
  lowest gauge the tide does not reach, which is Verona. Where every gauge on
  a river is tidal, as all three of the Mokelumne's are, the card says the
  number is tidal rather than dressing it up as discharge.
- **A checker can stop checking without going red.** `tools/verify.mjs`
  reads `BATHY_PROXY` out of the app. When that became the same-origin
  `/bathy`, Node could not resolve it, and the DWR and worker groups failed
  with "Failed to parse URL" — never making a request at all. It went
  unnoticed for four commits because only `--only=` groups were being run in
  between. It resolves relative values against `--base` now, defaulting to
  production, which also means those groups exercise the DEPLOYED proxy
  rather than DWR directly.
- **Ask a service for more than it will serve and you get nothing.** Every
  one of the eighty-one single beam layers publishes `maxRecordCount: 2000`;
  the app was asking for 3000. It requests the lower of the two now, per
  layer, from the catalogue.
- **DWR's single beam service goes away under load, and that is not a bug
  here.** Queries that answered in the morning were timing out by the
  evening — including a count with no geometry at all — while metadata on the
  same service stayed instant. A check that calls that red cries wolf every
  time they are busy, so the verifier separates three outcomes: a parameter
  the service REFUSES is ours and fails; a timeout or a generic "error
  performing query" is theirs and is reported without failing. The app says
  whose it is on screen too, rather than printing a bare error.
- **A phone is not a narrow desktop, and the measurement said so.** On a
  667px screen this app gave its readings panel THIRTY-FOUR pixels, for
  1,546px of content. Three separate causes, and the one that got reported —
  the map — was the smallest of them: a header wrapping to three rows (117px),
  a ribbon drawn into a 1000-unit viewBox squeezed to 520 so half its height
  was dead space (174px), and a map at 46vh whether or not anyone wanted one.
  Measuring each region against the viewport found all three in one pass;
  fixing the reported one alone would have moved 34px to about 120px and felt
  like a fix.
- **A Leaflet tooltip is not panned into view and is not flipped.** It is
  drawn beside its marker and left there, so a pin near an edge puts its label
  outside the map frame, where the container's overflow cuts it off — and
  tapping the pin looks like it did nothing. On a phone, where the map is half
  a screen tall, most pins are near an edge. Popups auto-pan; tooltips never
  will. Reported from use, not found by any gate, and the gate that now covers
  it taps a pin at four edges and measures the label against the map's own
  rectangle.
- **A timestamp with no offset is not a timestamp.** CDEC publishes Pacific
  times with nothing to say so. Built in the device's zone they are right in
  California and wrong everywhere else, and this app's whole staleness promise
  rests on the reading time. Anchor to the named zone, and check both sides of
  a daylight-saving boundary.
- **A refused value must not move the clock.** The units check rejected a
  reading, and the reading time went on advancing past it — printing a
  timestamp newer than any value on screen. A fixture caught it; nothing about
  the live data would have.
- **A supplied list of "confirmed" layers was one-for-four.** Three of the four
  layer names handed over at the start no longer exist in that folder. The
  instruction not to trust the list was correct, and enumerating at runtime is
  what made it survivable rather than a day of debugging blank tiles.
- **Five identifiers flagged "probably wrong" were all right, and the one not
  flagged was wrong.** Recollection is not evidence in either direction; only
  the request settles it.
- **A NOAA subordinate tide station answers `interval=h` with an error.** It
  publishes highs and lows and nothing between. Drawing a curve through them
  would be inventing the water in between, so the app says what it has.
- **NWIS will not give you a coarser record, and the daily-values service
  cannot stand in for one.** The instantaneous service publishes every
  fifteen minutes and has no downsampling parameter, so a week of flow and
  temperature at one site is 55KB and at the Sacramento's six gauges 429KB —
  measured, in JSON; the tab-delimited `format=rdb` is 184KB for the same
  thing but returned an empty body for the Mokelumne's three sites, so it is
  not a safe substitute. The daily-values service (`nwis/dv`) is 29KB for
  thirty days across nine sites and looked like the answer: it publishes
  **nothing at all for water temperature at any of these sites**, and nothing
  for flow at Rio Vista or at the Mokelumne. The seven-day lines therefore
  ask one gauge for flow and one for temperature and no more.
- **A gauge that reports a value right now may publish no history for it.**
  Verona reports a water temperature and has no `00010` record over any
  window, so asking "the gauge the flow figure came from" left the
  Sacramento — the most instrumented reach in the state — with the words *no
  temperature history* on it. Whether a site publishes a week of a parameter
  cannot be known without asking, so two candidates go in the one request and
  whichever answers is drawn. Every Mokelumne gauge answers for now and
  publishes nothing over a week, which is a state the panel has to say out
  loud rather than render as a blank space.
- **The basin sweep found four gauges across four rivers, and three of the
  four sweeps returned nothing at all.** Measured 2026-08-29 before demoting
  it: the Sacramento gave up four — above the Delta Cross Channel, below
  Georgiana Slough, the Deep Water Ship Channel, below the Walnut Grove
  bridge — and the Feather, the American and the Mokelumne gave up none, on
  every visit, for 234KB and about nine seconds each. Those four are DECLARED
  now, read back off the service first, so they carry `verified` rather than
  `found` and do not depend on a sweep running to exist. The sweep itself is
  a button: it stays because a gauge can appear later, which is the whole
  reason this app enumerates at runtime instead of trusting a list, and what
  it finds is kept.
- **NOAA's station index is TWO MEGABYTES, it ignores every filter, and this
  app fetched it once per tidal river on every visit.** That was four of the
  5.56MB a first-time reader paid for the landing screen — to learn the
  position of four stations the app already names. The per-station endpoint
  (`mdapi/prod/webapi/stations/<id>.json`) is 2.6KB and carries the same name
  and coordinate, so the principle holds — no station position is typed into
  this app — at one eight-hundredth of the cost. The whole index is a button
  now, for looking at what else is nearby, and the result is kept.
  Two things that came with it: the per-station record spells names in CAPITALS
  where the index used title case, and the app prints the service's own name, so
  the case changed on screen; and a `.then(ok, fail)` pair does NOT catch a
  throw raised inside its own `ok` branch — that threw six unhandled rejections
  onto the page before a test said so.
- **A first load is now 1.09MB, from 5.56MB, and there is a gate on it.**
  `live-test.mjs` counts the bytes the landing pulls off the network and fails
  over a megabyte. That number is the only thing standing between this app and
  the next well-meant addition to a shared constant.
- **The bBox discovery sweep is the most expensive request this app makes,
  and adding a parameter to the shared constant silently made it worse.** One
  river's basin box returns **234KB in about nine and a half seconds** with
  the core three parameters; with turbidity and velocity added it is 354KB.
  Four of those fire on a cold open beside the declared-site requests, and the
  run where that happened had every gauge on every river read as not
  answering. Discovery exists to FIND gauges the app has not declared, so it
  carries `USGS_DISCOVER_PARAMS` — the three it needs to show one — while the
  named gauges get the full set for 34KB in ninety milliseconds. **The two
  request shapes have different jobs and must not share a constant.**
- **Velocity's sign convention is checked, not trusted.** Parameter 72255 is
  signed and negative means reverse flow, which on tidal water is the tide
  pushing in. Verified 2026-08-29: at all seven gauges publishing both, the
  velocity sign matched the discharge sign at the same timestamp. The app
  re-checks it per gauge and reports a disagreement as two instruments
  disagreeing rather than choosing one, because a disagreement at one
  instrument is not a fact about the river.
- **The second walk found the export was a worse copy of the thing it
  exported.** A mark kept from a depth reading is kept FOR the depth, and the
  GeoJSON carried `type`, `at`, `note` and `river` and none of it — the
  figure, the survey and the survey date all lived on the device and in
  nothing that left it. Exercising a control is not the same as reading the
  screen it sits on: the Marks panel showed the depth correctly the whole
  time. Two things the same walk did NOT find, having looked: the depth-ramp
  toggle tracks `aria-pressed` correctly (an earlier reading of `false` was a
  stale DOM node held across a panel re-render, not a defect), and the NOAA
  chart control removes itself and says why when its tiles do not return,
  which is the behaviour it was built for.
- **The app told a first-time reader the network had failed while every
  request was succeeding, and a walkthrough is what found it.** On a cold
  open the header read "Flow and temperature seconds old — network did not
  answer" in orange in the FIRST FRAME; the landing said "These are stored
  readings"; and the Sacramento panel said "Stored readings, seconds old. The
  network did not answer" directly above six gauges timestamped that minute.
  The diagnostic from the same load logged every gauge request `ok`. The
  cause: a payload marked `stale` by a later failed attempt while carrying
  readings fetched eight hundred milliseconds earlier. **Staleness is a
  question about the AGE of what is on screen, not about whether the last
  request succeeded** — the two were conflated and the conflation produced a
  confident lie in the app's own subject. The warning now needs the payload
  to be older than five minutes as well as unrefreshed.
  Two more of the same shape found in the same walk: the landing warning read
  `RIVERS[0]` and captioned all four rivers with one river's bad minute; and a
  river card whose own source had not answered said "no thermometer
  reporting" and "no flow reading", which describes a river with no
  instruments on it rather than a request that failed. The Feather's gauges
  are CDEC's and CDEC is the slowest of the four services, so that was its
  normal first few seconds.
- **A survey's bounding box is almost entirely land, so a single-pixel
  `identify` under a fingertip answers NoData nearly every time.** Of four
  hundred points sampled across the Sacramento survey's whole extent, ONE had
  a value: the surveyed water is a ribbon inside a rectangle thirty miles by
  forty-seven. `identify` is exact and right when it hits; when it misses,
  `getSamples` over a hundred metres square returns up to a hundred points
  with values and coordinates in about 16KB and half a second, and the
  nearest one is reported WITH ITS DISTANCE. NoData at a pixel means "not
  that pixel", never "no survey here", and printing the first as the second
  would be a lie in this app's own subject.
- **These rasters publish elevation against their own datum, so a positive
  reading is not a depth.** Walking west off the channel at 38.40061 N: −11.9
  at the line, −10.8 thirty metres west, NoData beyond sixty, and the nearest
  measured point to a tap a hundred and forty metres west is **+2.37**, which
  is farmland. Taking the absolute value would have sold two and a half feet
  of water on dry ground. It is labelled as bank instead.
- **WebKit runs here now, and it reproduces the defect Chromium cannot see.**
  `npx playwright install webkit && npx playwright install-deps webkit` — the
  download host and the system libraries both needed the network policy
  opened. Planting the original first-run markup and loading it under WebKit
  at an iPhone 13 viewport puts focus on the Start button, the panel body at
  scrollTop 813 of a maximum 813, and the panel's first paragraph 667 pixels
  ABOVE the top of the screen. Every Chromium check was green throughout.
  `tools/a11y.mjs` has a WebKit pass that SKIPS with the reason printed if
  the browser is absent, because whether a browser is installed is not a fact
  about the tree. One thing to know when reading its output: WebKit raises a
  blocked cross-origin fetch as a PAGE ERROR and Chromium does not, so in a
  sandbox with no browser egress that check has to ignore them or it reddens
  for the container rather than the app.
- **390 by 844 is an iPhone's SCREEN, not its viewport.** The page gets 390
  by 664; Safari's chrome takes the other 180px, and Playwright's device
  registry is the authority on that. The accessibility suite measured 844 for
  its whole life, and correcting it immediately found the ribbon taking 263px
  on every screen — 46% of an iPhone SE and, with the software keyboard up,
  72%, leaving the readings twenty-two pixels. That is the same failure that
  was found and fixed at 34px, back again because the fix had been measured
  against a phone 27% taller than the real one.
- **A `<dialog>` with no focus target of its own opens differently in the two
  engines, and the walk drives the one where it looks right.** With no
  `autofocus` the browser focuses the first focusable element it finds, and
  focusing something inside a scrolling container scrolls that container to it.
  Chromium treats a scrollable region as focusable in its own right, so it
  lands on the panel body at scroll zero; WebKit does not, so it takes the
  first tabbable element instead. The first-run panel's was the Start button at
  the very end, so on an iPhone it opened scrolled past everything it existed
  to say. Set the focus explicitly — a `tabindex="-1"` heading, focused after
  `showModal()` — and assert `activeElement` by name, which fails in both
  engines when nothing set it. (Hub LESSONS §175.)

## Scratch

Throwaway drivers — a browser script written to reproduce one bug — go in the
session scratchpad or `scratch/`, never the repo root. One was written there
and `git add -A` carried it into a release commit before anyone noticed.

## Checking a deploy

`npm run check:functions` compiles `functions/` the way Pages will. Run it
before a first deploy and after anything that changes an import: it is the only
local way to know that the mount can still reach `worker.js` outside its own
directory.


Node's own `fetch` ignores `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1`, and
reads it at startup, so it cannot be set from inside a script. Without it a
request to the live site comes back 403 carrying the proxy's own allowlist
message, which reads exactly like the host refusing us while `curl` returns 200
for the same URL in the same shell. `check-deploy.mjs` re-execs itself once
with the variable set; anything else here that reaches production needs the
same. (Hub LESSONS §173.)

`node tools/check-deploy.mjs` asks the live site which commit it is serving,
via `functions/version.js`, and checks the proxy went out with it. Run it after
every release. A push verified against the remote is not a deploy, and the
newest green row in a list of runs belongs to whatever ran last, not
necessarily to this commit.

## What CI runs, and what it deliberately does not

`.github/workflows/gates.yml` checks the hub out SHA-PINNED beside this repo
and runs the hub's own copies against `.` — never a fork of them. The pin is a
commit, not a branch: a gate that changes under you turns a red run into a
mystery, and bumping it is a deliberate act.

**`branch-guard.mjs --artefact`, never the plain check and never `--install`.**
The plain check asserts `.git/hooks/pre-commit` is installed, which is a fact
about one clone, and `actions/checkout` leaves `.git/hooks` empty by
definition; `--install` WRITES the tracked file and repairs the drift the step
exists to find. And note what was found adding it: **`--artefact` exits 0 when
the repo has no `.branch-guard` at all**, so the step would have been green
while checking nothing. This repo now declares `work=main` and the hook is a
tracked artefact.

**Two things the FIRST CI run found, both invisible on this machine.**
`npx playwright install` had nothing to run: this repo depends on
`playwright-core`, not `playwright`, and `--no-install` correctly refused to
fetch a package at run time. The core package carries the same install
command — `npx --no-install playwright-core install`. And every walk launched
Chromium with `executablePath:'/opt/pw-browsers/chromium'`, **a path that
exists on exactly one machine**: the suites could not have run on any runner
or any laptop. `tools/lib-browser.mjs` uses that path when it is there and
lets Playwright resolve its own download when it is not.

**The live suite is its own job and does not gate the merge.** It talks to
USGS, NOAA and DWR; when a public agency is having a bad morning that must not
read as this repo being broken. It is reported, not enforced.

## Fish counts: what exists and what it is worth

**Settled 2026-08-28 by fetching, not recalling.** SacPAS is reachable and has a
real query API — `/sacramento/data/php/rpt/*.php` with `outputFormat=csv`. Its
entire Adult Salmon section is GrandTab escapement (annual), carcass survey
detail (post-spawn), aerial redd counts, redd dewatering and weir overtopping.
**There is no daily in-season adult count for these rivers.** Not refused —
absent.

**And the trap in it.** The page most obviously named for the thing an angler
wants — "Red Bluff Daily Table" — is JUVENILE outmigration from rotary screw
traps: fry going down, fork lengths 27 to 43 mm, 211 daily rows this year and
current to within two days. Building from the name would have put a number on
screen that means the opposite of what a reader would take it for.

The one thing from SacPAS that IS in the app is the weir overtopping file,
12.8KB of daily CSV with `access-control-allow-origin: *`, which is a fact about
where the river is rather than a count of anything.


Asked for on 2026-08-27: a machine-readable hatchery or passage count for the
fall run. What was actually found, by fetching it rather than by recalling it.

**CDFW publishes GrandTab and it does not answer this question.** The
Anadromous Assessment page is reachable and links to it; the file is a 771KB
**PDF** of annual escapement estimates, published long after the season it
describes. Annual totals in a PDF cannot tell anyone whether the run is in
this week, which is the only version of the question worth asking.

**CDFW points at CalFish for the data itself.** Both `www.calfish.org` and
SacPAS answer 200 as of 2026-08-28, the allowlist having been opened; neither
has been explored yet, and nothing should be built against either until it
has been fetched and read.

**The source that would answer it is SacPAS** — Columbia Basin Research at the
University of Washington, `www.cbr.washington.edu/sacramento/` — which is said
to aggregate daily in-season hatchery returns and Red Bluff passage with a
queryable CSV interface. Its front page answers; **what it actually publishes,
in what format, and how current, is still unverified**. USFWS, USBR, NOAA
Fisheries and the CDFW ArcGIS host were refused when last tried.

**The line this does not cross.** A published count of fish that passed a
fixed structure is a measurement, in the same family as a gauge reading. It is
not a catch report and not a forecast, and showing one would not make this app
the thing it refuses to be. What would cross the line is inferring from a
count where anybody should fish.

## Owed

- CDEC is in, for the Feather only. If another river ever needs it, the
  proxy namespace and the parser are already general; what is river-specific
  is the `cdecGauges` list, which belongs in RIVERS like everything else.
- The final per-reach 2026 season dates, if the Department's May presentation
  is ever published. The reaches and their standing windows are read from the
  Commission's filings; the possibility that a reach was shortened is stated in
  the Brief rather than hidden.
- The hub's `doctrine-sync` wiring, a `.doctrine-sync` marker and the shared
  privacy and quote gates in CI. The gates pass when run by hand from the hub
  today; none of them is wired into a workflow here yet.
