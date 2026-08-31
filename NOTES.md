# NOTES — Cv-Thalweg

Working notes for this repo. `README.md` is what a reader needs; this is what a
session needs before it touches anything.

## State

- Version 1.6.0 on `staging`. **Production is 1.1.0** and stays there until a
  promote — these are two numbers on purpose, and writing one of them here
  covering both is how a handoff comes to name a build nobody can open.
- Staged candidate: **1.6.0** at https://staging.cv-thalweg.pages.dev — the
  ribbon's rows open their river, as real buttons laid over the drawing.
- **Live at https://cv-thalweg.pages.dev, and linked from the hub** — added on
  the owner's instruction, which is the only way an app reaches that page.
- The proxy ships as a Pages Function at `/bathy`, so connecting Pages deploys
  it too. There is no separate Worker to stand up and no origin to paste.

## Branches — `staging` first, `main` on a promote

**This changed on 2026-08-29 and the old shape is worth knowing.** The repo ran
on `main` alone for its whole life, because when that was decided it was three
days old, not deployed and not linked anywhere: there was nothing for a staging
gate to protect. Both halves of that stopped being true the day it went on the
hub, and a push then landed straight on the address the owner opens.

- Work lands on **`staging`**, which deploys to
  https://staging.cv-thalweg.pages.dev.
- It waits there for the **on-device pass** — this app is read one-handed on a
  riverbank, and every defect found in its first week was one that appears only
  on the real device: a first-run panel opening at its own last line, readings
  squeezed to 22px with a keyboard up, a dialog that focuses differently under
  WebKit than under Chromium. None of those is visible from a desktop browser,
  and none of them was caught by a test.
- **`main` is production** and is reached by an explicit promote:
  `THALWEG_PROMOTE=1` past the branch guard, which otherwise refuses the commit.
- The harness may name a `claude/*` branch for this repo. It does not apply;
  `.branch-guard` is what decides, and it says `staging`.

The deploy workflow verifies the site it actually deployed to rather than always
asking production — a staging push checked against `cv-thalweg.pages.dev` would
read the previous production commit and either fail for the wrong reason or, on
a promote, pass for the wrong reason.

## What only the owner can do

- Connect the repository to Cloudflare Pages: build command none, output
  directory `public`. That is the entire deploy.
- Add two repository secrets: `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID`. That is the whole setup. Pushing then creates the
  Pages project and deploys it; there is no dashboard step. **Both are set** —
  the site is live. A `staging` push produces its preview URL with no extra
  Cloudflare step, because Pages gives every non-production branch one; hub
  LESSONS §7c is the caveat, and it is already satisfied here since `main` has
  deployed many times.
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

- **`role="img"` prunes everything inside it from the accessibility tree.** The
  ribbon's rows were made pressable by putting focusable rects with
  `role="button"` into the SVG — correct-looking markup that no screen reader
  could ever reach, because the figure is a `role="img"` with a written
  description and that role removes its subtree. axe reported it as
  `nested-interactive`; the real cost was not untidiness but four controls that
  did not exist for anyone not using a mouse. The controls are HTML buttons
  laid over the drawing now, and the picture stays a picture.
- **An SVG element has no `offsetTop`.** `offsetTop` and `offsetLeft` are
  `HTMLElement` properties and are `undefined` on an SVG, so positioning the
  overlay from them produced the string `"undefinedpx"`, which the browser
  discarded silently — leaving four full-width buttons three hundred pixels
  down the page, over the map. **Three of the four still opened a river when a
  test clicked their own bounding boxes**, because a button in the wrong place
  is still a button: driving an element by its own geometry can never tell you
  the geometry is wrong. The check that catches it compares the button's box
  against the BAR IT IS FOR, in the drawing.
- **A test block that drives the river picker has to put the river back.** The
  row-pressing checks left the app on the Mokelumne and the next unrelated
  check, written against the Sacramento, failed with a null dereference forty
  lines later. A suite that leaves state behind hands its mess to whatever runs
  next, and the failure surfaces nowhere near the cause.

