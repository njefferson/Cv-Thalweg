# NOTES — Cv-Thalweg

Working notes for this repo. `README.md` is what a reader needs; this is what a
session needs before it touches anything.

## State

- **2.9.0 is live at https://cv-thalweg.pages.dev**, promoted 2026-09-01 and
  verified by reading that address rather than the push output — the page and
  the service worker both serve 2.9.0. Gates went green against that exact head
  SHA on both branches, which is a different claim from the newest run being
  green.
- **2.11.1 is live at https://cv-thalweg.pages.dev**, promoted 2026-09-01 and
  verified by reading that address rather than the push output — the page and
  the service worker both serve it. 2.10.0 and 2.11.0 went out together ahead of
  it on the same day.
- Staged candidate: **2.11.2** — the width chart says where it has nothing.
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

- **The key promised something the map did not do.** It read "Other tide
  station — tap to switch"; tapping opened a label with the station's name and
  offered nothing. So the ONE sentence in the app that told a reader the tide
  station is a choice was describing behaviour that did not exist — and the
  choice matters by hours, because high water at Rio Vista and at Freeport are
  not the same event. The panel had carried a picker and a nearest-to-you
  button for several releases, which is probably why nobody looked at the map's
  claim: the feature was real, just not where the key said it was.
  **A legend is a promise about behaviour, not only a decoder for colours**, so
  the check now asserts the two cannot drift: if the key says a tap switches,
  the popup must carry the control.

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
- **THAT LINE SAID THERE WAS NO PUBLISHED BOAT-RAMP DATASET FOR THESE RIVERS,
  AND IT WAS WRONG.** It read as a finding about the state and was a fact about
  this container: the hosts that publish it were refused at the CONNECT tunnel
  and never reached. CDFW publishes 677 boating facilities through the service
  behind its own Fishing Guide, 97 of them on these rivers, and
  `tools/fetch-ramps.mjs` bakes them. What survives of the old note is narrower
  and still true: the "Public Access Points" service is coastal beaches — 1,500
  across the coastal counties and ZERO inside any of the river boxes, checked
  rather than assumed — and CDFW's own lands are a different thing from a
  launch, which is why they are a separate layer.
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

## The gate that was named in a comment and never written

The comment above `riverCount()` in `public/index.html` said, in as many words,
that `tools/copy-count.mjs` refuses a hardcoded count in reader-facing copy —
"because a rule in a comment is what this repo has just demonstrated does not
hold". **The comment was written and the script was not.** So the rule went
straight back to being a paragraph, which is the exact failure it was written
about, in the file it was written in.

What that cost, found on the run that finally wrote the script:

- The first-run page and the About panel both opened with "four rivers" and
  then named the four by hand, four sentences apart in two functions. Neither
  knew `RIVERS` existed. Correct on the screen every day so far, and wrong the
  moment a river is added, in two places, silently.
- **The Home button's label asked the list and its spoken announcement did
  not.** `#homebtn` is labelled from `riversPhrase()`; the `announce()` beside
  it said "Back to all four rivers." — typed. The stale half was the half only
  a screen-reader user ever receives, sitting one line below the half that was
  correct.
- The water-clarity key was a typed second copy of `TURB_BANDS`: the same four
  words and three thresholds written twice, so moving a boundary would have
  left the key explaining the old one.

**THE FIRST VERSION OF THE GATE FLAGGED NINETY LINES AND NEARLY ALL OF THEM
WERE HONEST** — "a mark belongs to one river", "two surveys here", "one of the
four subsections amended". That is hub LESSONS §108 arriving again: honest
prose and a stale count are the same shape, so the shape cannot be what is
matched. What is matched instead is the COINCIDENCE — a spelled number is
flagged only where it equals the current size of one of this app's own tables
and sits next to that table's noun or stands bare for the set. A number that
matches no table is talking about something else; a number that matches is
correct today and is precisely what goes stale. Ninety became three, and all
three were worth reading: two were real defects and one was a fact about a
regulation, which is the single line in `.copy-count-allow`.

The counts are read out of the arrays on every run, so the gate cannot fall
behind the table any more than the copy may. Release notes are out of scope by
construction rather than by declaration — version 1.0.0 really did open on four
rivers, and rewriting that sentence when a river is added would be a lie about
the past.

**And the same question is asked a second time of the RENDERED page**, in
`tools/a11y.mjs`: the first-run panel and the About panel must carry the app's
own river-count phrase and every river's name, with the expected strings
computed from `RIVERS` in the page itself. A helper can be called and the
sentence around it can still name three of four rivers by hand. This is the
print-tracker shape, where a welcome describing three job types outlived the
fourth being added.

**A THIRD CHECK WAS WRITTEN THERE, RUN, AND TAKEN OUT.** It flagged every
"all <number>" in the panel that was not the river count, and what it found was
"three numbers", "two surveys", "the one survey" and "all five" ribbon rows —
twenty-two hits across the About panel, every one honest. Asking loosely a
second time what the source gate already asks precisely would have bought
nothing and cost twenty-two declarations, which is how an allow-list stops
being read.

Both halves were seen red on a LOCAL plant and never on a pushed one:
`copy-count.mjs` on a restored "Back to all four rivers." and on a declaration
that no longer matches anything, and the a11y check on a `riverNamesPhrase()`
that drops its last river.


## The hub pin and the doctrine marker had drifted here too

`.doctrine-sync` records the hub commit this repo has RECONCILED with. The
`uses: .../hub-gates.yml@<sha>` line in `gates.yml` is the commit CI CHECKS THE
HUB OUT AT to run the shared gates. **They are the same fact, they are written
in two files, and nothing here was comparing them.** The marker had moved and
the pin had not, so CI was running the privacy, quote, third-person, no-grid and
branch-guard checks from 2026-08-29 while this repo's marker said it had read
and applied everything since.

Both now read the same commit, and `tools/hub-pin-check.mjs` keeps them that
way — on every commit through `.branch-guard`'s `also=`, and in CI because a
fresh clone has no hook.

**It is a COPY, and the copy is correct rather than lazy.** The hub's shared
gates are never forked; they take `--repo .` precisely so five divergent
versions cannot exist. This one cannot follow that rule, and the reason is the
circularity it exists to break: CI fetches the hub AT the pin, so a gate
validating the pin would be fetched at the very commit it is checking, and a pin
left far enough behind would check out a hub that does not contain the file at
all — failing with a missing module instead of a diagnosis. Taken from
solve-ent, which was the only sibling that had it and, measured on 2026-09-01,
the only sibling whose marker and pin agreed.


## The data the app said did not exist

`public/index.html` told the reader, in the Layers panel, that **"No published
list of boat ramps for these rivers could be found, and this app will not invent
one."** `tools/fetch-access.mjs` opened with the same claim in its header, and
`NOTES.md` stated it as a finding. It was false.

**It was false because of where the session stood, not because of what the state
publishes.** Six of the hosts that carry it — `data.ca.gov`, `dbw.parks.ca.gov`,
`www.parks.ca.gov`, `opendata.arcgis.com`, `map.dfg.ca.gov`, `water.ca.gov` —
and later `www.arcgis.com`, the item-search endpoint, were all refused at the
CONNECT tunnel by this container's egress. A refusal and an absence are
indistinguishable from inside, and the app wrote the absence down. That is hub
LESSONS §188 exactly, and this is what it cost: a real dataset written off in
shipped copy, and a feature nobody built because the record said there was
nothing to build it from.

**What is actually published.** CDFW's `FishingGuide` feature service, the one
behind the department's own Fishing Guide map. Layer 0, `FGuideBoating`, is 677
boating facilities statewide. **97 rows land within a kilometre of these five
rivers' own courses.** Each carries the facility type, the owner and whether that
owner is government, ramp lanes usable at one time, trailer parking, restrooms,
fish cleaning, a phone number, and CDFW's own `Water_Body` string — which names
"Sacramento River", "Feather River", "American River" and
"Sacramento-SanJoaquinDelta-Mokelumne River" outright.

