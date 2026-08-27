# Thalweg

Depth, tide and flow for the Central Valley fall-run Chinook fishery — the
Sacramento, Feather, American and Mokelumne rivers and the Delta, in one place,
because on a Saturday morning you are choosing between them rather than reading
one.

No account, no sign-up, no build step, no bundler, no framework, no CDN, no
analytics, no third-party scripts. Plain files served as they are. Leaflet 1.9.4
is vendored into `public/vendor/`. It works offline after the first load.

**It does not tell anyone where fish are being caught.** No live catch feed
exists for these rivers, so there is nothing honest to show; there is no bite
forecast and no spot predictor. **Not for navigation** — DWR's own metadata says
its bathymetry is not for use as a navigation aid, and that constraint travels
with the data.

There are no tables anywhere in this file. Columns are lost silently on an iPad
while the prose around them still looks fine, so everything below is a headed
list.

## Layout

- `public/` — the deployed site. Nothing here is generated at deploy time.
- `public/index.html` — the whole app, inline CSS and JS.
- `public/sw.js` — the service worker.
- `public/manifest.webmanifest`, `public/icon*.png`, `public/icon.svg` — the PWA.
- `public/vendor/` — Leaflet 1.9.4, taken from `npm pack leaflet@1.9.4`.
- `worker.js` — the proxy that fronts DWR. Not served by Pages.
- `functions/bathy/[[path]].js` — the same proxy, mounted inside the site.
- `functions/version.js` — what commit the live site is actually serving.
- `tools/` — the checks. Test-only; the app needs none of them.

## Deploying

Push to `main`. `.github/workflows/deploy.yml` does the rest, and there is no
Cloudflare dashboard step at any point — the workflow creates the Pages project
if it does not exist.

It needs two repository secrets, and nothing else:

- `CLOUDFLARE_API_TOKEN`, with Pages:Edit on the account.
- `CLOUDFLARE_ACCOUNT_ID`.

Without them the workflow says so and skips the deploy rather than failing red.
Both are stripped of stray whitespace before use: a trailing newline in a pasted
token corrupts the Authorization header and Cloudflare answers 6111.

What the workflow does, in order, and why that order:

- Runs the proxy's allow-list tests. No network, no browser, no credentials —
  it is what stands between a survey proxy and an open proxy, so it runs before
  anything is deployed.
- Compiles `functions/` with wrangler, still before the credentials are in
  scope. `functions/bathy/[[path]].js` imports `worker.js` from outside its own
  directory, which is how there is one allow-list rather than two, and this is
  the step that holds that arrangement up.
- Creates the Pages project if needed, then deploys `public/` with the commit
  SHA attached.
- Asks the live site what it is serving, and fails the job if the answer is not
  this commit or if the proxy did not go out with it.

Actions are pinned by SHA and wrangler by the lockfile, run with
`--no-install`. Nothing in a job that holds a live Pages:Edit token resolves a
version at runtime. `zizmor --strict-collection` passes with no findings.

Production is `cv-thalweg.pages.dev`. Nothing is compiled, so what you read in
`public/index.html` is what runs.

Before the first deploy, and after any change to `functions/`, it is worth
building them the way Cloudflare does:

- `npm run check:functions` runs `wrangler pages functions build`. It compiles
  `functions/` exactly as Pages will, which is the only way to know that
  `functions/bathy/[[path]].js` can import `worker.js` from outside its own
  directory. It can, checked on 27 August 2026: the bundle carries `/bathy`,
  `/bathy/:path*` and `/version`, with both allow-lists inside it. It needs the
  network and no Cloudflare account.

**A push is not a release.** Verifying a push against the remote says nothing
about whether the deploy went out; a site can sit on an older build for
releases while every push is correctly reported as pushed. A static file cannot
say which commit it came from — there is no build step to stamp one in — so
`functions/version.js` reports the commit Pages built from, and
`node tools/check-deploy.mjs` asks the live site rather than the repository:

- that it answers at all, and that it is Thalweg;
- which commit it is serving, compared against the one checked out here;
- that the proxy went out with it, by fetching DWR through `/bathy`;
- that the proxy still refuses a path outside its allow-list.

It exits non-zero on any of those, including when `/version` cannot say what it
is — an endpoint that guessed at a commit would be worse than one that admits
it does not know, because the guess is what you would then trust.

## The proxy

The DWR services are California's public GIS infrastructure, not a tile API.
Without a proxy in front of them, every visitor's pan and zoom lands on
`gis.water.ca.gov`, one request per 256-pixel tile.

There is one implementation, in `worker.js`, because two copies of an
allow-list is how an allow-list goes wrong. It runs two ways:

- **With the site.** `functions/bathy/[[path]].js` mounts it at `/bathy`, so
  Pages serves it alongside the app: same origin, no CORS, one deploy. This is
  the default and `BATHY_PROXY` is already set to `/bathy`.
- **On its own.** `npx wrangler deploy` uses the default export and
  `wrangler.toml`. Then point `BATHY_PROXY` at that Worker's origin instead.

What it will forward, and nothing else:

- The DWR `Bathymetry` image folder and the `i06_Singlebeam_Bathymetry` map
  service. Allow-listed by prefix so a survey published next month needs no
  redeploy, and anchored at a path separator so `BathymetryX` does not match.
- CDEC's read-only data servlets, under a separate `/cdec` namespace that is
  stripped before forwarding. The namespaces cannot reach each other's host.

Everything else gets a 403 — wrong path, wrong method, percent-encoding in the
path, or a traversal attempt. Tiles cache for a year because a finished survey
does not change; feature queries and service metadata cache for a day; gauge
readings are never cached at all, because a reading served from an edge cache is
the exact failure this app is arranged against.

Set `BATHY_PROXY` to an empty string to talk to DWR directly. Fine on a laptop,
and the Layers panel says so in orange; not fine in public.

`node tools/test-worker.mjs` covers all of that — 52 checks, upstream stubbed,
no network. `node tools/serve.mjs` runs the same handler locally, so local work
and production take the same path through the same allow-list.

## Survey coverage, as enumerated on 27 August 2026

The layer list is never typed into the app. It is read from DWR's REST
directory at runtime, and each layer's own extent decides which rivers it
belongs to. These counts are what that enumeration returned on the day; they
will drift as DWR publishes, which is the point of enumerating.

**Multibeam raster, continuous surface, drawn as tiles.** Twenty ImageServers
published in the `Bathymetry` folder. Every one of them is Lambert Conformal
Conic in State Plane California — usually as a WKT string with no EPSG code at
all — so the app carries an inverse projection rather than a guess.

- Sacramento, including its Delta reaches: ten surfaces. Clarksburg at a 1-foot
  grid, Rio Vista, Cache Slough, Georgiana Slough, Steamboat and Sutter
  sloughs, Grizzly Bay, Old River, the lower San Joaquin.
- Mokelumne: nine surfaces, all of them shared Delta water — Georgiana Slough
  is the connection, and the lower San Joaquin and Old River surveys reach it.
- Feather: none. The Layers panel says "No published multibeam survey for this
  reach" rather than showing a switch that turns nothing on.
- American: none, the same way.

**Single beam soundings, discrete points along a boat's track, not a surface.**
Eighty-one layers in the `i06_Singlebeam_Bathymetry` service, every one of them
in Web Mercator. Queried by the current map bounds, hard capped at 3,000
features, with a visible notice when the cap truncates. The whole layer is
never requested.

- Sacramento: fifty-six layers touch it.
- Mokelumne: thirty-three, including the 2005 KSN South Fork survey and the
  1999 USGS White Slough, Bishop Cut and Honker Cut work.