- **A panel that explains itself before it does anything is one nobody reaches
  the bottom of.** Every section of the Depth tab was a heading, then two or
  three paragraphs of what the thing is and where its data came from, and only
  then the control. Measured on a 900px window: 1,277 characters of prose stood
  between the top of the panel and "Read the depth at the map centre", which
  sat 733px down a 661px panel — off the screen. **Each paragraph was written
  for a good reason and the sum of them was a defect**, which is why no single
  review of any one section would ever have found it.
  The fix is order, not deletion: control first, the one line that answers
  "why is there nothing here" beside it, everything else behind a summary
  saying what it holds. 1,277 characters became 265 and nothing was cut.
  **The gate is a budget on VISIBLE prose before the last primary control** —
  text inside a closed fold does not count — plus a check that every long
  sentence is still somewhere in the panel, because a shorter panel achieved by
  dropping provenance would pass a length budget perfectly.
- **`compareDocumentPosition` returns PRECEDING for the argument, not the
  receiver.** `el.compareDocumentPosition(node) & DOCUMENT_POSITION_PRECEDING`
  is true when NODE comes before EL. Read the other way round it counts
  everything after the element instead of before it, and the first version of
  the budget check measured 2,280 characters where the honest answer was 265 —
  a number that looked like a catastrophic failure and was a reversed test.

- **Four stacked bars drawn to four different scales.** Each river's bar was
  stretched to the full width whatever distance it spanned, so the Sacramento's
  265 km and the American's thirty looked identical. **The reason bars are
  stacked is to be compared**, and equal lengths are a claim — that the rivers
  are the same length — made silently by the layout rather than by anything
  anyone wrote. They share one distance scale now, and the caption says so.
  The floor for a short bar is deliberately about what one dot needs and no
  more: a minimum wide enough to look tidy overstates the length of every short
  river, which is the defect being fixed.
- **A key that is clipped is a key that does not exist, and is worse than
  none.** The cyan tidal wash had a swatch. It was drawn 26 px below a
  temperature ramp that already sits 26 px above the bottom edge, putting it
  exactly on the viewBox boundary — off the drawing, on every screen, since the
  day it was written. Nobody had ever seen it, and the reader's report was that
  the colour band had no legend, which was exactly right. **Its presence in the
  source answered "have we explained this" for every session afterwards.** Same
  family as the skip link that was never reachable: built, correct, invisible.
  Gated now by a check that walks every drawn element's bounding box and
  requires it inside the picture.
- **A caption with nothing to point at names nothing.** "tide is predicted
  about this far up" sat under a fade with no mark, and when it ran up against
  the right-hand edge it was anchored to the end of the bar — where it read as
  labelling the end of the RIVER. A mark and a leader are what make a caption
  refer to something; without them it is a sentence floating over a picture.
  The fade was the second half of it: fading to nothing over a channel that is
  nearly the page's own background reads as decoration rather than as a region
  with an end.

- **Every pin was 11 to 19 pixels wide, and a miss was not inert.** Measured by
  walking out from each centre and asking the document what was on top: 13 px
  for an access site, 11 for an idle tide station, 19 for the live one, against
  a 44 px floor. That alone is fiddliness. What made it a report was that the
  map's own handler ran on the miss and answered with a DEPTH — so pressing a
  circle labelled "places I can go" produced a depth reading, and the circles
  read as decoration. **A miss that produces a confident answer is worse than a
  miss that produces nothing**, because nothing invites a second try and an
  answer ends the question.
  The fix is not a bigger circle: a 44 px transparent disc under sixty tide
  stations and thirty access sites blankets a zoomed-out map and the depth tap
  stops working. The tap is resolved in code — nearest pin within a finger's
  width wins, and NEAREST is better than whichever transparent disc painted
  last.
- **Three separate things stopped the map going where it was told, and each
  looked exactly like the last.** They were found one behind the other, by one
  failing check, and each fix revealed the next.
  An open popup tethers the map: Leaflet re-pans to keep it in view on any view
  reset, so pressing a pin and then a go-there button arrived and was hauled
  back to the pin. `animate: true` disables Leaflet's own refusal to animate a
  pan longer than the window — its source says the tiles are lost and the map
  lands wrong — so a long jump asked for a smooth pan of hundreds of thousands
  of pixels and simply did not move. And a fetch started by an earlier press
  fitted the map when it landed, over the top of wherever the reader had gone
  since.
  **The common shape: the view is not a variable, it is a conversation, and the
  reader's last word has to win.** The claim counter is a counter and not a
  clock on purpose — a time window has to guess how slow the signal is.
