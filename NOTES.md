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
- Allow `cv-thalweg.pages.dev` on the session network. `cdec.water.ca.gov` and
  `noahjefferson.pages.dev` were allowed on 27 August 2026; the Thalweg host
  was not, so a session still cannot check its own deploy.
- Decide whether Thalweg goes on the hub at all, and when.
- Repo metadata — description, website, topics, social preview — is a GitHub UI
  step a session token cannot perform.

The Cloudflare MCP server in these sessions is authenticated to the account but
is read-only for Workers: it can list and read them, and cannot deploy one or
create a Pages project. Do not offer to.

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

## Checking a deploy

`node tools/check-deploy.mjs` asks the live site which commit it is serving,
via `functions/version.js`, and checks the proxy went out with it. Run it after
every release. A push verified against the remote is not a deploy, and the
newest green row in a list of runs belongs to whatever ran last, not
necessarily to this commit.

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