- Feather: seven, including layers 31 and 33 — the August and June 2017 NCRO
  Feather River surveys.
- American: four, of which layer 54, the 2010 CVFED Fugro Delta, American and
  Feather survey, is the one that actually covers the river.

The lists in the app are ranked by how much of each layer's extent falls inside
the reach, and anything past the first eight sits behind a button that counts
what it is hiding.

**Reading the gaps.** Dense aquatic vegetation defeats a sounder, so DWR drops
those cells. A blank patch beside a tule edge is missing data, not flat bottom,
and in vegetated water a return may be the top of the weed rather than the bed.
Single beam data are points along a track; the water between two tracks was
never measured and is not drawn. The app says all of this in the Layers panel.

## What was verified, and how

Every endpoint below was requested from the live service on 27 August 2026 and
answered. `node tools/verify.mjs` is how that is repeated; it reports three
things separately for each call — whether it answers, whether a browser would
be allowed to read it, and whether the response is the shape the code expects.

- **USGS instantaneous values.** All fourteen declared gauge identifiers answer
  with the site name shown beside them in the app. `Access-Control-Allow-Origin: *`.
- **CDEC.** Both Feather stations answer, with the units the parser requires.
  No CORS header, confirmed — hence the proxy.
- **NOAA CO-OPS predictions.** All four declared stations answer.
  `Access-Control-Allow-Origin: *`.
- **NOAA CO-OPS station index.** Answers; forty-four prediction stations fall in
  the Sacramento box and seventeen in the Mokelumne box.
- **DWR bathymetry folder and the single beam service.** Both answer. DWR
  reflects the requesting origin rather than sending a wildcard, so a request
  with no `Origin` header comes back with no CORS header at all — the verifier
  sends one, as a browser would.
- **DWR `exportImage`.** Returns a PNG, and reprojects a Web Mercator bounding
  box onto a State Plane raster correctly. Checked against the basemap.
- **Esri World Imagery and World Topo.** Both return tiles.

Two things could not be verified, because the network this was built on cannot
reach them. Both are handled by the app rather than assumed:

- **NOAA raster chart tiles** at `tileservice.charts.noaa.gov`. The layer is
  offered, marked unverified, and switches itself off with a message if the
  first tiles do not arrive.
- **The CARTO dark basemap.** Same treatment: if its tiles do not arrive the
  Layers panel names the host that did not answer instead of leaving a black
  rectangle.

**The colour ramp is the one that has to be run to be known.** A rendering rule
ArcGIS does not understand is not an error. It is HTTP 200, `image/png`, and a
hundred-odd bytes of empty picture — so no failure probe can tell a working rule
from a broken one, because the failure looks exactly like clear water. Two
things were measured: an explicit `ColorRamp` object is silently ignored, and
the named ramp `Elevation #2` over a percent-clip stretch with dynamic range
adjustment is the one that picks the thalweg out from the flats either side of
it. That is what ships.

## The Feather comes from CDEC, not USGS

No USGS site on the Feather mainstem publishes instantaneous values. Checked on
27 August 2026 against Oroville, Gridley, Yuba City, Shanghai Bend and
Nicolaus: the sites exist, the historical records are there, and the current
series are empty. The Feather is gauged by DWR, through CDEC, so that is where
this river's readings come from.

Two stations, both confirmed against CDEC's own metadata pages rather than
assumed from their identifiers:

- **GRL**, Feather River near Gridley, Butte County. Stage, flow and water
  temperature.
- **FSB**, Feather River at Boyd's Landing above Star Bend, Sutter County.
  Stage and flow; no temperature sensor, so that reading is a dash.

Two more in the basin report and are deliberately absent. The Oroville Fish
Hatchery reports the hatchery's flow rather than the river's, and the Middle
Fork near Portola is above Oroville Dam, which no salmon gets past. Both would
have been plausible and neither is fishery water.