- **Seven view changes bypassed the one function that guards them.** Every
  go-there button called `state.map.setView` directly, so none of them got the
  deferral guard for a hidden map or the animation guard above. A guard in a
  helper protects only the callers that go through the helper, and nothing had
  ever said they must.

- **A finger is wider than the river.** Every depth this app has is measured on
  the water, and a tap that lands twenty metres onto the bank is answered
  correctly and uselessly: nothing was surveyed there, because nothing is
  surveyed on dry land. The reader reads that as the app failing to find a
  depth it should have. So a tap is now snapped to the nearest point on the
  baked centreline before anything is queried, and **the displacement is said
  out loud every time it is not zero** — otherwise the app is quietly answering
  a different question from the one that was asked, which is the shape of
  defect that is impossible to notice and impossible to trust once noticed.
  Three bands: inside 120 m the tap is taken as given, out to 1,500 m it is
  moved and the move is stated, and beyond that it is not a question about the
  river at all and is refused with a way to get to the surveyed water.
- **A snap message written as a branch swallows the outcome underneath it.**
  The first version returned the displacement sentence *instead of* the reason
  there was no reading, so a tap 300 m off unsurveyed water said only that it
  had been moved. It is a prefix, not an outcome.

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
- **The suite had the same defect the app was fixed for: it asserted an
  absence before the request finished.** `the Mokelumne has no published
  history and says so` went red on a CI runner and green here, for the third
  time in this project's short life. `state.trends.mokelumne` was still
  undefined at the moment of the check, so every field read false and it
  reported an absence nothing had established. The cause was a fixed
  `waitForTimeout(22000)` — **a fixed wait is an assertion that the network is
  as fast as the machine the test was written on.** `waitFor(page, fn, what)`
  polls for the STATE and says out loud when it gives up.
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
- **And then the per-station requests went too, because the whole list is baked
  in.** `tools/fetch-stations.mjs` asks NOAA once, at build time, and writes
  `public/tide-stations.js` — 61 stations inside the two tidal rivers' boxes,
  5.4KB, precached. The rule that no station coordinate is typed into this app
  by hand is unchanged; these are still NOAA's numbers fetched from NOAA. What
  moved is WHEN. On a normal load the app now makes no station requests at all.
  Three things worth knowing before touching it:
  **The endpoint matters more than it looks.** `stations.json` alone returns 301
  primary stations — 3 on the Sacramento, 0 on the Mokelumne. The app's own
  `COOPS_MD` carries `?type=tidepredictions&units=english`, which is what returns
  the subordinate stations too: 61 here. The generator reads that URL out of
  `public/index.html` rather than repeating it, and `--check` fails if they
  differ, because the bake and the button must be looking at the same list or
  the button reports additions that were only ever a different query.
  **The generator reads the rivers by evaluating the declaration, not by regex.**
  A pattern over `var RIVERS` found two of the four and got their `tidal` flags
  wrong, silently. It now takes the balanced brackets and runs them.
  **A cap applied across two populations hides the smaller one.** The picker kept
  the nearest ten; once 44 baked stations existed, anything the button found was
  ranked out by distance before it could be offered — the one thing the button
  exists to surface. Rows carry an `origin` now, and a new one is never capped.
- **The station bake has its own workflow and its own gate.** `stations.yml`
  runs on dispatch and monthly, regenerates the file and commits only that file
  to `staging`; the gates job runs `--check`, which asks NOAA nothing and only
  refuses a bake that is absent, undated, from the wrong endpoint, missing a
  tidal river, or carrying a station with no position. Fetching and checking are
  separate on purpose: a gate that reached NOAA would put a public agency's
  uptime inside this repo's verdict.
- **AN ANSWER THAT IS NOT THE ANSWER HAS TO SAY FOUR THINGS**, and all four of
  this app's did only the first: what happened, whether the reader did anything
  wrong, what would otherwise have happened, and what to do now. Tapping water
  the state has never surveyed returned a sentence about weed defeating a
  sounder — true, and it left a reader unable to tell whether they had made a
  mistake, whether it would ever work, or where to tap instead. All four
  outcomes carry the shape now, the spoken line carries it too (somebody reading
  by ear gets that sentence and nothing else), and the "nowhere" case offers the
  button that takes them to water where it works.
  The suite drives every branch by calling `depthNode` with each result shape
  rather than trusting that the one somebody happened to photograph got fixed.
  It also caught the grammar: "One survey covers this point and none of them has
  a reading here".