**THE FIRST VERSION OF THE GENERATOR THREW AWAY TWO THIRDS OF IT.** It required
every facility to carry the interview date, on the reasoning that the age is the
caveat and an undated row would read as current — and only 237 of the 677 carry
one. That rule was invented by the generator, not by the data, and it dropped
111 real facilities to keep the file tidy. Undated rows are KEPT and marked, and
the app says "CDFW records no date for this one" rather than showing a blank —
which is this repo's standing answer to a missing figure everywhere else. The
split is printed on every run so the proportion cannot change quietly. Of the 97
on these rivers, 49 carry a year and 48 do not.

**A launch at a confluence is on both rivers and is listed under both.**
Discovery Park is on the American and on the Sacramento; twenty rows are one
facility filed twice. Each names the others, and the check refuses a one-way
`also` — a row claiming a listing the other river does not have would be the app
inventing a place.

**The layer nearly shipped unpressable.** The pins are twelve pixels across and
what makes any pin on this map reachable by a thumb is its layer's presence in
`pinLayers()`, not its styling. Drawn and unlisted, the launches looked perfect
in every screenshot and were inert: measured on a plant, a press twenty pixels
off a launch pin returned a DEPTH READING for the water underneath. That is the
doctrine's own worst case — a feature present in the source and unreachable on
the device — and it is asserted now at 0, 10 and 20 px.

**And a check written for the new control failed on the old one beside it.**
Every primary button in a panel was thirty pixels tall, in an app read
one-handed on a riverbank, since the first week. The layer toggles included.
Nothing was measuring it, so nothing was wrong. `.rowline button` has a 44px
floor now.

**Both toggles also read "Show them on the map".** Two controls with one
accessible name in one panel is one control offered twice to anybody moving
through it by keyboard — and the rendering suite proved it by clicking the wrong
one the moment the section landed. Each names what it shows, and the suites
assert on the accessible name rather than the visible text, because every row in
these lists carries a "Map" button correctly distinguished by an `aria-label`.


## Width, and the two ways it could have been a lie

The down-river profile drew the depth and nothing else. `tools/fetch-widths.mjs`
adds the other dimension of the same channel: a line cast straight across
USGS's NHD large-scale Area polygon — the mapped water surface at 1:24,000 —
perpendicular to the committed centreline, taking the distance between the two
nearest bank crossings. Every second point of `river-lines.js`, so about 600 m
apart down the Sacramento.

**It is the MAPPED channel and not today's water**, and that has to reach the
reader rather than sit in this file: the river is wider in a flood and narrower
in a drought and NHD does not move with the stage. Bank to bank, so bars and
shallow margins are inside it — which is the same relationship the depth
surveys have to navigable water, and the same reason neither is for navigation.

**THE TWO WAYS A NUMBER HERE COULD BE A LIE, AND BOTH REFUSE.** A cast that
leaves the mapped water and finds no far bank inside 1200 m has left the channel
— a confluence, a flooded bypass, a Delta junction — and "the width here" has no
single answer, so nothing is drawn. And a centreline point that is not inside
any polygon at all is USGS's flowline disagreeing with USGS's own area polygon,
which happens on the narrow upper reaches where the channel is too small to be
mapped as an area; measuring from there would take the nearest bank of something
else. Counted: 424 measured and 155 refused on the Sacramento, 86 and 46 on the
Mokelumne. **The refusals are the feature — a generator that never refused would
be one that had guessed at every confluence.**

**One in four points was tried first and was too coarse to be useful.** The
surveyed run on the Sacramento is 31 km; at a sample every 1.2 km that left
TWELVE points to draw a line through, which is not a picture of a channel. One
in two, measured on the running app rather than reasoned about, gives 25 across
the same run and a 21 KB file.

**The spot check that makes the numbers mean something.** The Sacramento at
downtown Sacramento comes out at 179 m, which anybody can check against the
world without any of this code. Medians: Sacramento 128 m, Feather 99 m,
American 90 m, Mokelumne 37 m. That last one is the check working — the
Mokelumne really is a small river, and a generator measuring the wrong bank
would not have produced a number a third of the others.

**WIDTH SURVIVES A MISSING SURVEY, and that is the reason it is its own view
rather than a tick beside the depth.** DWR sounded a small fraction of these
rivers; USGS mapped the banks of all of them. So the no-depth early return in
`renderProfile` is skipped when the reader has asked for the width and there is
a width to show, and the width is attached to every profile model including the
ones that found no survey at all.

**The width and the depth never share a scale.** A width in metres and a depth
in feet on one axis is an invitation to read one as the other, so the width has
its own — on the right when shown with the depth, on the left and owning the
picture when shown alone, and the depth grid is suppressed entirely in that
view.

**What was lost, and it is in the release notes rather than left to be found:**
dragging a finger along the profile does not work in the Width view. The tracing
reads a depth at the point under the finger and moves a mark along the line on
the map, and there is no depth there to read.

## The moon, and the check that is worth more than the moon

Computed, not fetched — Meeus's truncated series, the same shape as the sun
already in this file, so it works with no signal and there is no service to be
down. It sits under the spring–neap section because it is the cause of it.

**THE FIRST VERSION CARRIED ONE PERIODIC TERM AND WAS MEASURABLY WRONG.** The
mean interval between the new moons it found came out at 29.517 days against the
true 29.53059, and the mean was not the real problem — the SCATTER was: with
only the equation of centre each individual new moon lands up to a third of a
day out, which is enough to print the wrong calendar date. The evection (1.27°)
and the variation (0.66°) are the two largest omitted terms, and at 12.19° a day
of elongation those are two and a half hours and an hour and a quarter of
timing.

**And the correction was nearly missed, because the measurement was too short.**
Over ten years the corrected series reads 29.5247 and looks worse than the
original; over sixty it reads 29.5308 against a true 29.530588. The difference
is entirely SAMPLING — the endpoint scatter is a third of a day either side and
does not average down until there are hundreds of intervals. A shorter window
would have sent this session chasing a defect that was not there.

**THE CHECK THAT IS WORTH THE MOST IS NOT ABOUT THE MOON AT ALL.** The
spring–neap section measures the swing in NOAA's published predictions and knows
nothing about where the moon is; the moon is arithmetic about the sky and knows
nothing about NOAA. The big tides follow the new and the full by a day or two,
so the biggest day in the window has to land near one of them. Two independent
paths made to close, which is hub LESSONS §203.

**IT LIVES IN `tools/live-test.mjs` AND NOT IN THE RENDERING SUITE, and the
reason is the whole point of it.** Written there first, it failed by 4.2 days —
because that suite runs against a STUBBED tide whose fortnightly envelope was
authored by hand and whose phase has no relationship to the real moon. Made to
pass, it would have meant phase-locking the fixture to the code it is supposed
to be independent of. Against the real service it passes.

**The moon is outside `tideSection` on purpose.** That function returns early
while the predictions are loading and again when the station fails, and the moon
depends on neither — it needs no signal and no station and is the one thing on
that panel that is never missing. Put inside, it disappeared exactly when
everything else did. **This is the third time in this file a section has been
written inside a branch that had nothing to do with it**: the light box inside
the hourly-curve branch, and the overlap caveat inside the branch that found an
overlap.

## No wake zones: asked, on this date, of these four

Not built, and this is the negative written the way §208 says a negative has to
be written — with the search attached, so the next session can tell a fact from
a snapshot.

Asked on **1 September 2026**, of `data.ca.gov` (the state open-data portal),
`gis.data.ca.gov` (the State Geoportal), `www.arcgis.com` (the ArcGIS Online
item search) and `dbw.parks.ca.gov` (the Division of Boating and Waterways).
**All four answered.** None publishes a no-wake or speed-zone dataset for these
waters: "no wake" returns nothing at the portal, "speed zone" returns air
quality and wind generation, and the one boating layer ArcGIS Online has for
California is a third party's, for Lake Tahoe.