The Yuba at Marysville and the Bear at Wheatland are still shown, from USGS,
marked as tributaries and kept off the ribbon — the ribbon is positions along
one river.

Three things about CDEC shape the code, and each was measured rather than
assumed. It answers with a plain array rather than an envelope. It sends no
`Access-Control-Allow-Origin` at all, so a browser can only read it through
this app's own proxy — which is why `/cdec` exists. And its timestamps carry no
offset, being Pacific by convention, so they are anchored to
`America/Los_Angeles` rather than to the device: read from anywhere else they
would arrive hours adrift, and "how old is this reading" is the one question
this app must not get wrong.

Every value is checked against the units the row itself declares, not against
the sensor number alone. A sensor renumbered or re-scaled at the far end
produces no reading rather than a wrong one, and the reading time follows the
newest value actually used rather than the newest row seen — otherwise a row
refused for its units would print a timestamp newer than anything on screen.
CDEC's `-9999` sentinel, which it returns for timestamps that have not happened
yet, is discarded. All four of those are covered by fixtures in
`tools/render-test.mjs`, and `node tools/verify.mjs --only=cdec` re-checks the
live stations and their units.

## Regulations

The season and limits come from Title 14 section 7.40 as amended by the
California Fish and Game Commission on 6 May 2026: two fish daily, four in
possession, any size, across the American, Feather, Mokelumne and Sacramento
rivers. The reach boundaries in the Brief panel are the words of the amended
subsections — (b)(4), (b)(43), (b)(66) and (b)(80) — read from the Commission's
own filings.

The dates shown are each reach's standing open season. The Commission kept the
discretion to start a reach later or end it earlier, and the final per-reach
dates were given in a Department presentation that is not in the published
filings. The Brief panel says so rather than presenting the window as settled.

**One conflict, resolved.** A third-party aggregator lists the American River
between the SMUD power line at Ancil Hoffman Park and the Jibboom Street bridge
as closed to Chinook. That reach is subsection 7.40(b)(4)(C), one of the four
amended on 6 May 2026, and before the amendment its text read "July 16 through
December 31. No take or possession of Chinook Salmon." The listing appears to be
the pre-2026 rule rather than a second opinion. The Brief panel says that, and
still says the printed regulations are the authority.

## Running the checks

`npm ci` first; the tools need Playwright and axe-core, the app needs neither.

- `node tools/serve.mjs` — serve `public/` on 8787. Local only; Pages serves
  these files directly.
- `npm test` — the Worker's allow-list, refusals, header stripping and cache
  lifetimes, with upstream stubbed. Thirty-four checks, no network.
- `node tools/render-test.mjs` — the parsers and renderers against the
  documented response shapes, including the awkward parts: a missing
  temperature, a -999999, a null depth, a truncated feature query.
- `node tools/a11y.mjs` — axe over every state the app can be in, desktop and
  phone, including the first-run dialog and the update strip, plus an offline
  reload.
- `node tools/verify.mjs` — every network call, executed. Add `--only=usgs`,
  `tide`, `dwr`, `cdec`, `base` or `worker` to narrow it, `--json` for the
  machine.
- `node tools/live-test.mjs` — the whole app end to end against the live
  services.
- `npm run check:functions` — compile `functions/` the way Pages will, before
  finding out at deploy time.
- `node tools/check-deploy.mjs [url] [sha]` — ask the live site what it is
  serving. Defaults to `https://cv-thalweg.pages.dev` and the commit checked
  out here.
- `node tools/render-icons.mjs` — re-rasterise the PNGs after editing
  `icon.svg`.

If your network makes Node's fetch ignore a proxy, run the network ones as
`NODE_USE_ENV_PROXY=1 node tools/verify.mjs`.

## Licence

PolyForm Noncommercial 1.0.0 — see `LICENSE.md`. Leaflet 1.9.4 is vendored under
its own BSD-2-Clause licence.

Owner: Noah Jefferson.