- **THE LIMITS BELONG TO THE APP, NOT TO A RELEASE.** The what-changed dialog
  showed `broken` only when the current version declared one, so 1.1.0 — which
  added no new caveat — told a reader by omission that the app had none.
  Requiring every release to restate them would make the notes repetitive and
  the honest part would get skimmed. It shows the most recently declared list,
  whether or not this version added to it.
- **A VIEW COMPUTED AGAINST A ZERO-SIZE MAP IS THE WHOLE WORLD.** On a phone
  the map lives in a tab, so most of the time its container is `display:none`
  and measures 0 by 0 — and `fitBounds` in that state does exactly what it is
  told: it finds the zoom at which those bounds fit into nothing, which is zoom
  0. Reported from a real phone and reproduced immediately: on All rivers the
  map genuinely sat at zoom 0. Everything that moves the map now goes through
  `mapView()`, which HOLDS a view while the container has no size and applies it
  from `mapBecameVisible()`. Holding it exposed the other half: a Leaflet map
  with no view at all throws "Set map center and zoom first" the moment anything
  asks for a centre, so the map opens on a derived view — the middle of the four
  declared rivers at the most zoomed-out of their own declared zooms — which is
  replaced the instant the map is real.
- **A THIN DASHED LINE OVER SATELLITE IMAGERY IS NOT A LINE.** "It does not show
  the river line, just a bunch of dots." The profiled line was 2px dashed among
  sixty pins on a photograph. It is a bright stroke over a dark casing now, the
  way a route is drawn on imagery, and the key names it.
- **A COLOUR THAT MEANS SOMETHING NEEDS A KEY AS MUCH AS THE TEMPERATURE RAMP
  DOES.** Part of each tidal river's ribbon bar is washed in cyan to show how far
  the tide reaches, and there was no legend for it anywhere — three bars tinted
  differently with nothing saying why. The scale now carries a swatch.
- **A CLAIM WITH A DATE ON IT LIVED FOR FIFTEEN RELEASES.** The first-run page
  said "This is the first release" from 0.1.0 to 1.0.0. Nothing checked it,
  because nothing could: it is a true sentence that quietly expires. A sentence
  about which release this is has to come FROM the release or not be said, and
  the accessibility suite now refuses that phrase outright. Same family as the
  version stamp that could lie (0.2.1) and the doctrine sentence that said all
  four palettes cleared every floor (hub LESSONS 186).
- **THE DOOR WAS LABELLED WRONG, AND FOUR ROUNDS WERE SPENT REARRANGING THE
  ROOM.** "Where is the depth", "I do not see where the depth is at", "not of
  the whole river", "where do I find depth profiles" — each time the fix was
  inside `panel-layers`: outlines drawn, a go-to button, depth moved above the
  basemap, the profile given a heading. All of them were improvements and none
  of them was the cause. The tab was called **Layers**, which is a mapping term
  for a panel that is entirely about the bottom. It is called **Depth** now.
  The general form, and it is worth carrying to the other apps: when somebody
  cannot find a feature, check the WORD ON THE CONTROL THAT LEADS TO IT before
  touching what is behind it. A panel can be reorganised indefinitely without
  ever fixing a label. Four rounds is the measurement.
  The ids stay `tab-layers`/`panel-layers` — they are internal, and renaming
  them would have churned the suites for nothing a reader can see.
- **THE TIP LINK IS IN THE (i) AND NOWHERE ELSE, ON PURPOSE.** A prompt for
  money has no business competing with reading the water on a riverbank, so it
  lives in the panel somebody opens when they want to know about the app. It is
  a link and nothing else: no counter, no total, no tier, no thank-you, and the
  copy says outright that nothing about the app differs whether you use it or
  not. `tools/a11y.mjs` asserts all of that — that it is in the (i), that it is
  not on the working surface, that it is 44px through, that a `target=_blank`
  carries `noopener`, and that the section contains no supporter count, goal,
  total or plea.
  The address is a paypal.me handle rather than an email: an email in a public
  repo under the owner's name gets scraped, and a handle takes payments without
  publishing one. Venmo sits beside it — same coffee, whichever route is less trouble.