There is a reason, and it is the reason not to keep looking for one file: on
this water these zones are set by county ordinance and by the signs on the bank,
under the Harbors and Navigation Code. They are not one state layer, and an app
that drew them from one would be asserting a boundary nobody published.


## Tracing worked once, and then the drawing was gone

The finger-tracing readout was extended to carry the width. It worked on a
fresh page in all three views and failed in every view but the first when they
were tried one after another in one page — which is the exact shape of a bad
test, and most of an hour went on the wrong hypotheses because of it.

**A pointer capture stranded on a discarded node** was the first guess: every
re-render throws the SVG away and builds a new hit rect, and a capture held by
the old one would route events at a node that is no longer in the document.
That fix is real and is kept. It was not the cause.

**The cause, measured rather than reasoned about.** `#profile` is a fixed
height — 230 px on a laptop, 44dvh on a phone. Holding a traced point fills
`#profheld` with four paragraphs and two buttons, 154 px of them. The drawing's
wrapper was `flex:1 1 auto; min-height:0`, so the flexbox did exactly what it
was told and took it to **zero**, while the SVG went on painting at its old
size outside its own container with the held panel over it. `elementFromPoint`
at the centre of the hit rect's own bounding box returned a `<p class="note">`.
Before a trace: wrapper 87 px, the rect on top. After one: wrapper **0**, rect
122 px tall, a paragraph on top.

**So you could trace once. The second drag landed on commentary and did
nothing, with no error anywhere** — and this was true in every released version
that had the held panel, not just this one.

The fix is that the drawing has a floor the flexbox cannot take away
(`min-height:110px`) and the section scrolls rather than crushing it. **The
picture is what the section is for; the panel underneath is commentary, and
commentary must not be able to squeeze out the thing it comments on.**

**The assertion that would have caught it is not about height.** A picture can
have a height and still be unreachable, so the check asks what the document
says is on top at a point inside it — and it is made on the SECOND trace, after
a hold and a re-render, because the first one always worked. That is the same
shape as the touch-target checks this repo already carries: measured by hit
testing rather than by styling.


## The width was drawing a line through its own refusals

`tools/fetch-widths.mjs` refuses to give a width at a confluence, at a bypass,
and wherever USGS's flowline sits outside USGS's own area polygon — and the
generator, the check and the baked file all handled that correctly. **The chart
then drew straight through every one of them**, because `widthAlong` kept only
the samples that carried a number, so the series ran from the last width before
a gap to the first after it at a slope that reads exactly like data.

That is the defect the depth bands were built not to have, three hundred lines
above in the same function: *a line drawn straight across a gap invents a bottom
between two places nobody measured.* A width is no different, and the refusals
this repo was careful to produce were being thrown away one layer later.

Now the refusals travel to the chart, the line is drawn as RUNS split on them,
and each gap gets a dotted rule at the foot of the band. **The mark matters as
much as the break**: on the upper reaches most samples refuse, and a reader
seeing a few short strokes with nothing to explain them would reasonably
conclude the app is broken rather than that USGS maps the river there as a line
rather than an area.

The readout has three answers now instead of two — a width, "no single width
here" where USGS mapped the place and the cast refused, and "no width here"
where nothing was sampled. Collapsing the middle one into the last would
understate what is actually known.

**THE TEST INJECTS THE GAP RATHER THAN HUNTING FOR ONE.** On the Sacramento's
surveyed run every sample happens to carry a width, so the branch that matters
would never run against the real file — which is how it shipped in the first
place. Three consecutive nulls are written into the model, the drawing is
asserted to produce two runs and a dashed rule, and the model is put back.

**And a release note was overclaiming.** 2.11.0 said "Width survives a missing
survey ... so Width works on stretches where Depth has nothing to show, which is
most of them." Half true: a line you draw yourself gets a width anywhere, but
the down-river button profiles `surveyedRun(line)` and always has, so on the
Sacramento it covers 31 km of 359. The note now says which half is which, and
the limit is listed as still not right.


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

## The tide along the river, as built (2.0.0)

**Where it lives:** the Water panel, under the tide section, because the two
answer different questions — that one predicts the water LEVEL at one station,
this one shows which way the water is actually RUNNING at every gauge in river
order.

**Two halves, split by cost.** The arrows are free: velocity is already in the
readings the panel fetched. The day of bands is 47 KB and this is the landing
panel, so it is behind a press.

**`velocityRuns` is the load-bearing part.** It turns a series into runs of
CONFIRMED direction, ignoring anything inside `VEL_SLACK` (0.15 ft/s). Without
the band, Walnut Grove reported three turns in half an hour; with it, one. The
test drives the real flicker pattern and also a real reversal, so the threshold
cannot be widened until it eats genuine turns.

**A gauge arguing with itself is dropped from the drawing and named underneath.**
Where velocity and discharge sign differently the app already refuses to choose,
and the first version of this figure drew an arrow anyway — **the pre-existing
conflict test caught it**, which is the second time this week an old check has
caught a new feature quietly breaking a rule the app had already settled.

**The accessibility trap, again.** Everything drawn is inside a `role="img"`,
which prunes its subtree, so the per-gauge facts existed for nobody who could
not see the picture. The figure carries an `aria-describedby` list saying the
same things in sentences. This is the third time that role has bitten in this
repo; assume it every time, rather than rediscovering it.

**And the figure has a key**, because a picture that says two things in colour
and neither in words is a defect this app has now shipped twice.

## The Delta broke three baked artefacts, each in its own way

Adding an entry that is not a river found every place the tooling assumed one.

**`fetch-centrelines.mjs --check` demanded a course from it.** The Delta has 97
channels and no main stem — the thing that entry exists to say. It skips
`network:true` now.

**`fetch-access.mjs` gave it no public land**, because it measures distance to
`river-lines.js` and the Delta is not in there. The consequence was not a blank
section: the app would have said CDFW publishes no land of its own within twelve
kilometres of the Delta, **which is false — there are sixteen sites**. A missing
input turned into a confident wrong sentence, which is the worst shape a gap can
take. The tool reads the Delta's channels as one line for that measurement now.

**`fetch-stations.mjs --check` caught the tides** — see below.

**And a fourth tool needed the §173 three lines**, printing "CDFW answered HTTP
403" for what was the proxy's own allowlist reply. `check-deploy`,
`fetch-delta`, `fetch-stations` and `fetch-access` all re-exec now. **Any new
tool in this repo that fetches needs them; assume it rather than rediscovering
it.**

**The lesson for next time: run every `--check` before pushing, not the suites
alone.** All three suites were green while three baked artefacts were wrong,
because the suites test the app and the checks test the files it ships.

## Two gates that only run in CI, and what they caught

Both of 2.2.0's first-push failures were checks this container does not run,
and both were real.

**`fetch-stations.mjs --check`: "delta declares tides and has no baked
stations."** The Delta was declared tidal with five stations and `tide-stations.js`
had never heard of it, so the Delta's tide would have been empty offline on a
first load. Re-baking gave 94 stations across three rivers. The tool ALSO had
no `NODE_USE_ENV_PROXY` re-exec, so running it here printed **"NOAA answered
403"** — the proxy's allowlist reply wearing NOAA's name. That is LESSONS §173
for the third time in this repo; the re-exec is now in `fetch-stations.mjs` and
`fetch-delta.mjs` as well as `check-deploy.mjs`.

**`live-test.mjs`: "the tidal reach is drawn to a named station."** It searched
the ribbon for `tide predicted to `, a string the app has not produced since the
station's name was taken out of that caption — it read "tide to SACRAMENTO,
SACRAMENTO RIVER" and parsed as nowhere. **The phrase existed in the test and
nowhere else in the repo.** A check that keys on copy pins the copy (§180), and
a check that only runs in one place goes stale where nobody is looking. It asks
whether the tidal limit is MARKED now — a dashed rule, and words that mention
the tide — which is the thing the caption was ever for.

