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
- `worker.js` — the Cloudflare Worker that fronts DWR. Not served by Pages.
- `tools/` — the checks. Test-only; the app needs none of them.

## Deploying

- Cloudflare Pages, connected to this repository.
- Build command: none. Build output directory: `public`.
- Nothing is compiled, so what you read in `public/index.html` is what runs.
- Production is `cv-thalweg.pages.dev`.

## The Worker

The DWR services are California's public GIS infrastructure, not a tile API.
Without a proxy in front of them, every visitor's pan and zoom lands on
`gis.water.ca.gov`, one request per 256-pixel tile.

- Deploy it: `npx wrangler deploy worker.js --name cv-thalweg-bathy`.
- Then set `BATHY_PROXY` at the top of the script block in
  `public/index.html` to the Worker's origin.
- While `BATHY_PROXY` is empty the app talks to DWR directly and says so, in
  orange, in the Layers panel. That is fine for local work and not fine in
  public.
- Two service paths are proxied and nothing else: the `Bathymetry` image
  folder and the `i06_Singlebeam_Bathymetry` map service. The allow-list is by
  prefix so a survey published next month needs no redeploy, and it is anchored
  at a path separator so it cannot become an open proxy for the rest of the
  host. Everything else gets a 403.
- Tiles cache for a year because a finished survey does not change. Feature
  queries and service metadata cache for a day.
- `node tools/test-worker.mjs` covers all of that with the upstream stubbed.

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

## The Feather has no live gauge

No USGS site on the Feather mainstem publishes instantaneous values. Checked on
27 August 2026 against Oroville, Gridley, Yuba City, Shanghai Bend and
Nicolaus: the sites exist, the historical records are there, and the current
series are empty. The Feather is gauged by DWR through CDEC, which this app does
not read.

So the Feather's Water panel says that in words and shows the two tributaries
that join it — the Yuba at Marysville and the Bear at Wheatland — clearly marked
as tributaries and kept off the ribbon, which is positions along one river.
Adding CDEC is the obvious next move and would need its own verification pass.

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
  `tide`, `dwr`, `base` or `worker` to narrow it, `--json` for the machine.
- `node tools/live-test.mjs` — the whole app end to end against the live
  services.
- `node tools/render-icons.mjs` — re-rasterise the PNGs after editing
  `icon.svg`.

If your network makes Node's fetch ignore a proxy, run the network ones as
`NODE_USE_ENV_PROXY=1 node tools/verify.mjs`.

## Licence

PolyForm Noncommercial 1.0.0 — see `LICENSE.md`. Leaflet 1.9.4 is vendored under
its own BSD-2-Clause licence.

Owner: Noah Jefferson.