- **THERE IS NO PUBLISHED BOAT-RAMP DATASET FOR THESE RIVERS**, and the app does
  not invent one. The state's open-data portal returns nothing for boating
  facilities, boat launch ramps or DBW; the one "Public Access Points" service
  is coastal beaches — 1,500 across the coastal counties and ZERO inside any of
  the four river boxes, which was checked rather than assumed. What CDFW does
  publish is its own lands, and `tools/fetch-access.mjs` bakes those.
- **A BOUNDING BOX CANNOT SAY WHICH RIVER A PLACE IS ON.** Every one of these
  boxes is hundreds of kilometres across, so a property only has to clip a
  corner to be listed — which filed the Yolo Bypass Wildlife Area under the
  AMERICAN and two Yuba County properties under the Feather. The centreline was
  already baked in, so the question is asked properly now: distance from that
  river's own course, 12 km, and the distance travels with each site because it
  is worth showing. 93 sites became 46, and the 47 dropped were right to drop.
  The generator REFUSES to run without `public/river-lines.js` rather than
  falling back to the box.
- **A CENTROID IS THE MIDDLE OF A PROPERTY, NOT A PLACE ON THE BANK.** That is
  what these positions are, so the app says so in the popup and in the panel,
  and shows the distance to the water beside every one.
- **THE WALK ITSELF WAS BROKEN AND PHOTOGRAPHED A BLANK PAGE.**
  `--proxy-bypass-list=<-loopback>` does the OPPOSITE of what it reads like:
  Chromium already bypasses loopback, and that token TURNS THAT OFF, so the
  local server was never reached. The walk produced screenshots and prose for a
  page with no title and no header, and reported no error. It refuses to walk
  now if the river picker is not on the page — a walk of a blank page is worse
  than no walk, because it looks like findings.
- **DEPTH WAS BELOW A PREFERENCE.** The Layers panel opened with three basemap
  radio buttons and two orange warning boxes, so somebody looking for the bottom
  met all of that first. Depth leads; the basemap chooser is appended last, from
  one function called at each of the panel's three exits.
- **"seconds old — network did not answer" is two claims that cannot both be
  true.** A reply that arrives carrying no readings still stamps `fetchedAt`
  with the moment it arrived, so the header was quoting the age of the ATTEMPT
  next to a statement that nothing had answered. An age is only printed when
  there is a reading to be that old.
- **"tide to SACRAMENTO, SACRAMENTO RIVER"** — a station's name is a place and a
  river with a comma in it, so bolting it onto "tide to" produced a caption that
  parses as nowhere. The mark says how far up the tide is predicted to reach;
  the station's name belongs in the tide panel where there is room to say whose
  it is.
- **"I DO NOT SEE WHERE THE DEPTH IS AT" WAS A CORRECT READING OF THE MAP.**
  The surveys are a few reaches of hundreds of kilometres, the app opens on the
  whole basin, and nothing marked them. They are drawn as dashed outlines in a
  pane BELOW the readings and non-interactive, they are in the key, and there is
  one button that fits the map to them. Three defects came out of building it:
  `drawSurveyBoxes` called `catalogFor`, which reads fields the catalogue does
  not have while it is still loading, so it threw inside `selectRiver` and took
  the whole river change down with it — a drawing function must not need more of
  the data than it draws. The survey box is `{n,s,e,w}` and I wrote
  `{ymin,xmin,…}`, which Leaflet reported as "Invalid LatLng" seven times before
  the suite's own page-error check caught it. And the first assertion said the
  map "zoomed in", which is only true when you happen to be zoomed out — it
  failed the moment an earlier check left the map close over the river, which is
  exactly when a reader would press it. The property is that you can see the
  surveyed water, not that the number got smaller.
- **A CROSS-SECTION IS PERPENDICULAR TO THE RIVER.** The old control drew a line
  between the left and right edges of the screen, which at the zoom this app
  opens on is a line across the state. With the centreline baked in it takes the
  local bearing at the nearest point on the river and cuts across it. The
  perpendicular has to be computed in METRES, not degrees — longitude is
  squeezed by latitude and a degree-space normal comes out skewed.