`tools/fetch-delta.mjs --check` is wired into `gates.yml` beside the centrelines
and the access lands, because a baked artefact nothing checks is one that goes
stale in the tree.

## The Delta's regulations, found by asking CDFW's own service

Searched 2026-09-01 because "no Delta season" was an absence, not a finding.
**The legal-text hosts are refused by this session's egress** — westlaw,
casetext and Cornell all return `connect_rejected` — but CDFW publishes the
regulations itself as a queryable ArcGIS table, discovered from the source of
`apps.wildlife.ca.gov/sportfishingregs/`:

`services2.arcgis.com/Uq9r85Potqm3MfRV/arcgis/rest/services/RFRService/FeatureServer/2`,
fields `Code`, `ParentCode`, `Verbatim`, `Title`, `Source` — the whole of Title
14 as text, searchable by section number.

**The finding: section 7.40 is the "Alphabetical List of Hatchery Trout,
Hatchery Steelhead, and Salmon Waters with Special Fishing Regulations" — a
list of NAMED waters, and the Delta is not on it.** That is not an oversight and
not a gap in this app's research: the Delta appears in Title 14 five times and
none of them is a salmon season. **A salmon season in the Delta is the season of
whichever named water you are standing on**, which this app already carries for
the Sacramento and the Mokelumne.

