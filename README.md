# Where to Live in DC: Neighborhood Map

An interactive, shareable map of Washington, DC for deciding where to live. It shows every street name, with layers you can turn on and off:

- **Neighborhoods**: DC's 46 official neighborhood clusters and 130+ local neighborhood names. Click an area to see its name and the closest Metro stations, with walking-time estimates.
- **Metro rail**: all 6 lines in their official colors, plus every station. Click a station for its lines, address, and a WMATA link.
- **Landmarks**: the U.S. Capitol, White House, Howard University, Union Station, National Mall, Georgetown University, Nationals Park, and about 20 more.
- **Your pins**: drop pins on places you're considering, give them labels and colors, and drag them to adjust.
- **Share links**: the link holds the map position, the layers you have on, and all your pins. Click **Copy share link** and send it to a friend. They'll see exactly what you see.

No accounts or API keys needed. The base maps come from free OpenStreetMap-based services ([OpenFreeMap](https://openfreemap.org) vector tiles, with a [CARTO](https://carto.com) raster "Classic" fallback). All DC data is bundled in `public/data/`.

---

## Put it online for free with Netlify

You only need to do this once. Afterwards anyone can open the map from a link like `https://your-dc-map.netlify.app`.

### Option A: Drag and drop (easiest, no coding tools)

1. Get the ready-made website zip: download **`release/dc-map-site.zip`** from this repository (open the file on GitHub and click **Download raw file**).
2. Unzip it. You'll get a folder with `index.html`, an `assets` folder, and a `data` folder in it.
3. Go to **[app.netlify.com/drop](https://app.netlify.com/drop)**. Sign up for a free account if you're asked to.
4. Drag the **unzipped folder** onto the page.
5. Wait a few seconds. Netlify shows a link such as `https://random-name-123.netlify.app`. That's your map.
6. (Optional) To pick a nicer name, go to **Site configuration → Change site name**.

To update the site later, open the site in Netlify, go to the **Deploys** tab, and drag the new folder onto the drop area.

### Option B: Connect the GitHub repository (updates itself)

This way, Netlify rebuilds the site automatically every time the repository changes.

1. Sign in at **[app.netlify.com](https://app.netlify.com)** (choosing "Sign up with GitHub" is simplest).
2. Click **Add new site → Import an existing project**.
3. Choose **GitHub** and approve access. Then pick this repository.
4. Netlify reads the settings from `netlify.toml` on its own: build command `npm run build`, publish folder `dist`. Leave everything as it is and click **Deploy**.
5. After a minute or two you'll get your `https://….netlify.app` link.

Both options work on Netlify's free plan.

---

## Using the map

| To do this | Do this |
| --- | --- |
| Learn about an area | Click or tap any neighborhood. The popup lists the nearest Metro stations. |
| Save a place | Click **Drop a pin** (or the pin button at the bottom right), then click the map. Type a label and pick a color. |
| Move a pin | Drag it. |
| Share your view | Click **Copy share link** and paste it into a text or email. |
| Change the base map | Use **Streets**, **Light**, or **Classic** at the top of the panel. |

On phones, the controls live in a bottom sheet. Tap its header to open or close it.

---

## For developers

Requires Node.js 20 or newer.

```bash
npm install
npm run dev        # http://localhost:4317
npm run build      # production build into dist/
npm run preview    # serve dist/ at http://localhost:4318
npm run zip        # build + write release/dc-map-site.zip (for Netlify Drop)
npm run fetch-data # re-download DC GeoJSON into public/data/
```

The build uses relative paths (`base: './'`), so `dist/` works from any host or subfolder.

### Share-link format

All state is kept in the URL hash, so no server is needed:

```
#map=13.50/38.91000/-77.03000&base=light&layers=neighborhoods,metro,landmarks&pins=38.91450,-77.03210,0,Apt%20on%2014th~...
```

- `map=zoom/lat/lng`
- `base=streets|light|raster`
- `layers=` comma list from `neighborhoods,labels,metro,landmarks,pins,boundary`
- `pins=` entries separated by `~`, each written as `lat,lng,colorIndex,label` (the label is URL-encoded)

### Project layout

```
index.html               page shell and panel markup
src/main.ts              map setup, overlays, popups, pins, share
src/state.ts             URL hash encode/decode
src/basemaps.ts          keyless base map styles
src/data/landmarks.ts    landmark list
src/data/metro.ts        WMATA colors and nearest-station math
public/data/*.geojson    bundled DC Open Data layers
scripts/fetch-data.mjs   downloads and slims the GeoJSON
netlify.toml             Netlify build settings
release/dc-map-site.zip  prebuilt site for Netlify Drop
```

### Data sources

- Neighborhood clusters, neighborhood names, DC boundary, Metro lines and stations: [DC Open Data / DC GIS](https://opendata.dc.gov) (public domain).
- Base map: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, via [OpenFreeMap](https://openfreemap.org) and [CARTO](https://carto.com/attributions).
- Walking times are rough estimates based on straight-line distance (about 20 minutes per mile, plus 25% to allow for street routes).