- **39 KB PARSED AT BOOT FOR A FEATURE MOST READERS NEVER USE.** `river-lines.js`
  was a `<script>` in the head, so every open paid for the whole main stem of
  four rivers before the map appeared. It is loaded on first use now and still
  precached, so it is a read from the device and works offline. The controls are
  offered whether or not it has loaded — deciding from whether it happens to be
  in memory would hide them on a cold open and show them on a warm one.
- **THE CENTRELINES ARE BAKED IN NOW — `tools/fetch-centrelines.mjs`.**
  **NHDPlus High Resolution, not `nhd`.** Both publish flowlines; only NHDPlus
  carries what turns a heap of segments into a line. `nhd` layer 6 returns 2,848
  features in one tight box near Rio Vista with nothing to order them by.
  NHDPlus layer 3 carries `levelpathi` (which main stem a segment belongs to)
  and `pathlength` (how far its downstream end is from the outlet), which answer
  both questions at once. The Sacramento is 917 segments under its own name, of
  which 719 share one levelpath and run 598 km; the rest are side channels
  carrying the same name.
  **A LINE THAT TELEPORTS IS NOT A RIVER.** The Mokelumne returned all 326 of
  its segments under one levelpath with a 12.4 km jump in the middle — it forks
  in the Delta and both channels carry the name. No single attribute shows that;
  what shows it is the join being impossible. The chain is cut wherever a join
  exceeds 800 m and the longest continuous run ships, with what was dropped
  reported rather than silently lost.
  **AND THE BBOX CLIP WAS THE SAME DEFECT IN MY OWN CODE.** Filtering points to
  the app's box saved a few kilobytes and joined the survivors straight across
  every bend where the river left the box and came back — a 2.5 km chord on the
  Mokelumne. The whole main stem ships instead: 38.5 KB for four rivers.
  **Profiling the river gives the longest SURVEYED stretch**, because depth only
  exists where the state measured; ninety samples over 598 km would be six
  kilometres apart and nearly all of them on water nobody has sounded. The
  drawing says which stretch it used.
  The reader's own line still works and is still the answer for a cross-section:
  down the channel a long profile, bank to bank a cross-section, same code.
  **One request per survey, not one per sample.** `getSamples` takes a POLYLINE
  and returns the samples ordered along it; measured against the live
  ImageServer before a line of this was written, because a geometry ArcGIS does
  not understand comes back HTTP 200 with an empty answer rather than an error.
  Eighty samples down three miles of the Sacramento is one call.
  Two things the build turned up. `svg.innerHTML = ''` DELETES the `<title>`
  that names a `role="img"`, so the drawing lost its accessible name on every
  render after the first — it is rebuilt with the picture now. And a control in
  the Layers panel that draws into the map panel is invisible on a phone, where
  the map is its own tab; it switches tabs, the same move the depth-at-centre
  button already made.
- **A STORED ANSWER BELONGS TO THE BUILD THAT ASKED IT.** Before the stations
  were baked in, the discovery button stored every station in the river's box.
  After the bake shipped, that list was read back under the new question and
  reported "NOAA had added 44 station(s) since this version was built" —
  forty-four being the number that ship with it. Not stale, wrong: the meaning
  of the stored value changed underneath it. It carries `against`, the bake's
  own `fetchedAt`, and an answer from another build is ignored rather than
  reinterpreted.
- **THE STRANGER'S WALK — `tools/walk.mjs`, and it must never become a gate.**
  It opens the app on a phone, walks every surface in the order a newcomer meets
  them, and writes out a picture and the visible words of each. A gate asks a
  question it already knows how to ask; this asks the one no assertion can hold,
  which is what somebody who has been told nothing would think a screen means.
  Run it from time to time, not on every commit. A live walk needs the browser
  pointed at this container's egress proxy with loopback bypassed — without
  that, every service fails and the walk describes an app full of "did not
  answer", which is a finding about the container.
- **`display:flex` on `dialog` broke every dialog in the app.** A bare rule
  overrides the browser's own `display:none` for a CLOSED dialog, so dismissing
  one left it on screen. It is `dialog[open]` now. One line of layout, every
  dialog.
- **And `vh` is the wrong unit for a dialog on a phone** — it is measured
  against the viewport with the address bar hidden, so 70vh is more than 70% of
  what a reader can see (LESSONS 176). `dvh`, with `vh` first as the fallback.