What the Delta has of its own, now shipped verbatim with its section number:
1.71 (what the Delta legally is — defined by highways, and **not the same
boundary as the Water Code's Legal Delta that this app uses for its extent**),
2.10(c)(1) (hook gaps: single no greater than 1 inch, multiple no greater than
3/4), 5.00(a)(1) (black bass: open all year, 12-inch minimum, five-fish bag),
and 2.25(b)(1) (bow and arrow).

**The two Delta boundaries are a real distinction and the app should not blur
them.** The extent baked in `delta.js` is DWR's Legal Delta Boundary under Water
Code §12220; the fishing rules apply to §1.71's highway-bounded area. They are
close but not identical, and only the second governs what is legal.

## All of them or none of them, decided by fit

The question put was which arrangement serves how a fisher actually plans. The
answer came from separating two moments that want different things.

**Choosing where to go** is a comparing task, and the river cards already do it:
season, temperature and its reading, flow with the gauge it came from, clarity,
which way the water is running, the tide phase with its next turn and swing.
The cards are the choosing instrument.

**What the cards cannot do**, and the only thing the stacked band uniquely
gives, is the temperature ALONG each river on one scale — that the lower
Sacramento is warm while the upper is cold, and the American is uniform top to
bottom. A mean per card hides it, and for a fall-run fishery it is the fact
that matters most.

**Standing on the bank** is a different task, and by then a river is picked and
the band is one row. None of this touches it.

So the band's value is real and it needs room. **A version too small to read
does not serve the moment it exists for** — it occupies a third of the screen
looking as though it does. And scrolling is the worst of the options, because
the comparison requires seeing them TOGETHER: two rows at a time is not a
comparison, it is a list.

**So on the landing view it is all of them or none of them**, and where they do
not fit the band gives way to an offer.

**Keyed on whether it fits, not on whether this is a phone.** A tall phone in
portrait may hold five rows honestly and a short one will not, and the app
already measures which. Reaching for a device rule here is exactly what put the
height budget on a width test earlier the same day.

**The offer names what is behind it.** The old sentence said the rows would not
fit and sent the reader to pick a single river — an apology and a detour that
never said what the band is FOR. A reader who has never seen it on a big screen
had no idea there was anything to want. It now names the three things only the
stacked view gives and says they are one press away at full size.

**What the scroll work bought, and what replaced it.** 2.6.1's scrolling band
and 2.8.1's fade were right answers to the question as it stood, and both are
now unused on the landing view. That is not waste: the fade work is what made it
obvious that a scrolled comparison is a compromised one, and the scroll path
stays for the single-river case. The a11y checks about reaching rows below a
fold were replaced rather than weakened — there is no fold now, and what is
asserted instead is that the band is never shown half-finished.

## The band scrolled and only said so to a screen reader

Reported from the device, and the gate that should have caught it was the one
that missed it. 2.6.1 made the band scroll instead of vanishing and set an
`aria-label` reading "River ribbon, 5 rivers, scrollable" — and the walk
asserted exactly that label was there. It was. **To the eye the band simply
ended**, with two rivers below the fold and nothing suggesting they existed.

**A check that asserts a thing was announced is not a check that it was
shown.** The label was the whole of the evidence, and the label is invisible.

Two additions, because a fade is a hint and a number is an instruction:

- The bottom edge fades while there is more to reach. It is a `mask-image` on
  the scroller rather than an absolutely positioned overlay, because an
  absolute child of a scroll container scrolls away with the content — the
  mask applies to the VISIBLE area, which is what this needs.
- The fade is removed at the end of the scroll, so the last row is not left
  permanently dimmed by a hint about content that is already on screen.
- The note counts what is below: "Scroll for 3 more", worked out from the
  band's own box rather than assumed.

**And the check moved to where the state exists.** The scrolling band cannot be
reached at 1280x900 at all — a budget only applies on a screen that is narrow or
short — so a desktop check driving it by hand would be measuring a state the app
never enters on that geometry. It is asserted in the walk, at 375 and 390, where
the overflow is real. Same split as the sideways view: mechanics where they are
geometry-free, geometry where the geometry is.

## The shared distance scale was crushing four rivers to flatter one

Reported from the device: the Sacramento seems to be what makes the others
cramped. Measured off the baked centrelines, across each river's own axis:

- Sacramento, 359 km — the bar that sets the scale.
- Feather, 84 km — 24% of it.
- Mokelumne, 77 km — 21%.
- **American, 30 km — eight per cent.**

So the American was a stub about a twelfth of the width with its gauges piled
on top of each other, and the only river that could be read was the one nobody
needed help reading.

**This reverses an earlier fix, and the reason it is allowed is the half that
was missing the first time.** The bars were originally all stretched to the
same width whatever they covered, and four equal bars said four equal rivers.
The shared scale told the truth about length and paid for it with the thing the
drawing is actually for — where the gauges sit along THIS river.

**What made equal bars a lie was that nothing said what they covered.** So each
bar gets the full width AND its own length in kilometres on the row, and the
note says out loud that the widths are no longer comparable. The comparison of
length moves out of the drawing and into a number that states it exactly.
Saying it is not a footnote on the change; it is the change.

**The length goes under the name, not at the end of the bar.** The end of the
bar is where the tide mark and its caption already live, and this is a property
of the row rather than of its right-hand edge.

**And the legibility floor had to move with it.** 22px was set for a dot and its
figure; a multi-river row now also carries the name and, under it, the distance.
Left at 22 the length would print into the top of the next river's bar — which
is precisely how the Delta's tide caption came to sit on the Mokelumne's
temperature two releases ago, and the lesson from that one was that a line added
to a row needs the row to be told about it. The floor is a property of the
metrics now rather than a constant in three places, and both suites read it from
there rather than repeating the number.

**The cost, stated in the release note rather than discovered:** rows are taller,
so fewer fit on a short screen than before. That is what 2.6.1's scrolling band
and 2.7.0's sideways view are for, and they arrived first by luck rather than by
plan.

## The screen cannot be rotated by a web page, so the picture is

Asked for as "a button that rotates the screen without the user having to turn
on landscape". **Checked rather than remembered, in both engines:**

- **WebKit — Safari's engine, so every iPhone and iPad — has no
  `screen.orientation.lock` at all.** `hasLock: false`.
- Chromium has the method and it threw `NotSupportedError: screen.orientation
  .lock() is not available on this device`; on a handset it works only inside
  fullscreen.

So a button calling it would be a control that does nothing, which is the
defect this repo has a rule about. The device stays put and the DRAWING turns.

**That is not the consolation prize.** A portrait phone rotated this way gives
the bars 667 by 282 where the same phone physically turned gives them 844 by
242 — the browser keeps its chrome either way and portrait has more screen left
to spare. Measured: on an iPhone 13 the rows go from **22px in a 390-wide box
to 45px in a 667-wide one**, every river on screen, nothing to scroll.

The transform is the standard recipe and the ORDER matters: origin at the top
left, `rotate(90deg)` then `translate(0,-100%)` in the element's own
coordinates, which after the rotation moves it back across the screen. The box
is `100dvh` wide by `100dvw` tall.

**One drawing, two hosts — not two drawings.** `drawRibbon` takes an
`opts.host`, and everything belonging to the BAND rather than to the picture is
skipped for it: the height budget, the note, the row-press overlay, the
corrective pass. A second formulation of one picture is how two views come to
disagree about which river is which, and this session has already written that
lesson twice.

**The row-press overlay is skipped on purpose rather than ported.** It places
itself by comparing bounding rectangles, and inside a rotated container those
describe the screen rather than the picture. Hit-testing through a transform is
a trap; the sideways view is for reading and the upright band is one press away.

**Two defects found while building it.**

`RIB` is a global and the sideways draw was leaving its own numbers in it —
everything that asks "did the upright band have room", including the offer of
this very view, reads that global, so the band came back believing it had a
whole rotated screen of room. Borrowed and put back now.

And the note under the drawing was written AFTER the box was measured, so the
measurement was of a layout about to change — thirty pixels of overflow in a
view whose entire purpose is fitting on one screen. The same stale-furniture
defect as the band's own budget, in a function written an hour after it.

**And a focus lesson worth keeping.** After the modal closes, the platform
restores focus to whatever held it when it opened, and that is the right
answer. Two attempts to set it manually raced that restoration and lost — focus
landed on the Depth tab, three controls from where the reader was. What the
platform cannot handle is having nowhere to go, when the readings refresh and
rebuild the panel while the view is open. So the handler now leaves a correct
restoration alone and only steps in when focus did not come back to the opener.

**One test moved rather than weakened.** The desktop suite drives the cramped
state by hand, so the moment anything redraws, the offer correctly disappears
and the button focus should return to is gone with it. The precondition only
holds on a screen that really is short, so the focus-return check lives in the
walk that runs at phone sizes — verified there by direct measurement first.

## The band scrolls now, and the budget was keyed on the wrong axis

Reported from the device: the ribbon had been taken off for a narrow view and
turning the phone landscape did not bring it back. Measured across eight real
geometries, two separate defects fell out — and the second is the one nobody
would have found by reasoning.

**A phone held sideways has LESS height, not more.** Landscape on an iPhone is
about 233px of viewport; the band's share of that is 75px and the caption
underneath takes 58 of them. Rotating is reaching for the wrong axis. So the
note now says that where it applies, rather than telling a reader the screen is
short and leaving them to try the thing that makes it shorter.

**The budget keyed on WIDTH and it is about HEIGHT.** `narrow` means "the map is
not beside the rail" — a fact about width, standing in for "the ribbon and the
readings share one screen", which is a fact about height. An iPhone 15 Pro Max
held sideways is **932px wide and 267px tall**: wide enough to escape the budget
entirely, short enough that the band then drew a 300px ribbon into a 267px
viewport and left the readings nothing at all. An iPad mini sideways was drawing
366px into 461px, 79% of the screen. Neither was reachable from the portrait
geometries the suite had always measured.

**And the third option instead of all-or-nothing.** A row has a floor below
which a dot and its figure are not legible, so squeezing is not available — an
illegible row is not a smaller row. Five rows at that floor need more height
than a short screen has. The old answer was to drop the comparison the landing
page exists for. Now: rows keep their height, the band keeps its share, and what
does not fit is reached by scrolling, with `overscroll-behavior: contain` so a
flick off the end does not carry into the page.

That is what the request asked for, on the axis that actually overflows. The
rows stack, so the overflow is vertical; laying them out sideways would put the
rivers along the same axis their bars already use, which is the one thing a
stacked comparison must not do.

**One threshold was wrong at first and the measurement caught it.** The drop
test asked whether the band minus its top margin and its key could hold a row —
but when the drawing scrolls, its margins and its key scroll with it and need
not be on screen at once. Requiring them to fit took the ribbon off an iPad held
sideways, which has room for a row and a half and every reason to be given it.
The test is the band against one row.

**Where it stands:** the small phones have their bars back, scrolled at full
size where they used to be gone; an iPad sideways is capped at 21% of the screen
instead of 79%; and a phone held sideways still cannot show five, which is a
real limit that the note now explains correctly.

## First and last light, and the only thing here that can be checked against physics

The convention every angler's tide table carries and this one did not: a change
of tide lands differently in the dark, in the low light at either end of the
day, or at noon. The app had the tide and no idea when the light was.

**It is arithmetic and costs nothing** — no request, nothing to go stale, works
offline for any date, which is the opposite of almost everything else here. NOAA
solar position, computed for the tide station being read.

**And it is the one thing in this repo that can be verified against the world
rather than against a service.** The checks are physical invariants, none of
them fitted:

- Day length at the equinox is twelve hours **and a little more** — the "and a
  little more" is the sun's disc and refraction, and a check that came out at
  exactly 12 would mean those had been left out.
- The solstices are 14h49m and 9h31m at 38.16 degrees north.
- The equation of time peaks at about **16 minutes ahead in early November**
  and **15 behind in mid-February**. Those fall out of the ephemeris; nothing
  was tuned to produce them.
- Solar noon lands at 1:08 PM PDT in June, which is right for a place this far
  west inside the Pacific zone.

**The first attempt was eight hours out and looked correct.** The longitude
correction was applied twice — once in the day number and again in the noon
estimate — and the declination and both day lengths were right throughout,
which is exactly what made it hard to see. The invariant that caught it was
solar noon against longitude, which is the one quantity the double correction
could not survive.

**Then a closure check found a 45-second disagreement, and that was the useful
one.** The shading needs the sun's altitude at an arbitrary instant; the
sentences need the named crossings. Computing those two ways is how they come to
disagree with nobody able to adjudicate. So the suite substitutes one back into
the other: **the altitude at the sunrise the app computes must be the sunrise
altitude.** It was -0.65 where sunrise is -0.833.

The first hypothesis — declination taken at solar noon rather than at the
crossing — was wrong, and testing it was worth it: fixing that moved the answer
by a fraction of a second and left the 0.18 degrees standing, which established
that the real difference is the **transit estimate**. The closed form reaches
solar noon through a two-term equation-of-time approximation; the altitude path
goes through sidereal time and right ascension. Same quantity, two methods.

There is one definition now and the other refines to it: Newton on the altitude
from the closed form's guess, four steps, under a second. Solar noon is solved
too — by bisecting the hour angle, since altitude is stationary there — because
left as the estimate it was the last time on the panel still coming from the
other method, and it showed as rise and set straddling it by 35 seconds.

**And one test was asserting a property of the approximation.** "Sunrise and
sunset straddle solar noon exactly" passed only while the model was crude:
declination drifts across a day, so the asymmetry is real and is tens of
seconds. It now allows a minute and says why.

**A gate keyed on copy pinned the disclaimer, for the third time this session.**
The check for "this is not a fishing forecast" searched for words like "fish
will" — and matched the sentence doing the refusing. It asserts the denial is
PRESENT now, which is the actual requirement, plus the absence of a
recommendation. Hub LESSONS 180, again.

**And the light was locked inside the branch that draws a curve.** `lightBox`
went in beside `tideChart`, in the `else` of the hourly-curve check — so the
stations that publish highs and lows only got no light at all. Those are the
subordinate stations, New Hope Bridge and Terminous, which are exactly the ones
somebody on the upper Mokelumne would pick. Nothing about the sun needs an
hourly prediction: the times come from the date and the position and the turns
come from the highs and lows. The shading needs the chart; the words never did.

That is the same shape as the caveat that had been written inside the branch
that found an overlap and vanished when the answer was "none" — **a thing put
next to the code that happens to be nearby rather than next to what it actually
depends on**, twice in one afternoon, in one function.

## Home lost its ribbon on every screen, and the note blamed the screen

Reported from the device. The ribbon was gone from the landing page at every
geometry, and the sentence underneath explained it as four rows not fitting on
a short screen — which was wrong twice over: there are five rows, and the rows
were not the reason.

**The row overlay was being counted as furniture in the ribbon's own budget.**
The tappable river rows are HTML buttons laid over the drawing inside
`#ribbonwrap` (§194 — they cannot be inside the `role="img"`), positioned
absolutely and exactly as tall as the ribbon. `drawRibbon` sums the wrapper's
children as things that push the ribbon down the page and take space from it.
The overlay pushes nothing: **it IS the ribbon, drawn over itself.** So every
redraw subtracted the previous draw's own height from the space left for the
next one, and on a 390x664 phone the budget reached **minus 26** before a row
was measured.

**Then it latched.** Below the legibility floor the draw returns early — before
the line that removes the stale overlay — so the overlay stayed, the budget
stayed negative, and the ribbon could never come back on its own.

Height is not the test; **participation in flow is**. An absolutely positioned
child is skipped now, and the early return clears the overlay it is dropping.

**Two more arithmetic errors surfaced behind it**, both only visible once the
first was fixed.

**Margins are part of what a thing takes up and a bounding rect does not
include them.** The note under the ribbon is a `<p>` carrying the browser's
default vertical margins — twenty-two pixels the budget could not see, so every
draw believed it had twenty-two more than it did and the band came out over its
share. Counting `marginTop + marginBottom` is what put every geometry at exactly
32% instead of 35%.

**And the corrective pass was compensating for a number that was about to be
re-measured.** `extra` is read at the top of the function, so it is the PREVIOUS
draw's note — and the note's line count changes with how many gauges plotted.
The retry subtracted the whole measured overshoot from a budget that would be
recomputed against correct furniture anyway, taking the error off twice; with
five rows that landed under the floor and dropped the band. It passes 0 now: a
re-run, not a compensation.

**And a policy, kept as a backstop:** a corrective pass may shrink this view and
may not delete it. Overshooting a guideline by a few pixels is a smaller failure
than dropping the comparison the landing page exists to show.

**What is still true:** an iPhone SE cannot hold five legible rows in the share
the ribbon is allowed. That is a real limit, the app says so, and the note no
longer names a count it does not have.

### And the fix exposed the next one: the explanation ran before the decision

Fixing the budget moved WHEN the ribbon gets hidden. It used to be hidden on
its very first pass, so by the time the water panel rendered, `hidden` was
already true and the sentence explaining the absence was written. With the
arithmetic corrected the band is hidden only by the corrective pass — which can
run after that panel has rendered — so the test for `hidden` read false and the
explanation was never written. The ribbon vanished with nothing said about it,
which is the one thing this app is not allowed to do.

**Caught by a gate that already existed** — "a dropped ribbon is announced
rather than just missing" — and it is the second time this session that fixing
an arithmetic error surfaced a defect underneath it that only the arithmetic
error had been hiding.

The sentence belongs to neither renderer now. The panel leaves an empty slot
and `syncRibbonDropNote()` fills or empties it from whichever of the two ran
last, so their order stops mattering.

## The tabs went to the bottom of the screen when the map opened

`main` is a column under the breakpoint and `#panel-map` is its FIRST child,
because on a wide screen it is the left-hand column and source order puts it
there. Stacked, that order put the map above the rail — so choosing Map sent the
tab strip from 203px to 630px on an iPhone 13, a full viewport from where the
finger had just been, behind a map you then had to scroll past to get back.

Nothing decided that; source order did — the same thing that once moved the
whole rail across the desktop window. Two `order` rules, scoped to the narrow
breakpoint so the wide layout is untouched. Asserted by measuring where the
boxes land, because that is the only thing that proves an ordering.

## Three sentences counted the rivers and one array knew better

"Four rivers, one temperature scale". "Four rows of it will not fit". "Home —
back to all four rivers". Each was correct when written, and there have been
five entries since the Delta arrived. None was wrong in a way anybody could see
by reading the file: the number lived in the prose and the truth lived in an
array two thousand lines away.

The prose asks the list now — `riverCount()`, `networkCount()`, `riversPhrase()`
— and the Delta is counted apart on purpose, because it is where the four
arrive rather than a fifth of them.

## Depth sat on a spinner that could never resolve

With no river the panel returned at its first check and showed "Reading the DWR
service directory…" forever, because the catalogue is fetched FOR a river and
there was no river. The sentence saying what the panel is for was written and
sat below the return, unreachable.

**A spinner is a promise that something is happening.** This one was a permanent
claim that the app was busy on the reader's behalf while waiting for an event
that could not occur — worse than an empty panel, because it tells a reader to
wait rather than to act. The checks are in the right order now, and both Depth
and Marks carry a button to the choosing rather than an instruction to go and
find it.

## Springs and neaps, and why a week could not answer it

After "which way" and "when", the question is "is that a lot". The swing
between high and low grows and shrinks over about fourteen and a half days, and
at one station on this water the two ends of that are a couple of feet apart.
Two days both described as "rising, high at four" can be completely different
afternoons and nothing in the app said which one you had.

**The turns are fetched over sixteen days now, the hourly curve still over
seven.** A week cannot answer a fortnightly question — it does not contain both
a biggest and a smallest, so today cannot be placed in the cycle. The cost is
almost nothing: a turn is four rows a day, so the fortnight is about sixty rows.
The hourly curve is the expensive one and it is drawn for the next twenty-four
hours and nothing else, so it stays where it was.

**The figure is the great diurnal range: the day's highest water minus its
lowest.** This coast has mixed semidiurnal tides — two highs and two lows a day,
and the pairs are unequal, often by more than a foot. One high minus the next
low would report whichever pair the arithmetic happened to land on and would
jump about between days for a reason that is not the moon.

**A clipped day is not a small tide, and that guard is load-bearing.** The first
and last day of any window hold only part of their turns; a day carrying one
high and one low when it really had four reports a span the water never stopped
at, and it would sit at the bottom of the chart looking like a neap. A day needs
at least three turns to count. The request begins the day BEFORE today for the
same reason, so today is never the clipped one.

**It refuses two cases instead of answering them.** Fewer than six usable days,
and there is no cycle to place today in. Less than half a foot between the
biggest day and the smallest, and calling one of them a spring tide is naming
rounding rather than the moon.

**And it says "fortnight" and means it.** Sixteen days of predictions cannot say
this is the biggest tide of the month or the year, so the app does not. The
claim is scoped to the window it actually holds.

**The limit that has to travel with it.** This is the astronomical swing at ONE
station. What moves where somebody is standing is that plus whatever the river
is carrying, and the app knows those two separately and must not let a tall bar
imply the second — a big swing on a river in flood is not the same afternoon as
a big swing on a low one.

**The fixture needed a fortnight's shape in it, and the old one had none.** The
stub's amplitude was constant, so the new question would have been answered with
"every day is the same" and measured against a tide that exists nowhere. It is
modulated over 14.8 days now with now at a spring. That also invalidated a
hardcoded `3.6` in an older assertion about the swing — replaced with the
fixture's own two turns, so it stays true whatever the envelope becomes next.

**And a gate keyed on copy pinned the disclaimer.** The first version of the
"claims only the window it can see" check searched the whole panel for "biggest
of the month" — and matched the app's own sentence promising *not* to say it.
The check reads the figure's accessible name now, which is the claim itself
rather than the prose around it. Same shape as the tide-turn check three
releases ago, and hub LESSONS §180.

## Six tools in this repo fetch, and two of them were still going direct

`NODE_USE_ENV_PROXY` is read at STARTUP, so a tool that fetches has to re-exec
itself (hub LESSONS §173). Four bake tools carried those lines. Two did not, and
both were the ones where their absence was hardest to see.

**`tools/live-test.mjs`** relays the browser's requests through Node, so with the
re-exec missing every request came back refused. The suite reported twenty-seven
failures — no gauge, no tide, no survey directory — which read as four
independent public agencies down in the same minute. **The implausibility was
the only clue**, because every message was in the app's own honest register:
"10 gauges on this river did not answer, so there is no flow figure — not that
the river has none." The app was telling the truth about what it received.

**And the relay counted the refusal as a response.** It fetched, got a 403 with
a body, incremented its success counter and passed it to the page, so nothing
threw and nothing was logged — the run's own summary said it had relayed live
responses from four hosts. It had relayed four hosts' worth of "no". It now
names a 403 or 407 as a refusal at the point of refusal and again by host at the
end, because a red run has to be a question somebody can act on rather than an
afternoon of disbelieving four agencies. (Hub LESSONS §201.)

**`tools/serve.mjs`** is not only a static server: it runs `worker.js`'s handle
at `/bathy`, exactly as Pages does, and the app routes CDEC through the same
path. With the proxy missing, that answered 403 for DWR's bathymetry AND for
every Feather reading — nine more failures, none of which said "this file".

**The server's re-exec had to forward signals, and the bakes' does not.** A bake
re-execs with `spawnSync` and exits; a server is stopped with `kill $!`, and
`$!` is the PARENT. The first version left a child holding port 8787 after the
kill, so the next run could not bind it and the suite after that would have
measured a server it did not start, from a tree it does not know. It forwards
SIGINT, SIGTERM and SIGHUP now and leaves when the child leaves — verified by
killing it and finding the port free.

**None of this is visible in CI**, where the runner's egress is open and the
live job has always passed. It is only visible from a container behind a proxy,
which is where the work is done.

## The regulations are baked now, and two of the four typed ones had drifted

The four Delta sections above shipped in 2.3.0 **typed into the river record by
hand**, which is what a hand copy of somebody else's rule always looks like: no
way to tell from reading the file whether it is right. Asked properly in 2.4.0,
two of the four had already drifted.

- **5.00(a)(1)** had lost the regulation's own parenthetical, "(see Section 1.71
  for definition of the Delta)" — a cross-reference the department put there on
  purpose, dropped in the copying.
- **2.25(b)(1)** had been rewritten. The typed version read as a sentence about
  bow-and-arrow fishing being provided for; what CDFW publishes is "Within the
  boundaries of the Sacramento-San Joaquin River Delta (See Section1.71)", which
  is a bounds clause under a heading, not a permission.

Neither was wrong on purpose and neither was noticeable. `tools/fetch-regs.mjs`
asks the service and writes `public/regulations.js`; the river record now names
a topic and carries no words at all.

**A parent section is usually a heading with nothing in it.** Asked for 5.80 the
service returns "Inland White Sturgeon"; asked for 5.80(a) it returns "Open
season:" — a colon and then nothing, because the season is in three children
naming the Carquinez Bridge, the Feather confluence and the I-5 bridge. So an
entry in `WANTED` can declare `children`, and the bake fetches the section and
its direct children and keeps them together. The check refuses a section that is
a bare heading with nothing under it: a section number in front of a colon reads
as authority for a rule that is not there.

**And it refuses tables rather than flattening them.** 5.00(b) comes back as
`[row]water|season|size|bag[row]` — genuinely tabular, fourteen of them. Doctrine
2 says a table does not render where this is read and loses its columns without
saying so, and stripping the marker would turn it into prose with stray pipes
in it, which is worse than refusing it. Both refusals were watched going red on
a local plant.