- **EVERY INTERACTIVE CONTROL ADDED TO THE MAP NEEDS
  `L.DomEvent.disableClickPropagation`, and this has now been learned twice.** A
  control sits ON the map, so a press on it is also a press on the map, and a
  press on this map asks the survey how deep it is there. The locate button hit
  it first; the legend hit it the moment it stopped being a passive swatch and
  grew a Hide button. Both times the render suite caught it by finding a depth
  popup open over the control.
  **AND disableClickPropagation IS NOT ENOUGH ON TOUCH.** It holds for a mouse
  and not for a finger, because on a touch device the map's click is synthesised
  from the touch sequence and arrives anyway. Every desktop check passed for two
  releases. The guard is now one capture-phase listener on the map container
  that marks any event whose target sits inside a `.leaflet-control` — capture,
  because a control's own handler often rebuilds its contents (the key does),
  which DETACHES the clicked element, so by the time the map's handler asks the
  target for its ancestors there are none and the press looks like open map.
  There is a touch-context block in `tools/a11y.mjs` that taps every control,
  and asserts the open map still answers a tap.
- **And a key is information, not a target.** The first version covered pins and
  made them untappable — caught by the marker-at-the-edge check, which simply
  stopped opening. `.legend` is `pointer-events:none` with its buttons set back
  to `auto`, so swatches and words let every tap through and only the two
  buttons take one. There is a check that pans a gauge underneath the key and
  taps it there.
- **A suite that runs offline must not assert a row that needs an upstream.**
  The first a11y check for the key demanded a gauge row; `tools/a11y.mjs` runs
  against a local server with no gauge data, so it went red on an absence that
  was correct. It asserts the invariant instead — the key names everything drawn
  and nothing that is not — with the tide stations as the offline case, since
  those come from the baked file. Same defect as LESSONS 185, in a new place.
- **Patch notes are gated now, and the gate exists because prose lost.** Four
  releases in a row explained the mechanism instead of the change: a bounding
  box, a two-megabyte endpoint, a request per station. All true, none of it what
  somebody who just pressed Update wants. `tools/notes-check.mjs` holds every
  note to a closed vocabulary of machinery words, with a `.notes-allow` for a
  declared exception checked both ways, and refuses a version bump whose newest
  note is for an older version. Seen red on three planted violations before it
  was trusted. It runs in CI and on every commit via `.branch-guard`'s `also=`.
- **The what-changed dialog opened the About panel at its top**, which is "What
  Thalweg is" — so a reader who had just pressed Update found the one thing they
  asked for several screens down, under everything they already knew. It is its
  own dialog now, leading with this version's notes and offering the history
  rather than serving it. It had been wired at boot with no check on it at all;
  it now has six, plus an axe pass in both geometries.
- **0.1.0's release notes had ten known issues filed as changes.** The renderer
  had supported a `broken` field the whole time and nothing used it, so "what is
  still not right" rendered as though it were new work. They are in the right
  field now.
- **The locate control taught two things worth keeping.** First, a control that
  sits on the map is also a press ON the map, and a press on the map asks the
  survey how deep it is there — without `L.DomEvent.disableClickPropagation` the
  button would have dropped a depth reading under itself on every use. Second,
  an accuracy of zero is not perfect precision, it is the same absence as a
  missing field: the first version stored it as a number and the dot read "good
  to about 0 m", the most confident lie the app could tell. The guard lives in
  the drawing function as well as where the fix is stored, because the drawing
  function is the one making the claim.
- **"The position never leaves the device" was too strong, and a test caught
  it.** No request carries the coordinate — that is asserted, by pattern, over
  every request the press causes. But moving the map to you loads basemap tiles
  for that area, so something does go out, and at zoom 14 a tile is a couple of
  kilometres. The About panel says so. The assertion that matters is the narrow
  one: no coordinate in any path, query or body, and nothing but tiles.
- **This repo carried two `zizmor: ignore[...]` declarations and never ran
  zizmor.** The suppressions were written into `deploy.yml` and `stations.yml`
  in the belief the audit was wired; it was not, so nothing was suppressing
  anything and nothing was auditing anything either. `gates.yml` now passes
  `zizmor: true` to the hub's reusable workflow, which installs it at the hub's
  pinned version and hash and runs it `--offline --strict-collection`. Offline
  matters: the online audit lists tags for each action and answers 401 without a
  token, which fails the whole run rather than the one check. Clean as wired.
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