**Staleness is the whole point of the file**, so it has two guards that are not
the same guard. `.github/workflows/regulations.yml` re-bakes monthly and commits
only if the text moved; `tools/fetch-regs.mjs --check` in `gates.yml` fails if
the bake is more than 120 days old. The second is what catches the first
silently stopping — a scheduled workflow that quietly dies is the exact failure
this arrangement exists to survive, and a schedule cannot report its own death.

**What is carried, and what is deliberately not.** Twenty-one sections: the
Delta's three, black bass, four on striped bass, eleven on sturgeon and two on
salmon. Not the rest of Title 14 — it is about lakes, counties and coastline
this app has never heard of, and carrying all of it would be a megabyte of rules
for water nobody using this is standing in.

**The sturgeon sections are why the species went in at all.** They are not a
statewide sentence: the white sturgeon season is written against the Carquinez
Bridge, the confluence of the Feather and the I-5 bridge (§5.80(a)(1)–(2)), all
tributaries are closed year-round (§5.80(a)(3)), there is a year-round closure
from Keswick Dam to the Highway 162 bridge (§5.80(i)(1)) and another in the Yolo
Bypass above Lisbon Weir (§5.80(j)). Those are places on the two rivers this app
draws. The daily and annual limits are both zero, which is worth knowing before
driving out rather than after.

## The tide's direction in TIME, which was missing the whole time

Everything the app said about the tide was a direction in SPACE: the sea is
downstream, the flood pushes upstream, the cyan wash marks how far, and 2.3.0
added an arrow saying which way the water is pushed. None of it answered whether
the water in front of a person at four in the afternoon is coming up or going
down — which is a direction in TIME and the one an afternoon gets planned
around. It was derivable from the highs and lows already fetched and stored, and
was nowhere stated.

`tidePhase(river)` takes the turn behind now and the turn ahead. Rising if the
next is a high; falling if it is a low; plus how far through the swing, how big
the swing is, and how long to the turn.

**It refuses two cases rather than answering them.** With only the turn AHEAD it
returns nothing, because the direction would be right by luck; stored
predictions can begin later than the last turn. And where the two turns disagree
about which is higher — a "high" below the lows either side of it — it returns
nothing, because that is a broken prediction rather than a tide and an arrow
drawn from it would be a guess.

**That second guard found a defect in this repo's own test fixture.** The
render-test stub put its turns on a six-hour grid and read their heights off a
sine with a period of 24.5 hours, so a row labelled "high" could sit a foot
below the lows either side of it. Nothing noticed for as long as the app only
listed the turns. The moment it worked out a direction, an incoherent tide is a
fixture that exercises the failure branch and reports a pass. The stub is
semidiurnal now with its turns at the real extremes.

**It is said as a LEVEL prediction at one station, every time it is shown**, and
the measured section below it says the two need not agree. On an estuary the
current runs on for a while after the level turns — slack is not the turn of the
tide — so a reader finding them disagreeing has not found a fault, and being
told so costs one sentence.

## How far up the tide actually got — measured, and a floor

There are now two marks and they answer different questions.

- The ribbon's dashed rule is the **declared** one: the furthest-upstream NOAA
  station on the river. It is a fact about where the instruments are and it
  never moves.
- The figure's new rule is **measured**: of the gauges publishing a day of
  velocity, the highest that actually ran backwards in that day.

The real limit moves — how far a flood pushes depends on how much water the
river is carrying, so it walks up and down the river with the season and with
every storm. **The measured mark is a floor and the app says so in the key, in
the paragraph and in the hidden description**: the next gauge up may have
reversed and simply not be instrumented for it, and where the highest gauge on
the list is the one that reversed, there is no ceiling in the data at all and it
says that too.

It needs the day. The instant arrows answer for this minute, and a gauge ebbing
now may have flooded at dawn.

## Three layout defects, all found by looking at the screen

**width:100% and an explicit height are a contradiction.** The tide-along
figure scaled its viewBox down to fit the width, kept the height it was told,
and floated the drawing in the middle of the difference — a screen of blank
above sixteen Delta rows. `preserveAspectRatio="xMinYMin meet"` plus
`height:auto`, and a check that the drawn height matches the box.

**A row has to contain its own caption.** The tide caption hangs below the lower
band of figures, which put it in the NEXT river's upper band: the Delta's
caption sat on the Mokelumne's temperature and the two read as one label. Rows
carrying a caption are 14px taller.

**A control with nothing to act on looks broken.** The depth ramp recolours
switched-on surfaces; with none on it flipped its own pressed state, rebuilt an
empty list, and changed nothing visible. It says so now.

## The Delta as built (2.2.0), and the three things it turned on

**`tools/fetch-delta.mjs` bakes it.** DWR's Legal Delta Boundary — whose own
attribution names the Delta Protection Act, section 12220 of the Water Code —
is the extent, thinned from 2,131 points to 278. Inside it, 97 named channels
from USGS national hydrography, kept only where most of a segment falls in the
polygon, at the same 400 m spacing as the river centrelines. 64 KB, lazy, in
`public/delta.js`. **Attributes are dropped apart from the citation**: the DWR
record carries the name of the person who last edited it, and republishing
somebody's name because a dataset included it is not something this repo does.

**The boundary fetch 403'd first**, from Node's own fetch, exactly as LESSONS
§173 describes — it reads NODE_USE_ENV_PROXY at startup, so the tool re-execs
itself the way `check-deploy.mjs` does. It looked precisely like the state
refusing us while curl returned 200 in the same shell.

**The channel query pages at 2,000 and says so.** Taking page one would have
shipped half a network with nothing to show it was half.

**`network:true` is what stops the Delta pretending.** No profile down its own
course, because it has 97 channels and no main stem; the cross-section and the
tap-snap take the NEAREST channel instead, which is the only sense in which
"the river" exists there. `linesFor` and `nearestOnAny` are where every
"which water is this" question goes now.

**It is not a fifth card in the river grid.** Five cards leave an orphan row at
every phone width — the a11y walk's own rule, added after auto-fit stranded a
fourth river on an iPad. It has its own dashed full-width card below the four,
which is truer anyway: it is where they arrive, not another of them.

**No reaches, and the app says why.** Title 14's Delta provisions were not
confirmed against the regulation, and the existing empty-reaches branch already
said the right thing.

## Filing by water instead of by box

`surveyRiverId` takes the survey extent's centre and finds the nearest channel
within `SURVEY_NEAR_M` (4,000 m), **with the four named rivers taking
precedence over the Delta** — the legal Delta reaches past Freeport and its
channel list includes the Sacramento itself, so without precedence a Sacramento
survey would be filed under the Delta and be missing from the river a reader
picked by name.

Measured against the real catalogue, the threshold separates cleanly: 16 of 18
convertible surveys land within a few hundred metres of a channel, and the two
that do not are **Dyer Reservoir and Lake Del Valle**, which are reservoirs.
They go to nobody, which is correct.

The render-test fixture had to move: its synthetic Sacramento survey floated
nine kilometres off the channel, which is data the state does not publish.

## The bottom change, and the datum that stops it

Where the same water is surveyed twice there is a measured answer to "has the
sandbar moved" — Grant Line and Fabian Canal in June 2023 and May 2024, Sugar
Cut in April 2023 and August 2025.

**But a depth is a height measured from something, and these services do not
all say from what.** Read live on 2026-08-31: the 2024 Grant Line survey
declares `NAVD88_height_(ftUS)`; the 2023 survey of the same canal declares no
vertical coordinate system at all. Their value ranges are within a foot of each
other, which is exactly the trap — subtracting them yields a plausible number
resting on an assumption nobody published.

So `bedChange` compares only when both surveys NAME a datum and name the same
one, and prints the reason when it will not. `vertcsOf` reads it out of the
WKT. **The real pair in the catalogue is the refusing case**, which is why the
refusal path is the one that had to be right.

## The Delta, and where the state actually surveys

Read off the live DWR service directory on 2026-08-31, converted from State
Plane California zones II and III (US feet) — the wkid is absent on most of
them and the zone has to come out of the WKT's own name, which is the same trap
as the two UNIT declarations.

**Every published survey is 2023 or later.** Six from 2023, twelve from 2024,
two from 2025. The assumption that a bathymetry survey is old enough to be
useless against a moving sandbar is simply wrong here, and it was the
assumption this app was about to reason from.

**Eleven of the twenty land inside NO declared river**: Old River at Doughty
Cut, at Sugar Cut, at Paradise Cut; Grant Line and Fabian Canal, twice; Middle
River at Undine; Indian Slough; Sugar Cut; two reservoirs; and Grizzly Bay.
The app fetches all of them on every cold open and can show them to nobody.
**Grizzly Bay's conversion came out in the Pacific** and is not counted in any
claim here — its extent is very likely published in metres under a feet WKT,
which is the same defect wearing its other face, and it wants checking before
anything is built on that record.

**Nine land inside MORE THAN ONE**, every one of them matching both the
Sacramento and the Mokelumne, because those two bounding boxes overlap across
the whole lower Delta. Among the nine: `SanJoaquinRvr_at_StocktonPort`,
`SanJoaquinRiver` and `OldRiver`. **A San Joaquin survey is being offered as
Sacramento depth**, which is not a coverage gap but a wrong answer.

**Not one survey lands on exactly one river.**

The fix for the filing is the one already used for public land: distance to
that river's baked centreline, not a bounding box. It is the same defect that
put the Yolo Bypass under the American, in a place nobody went back to look.

**And there are repeat surveys of the same water at different dates** — Grant
Line and Fabian Canal in June 2023 and May 2024; Sugar Cut in April 2023 and
August 2025. Two measurements of one bottom, years apart, is the only honest
material for saying where the bed has moved.

## The tide ALONG the river: what is published and what is not

Researched 2026-08-31, against the live services, because the question "what
shows the tide's effect along the whole river" kept having to be re-asked.

**NOAA's tidal CURRENT predictions do not reach the fishable water.** That is
the standard convention for this question — slack water and maximum flood and
ebb, tabulated per station — and NOAA publishes 4,430 such stations, 48 of them
in the Delta box. Every one of them is in the WESTERN Delta. The furthest
upstream on this river is `SFB1332`, "Sacramento River Light 14", at 38.077 N,
which is **below Rio Vista** (38.153). Above that point there is no published
prediction of which way the water will be running, at any time, from anybody.

**USGS measures it instead, and the app already asks for it.** Parameter 72255,
mean water velocity, signed. Read live on 2026-08-31 across the ten declared
Sacramento gauges: **six report velocity and all six are at or below Freeport**
(38.456). Verona, Wilkins Slough, Colusa and Bend Bridge report none at all —
the instrument network exists in the tidal reach and stops where the tide does,
which is itself an answer rather than a gap.

**A day of it is one request and about 47 KB** for six sites, roughly 94
readings each at fifteen minutes. Two days returned nothing on the same URL
shape and was not chased.

**What that day showed**, and it is the picture the app cannot currently draw:
Rio Vista reversed four times (13:00, 18:45, 01:30, 06:45) and Georgiana Slough
four times (15:00, 19:30, 03:45, 07:15) — consistently an hour and three
quarters to two hours later, which is the tidal wave travelling up. Freeport and
the Delta Cross Channel did not reverse at all in that day.

**Freeport not reversing is a fact about that week, not about Freeport.**
Discharge was 18,500 cfs; in low autumn flows the reversal reaches further up.
Anything built on this must say "has not turned in the last 24 hours" and never
"does not turn here".

**And a trap for whoever builds it: counting sign changes over-counts.** Walnut
Grove showed six turns in the day, three of them at 06:00, 06:15 and 06:30 —
that is the velocity hovering at zero through slack and flickering sign, not the
tide turning three times in half an hour. A turn needs a threshold and
hysteresis, not `sign(a) !== sign(b)`.

**What the app has now**, and why it is not this: the Water panel carries one
sentence, "running both ways — 3 of 6 gauges read upstream, measured now". That
is the holistic statement and it has no geography in it; it never says WHERE the
divide between tide and river is, though the app knows the position of every
gauge it counted.

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
