# Where to Live in DC: Neighborhood Map

An interactive, shareable map of Washington, DC for deciding where to live. It shows every street name, with layers you can turn on and off:

- **Neighborhoods**: DC's 46 official neighborhood clusters and 130+ local neighborhood names. Click an area to see its name and the closest Metro stations, with walking-time estimates.
- **Metro rail**: all 6 lines in their official colors, plus every station. Click a station for its lines, address, and a WMATA link.
- **Landmarks**: the U.S. Capitol, White House, Howard University, Union Station, National Mall, Georgetown University, Nationals Park, and about 20 more.
- **Your pins**: drop pins on places you're considering, give them labels and colors, and drag them to adjust.
- **Shared notes board**: click **Start shared board** to leave sticky notes for each other on a pin, on a neighborhood, or anywhere on the map. Notes show who wrote them and when, each person gets their own note color, and new notes appear for both of you within about 10 seconds. Anyone with the board link can read, add, edit, and delete notes.
- **Share links**: the link holds the map position, the layers you have on, all your pins, and your notes board (if you started one). Click **Copy share link** and send it to a friend. They'll see exactly what you see.

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

Both options work on Netlify's free plan. The shared notes board needs Option B: drag-and-drop uploads only the static map, without the notes Function, so the notes panel would show as offline.

---

## Using the map

| To do this | Do this |
| --- | --- |
| Learn about an area | Click or tap any neighborhood. The popup lists the nearest Metro stations. |
| Save a place | Click **Drop a pin** (or the pin button at the bottom right), then click the map. Type a label and pick a color. |
| Move a pin | Drag it. |
| Leave a note for your friend | Click **Start shared board** in the panel (once). Then tap the note button at the bottom right and tap the map, or open a pin or neighborhood and choose **Add note**. |
| Read, edit, or delete a note | Tap the sticky note on the map, or tap it in the **Shared notes** list to fly there. |
| Share your view | Click **Copy share link** and paste it into a text or email. |
| Change the base map | Use **Streets**, **Light**, or **Classic** at the top of the panel. |

On phones, the controls live in a bottom sheet. Tap its header to open or close it.

The first time you write a note, the map asks for your name. It's saved in your browser only. The board you last used reopens automatically on the same device. To stop seeing it, use **Close board** under the notes list (the notes stay saved for anyone with the link).

---

## For developers

Requires Node.js 20 or newer.

```bash
npm install
npm run dev        # http://localhost:4317 (map only; the notes board shows as offline)
npm run dev:netlify # http://localhost:4319 with the notes Function and a local Blobs store
npm test           # server-side validation tests for the notes board
npm run build      # production build into dist/
npm run preview    # serve dist/ at http://localhost:4318
npm run zip        # build + write release/dc-map-site.zip (for Netlify Drop)
npm run fetch-data # re-download DC GeoJSON into public/data/
```

The build uses relative paths (`base: './'`), so `dist/` works from any host or subfolder.

### Share-link format

All state is kept in the URL hash, so no server is needed:

```
#map=13.50/38.91000/-77.03000&base=light&layers=neighborhoods,metro,landmarks&pins=38.90000,-77.03000,0,Example%20pin~...
```

- `map=zoom/lat/lng`
- `base=streets|light|raster`
- `layers=` comma list from `neighborhoods,labels,metro,landmarks,pins,boundary`
- `pins=` entries separated by `~`, each written as `lat,lng,colorIndex,label` (the label is URL-encoded)
- `board=` optional notes board ID (24+ random URL-safe characters)
- `notes=off` optional; present only when the Notes layer is hidden

Links made before the notes feature keep working unchanged.

### Shared notes board

`netlify/functions/notes.mts` is a Netlify Function at `/api/notes` (GET list, POST create) and `/api/notes/:id` (PATCH edit, DELETE). Notes are stored in a [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) store named `map-notes`, one blob per board.

- The board ID is sent in an `x-board-id` header, never in the request URL, so it stays out of request logs. Blobs are keyed by a SHA-256 hash of the ID, and the function never logs it.
- The server rejects malformed or short IDs, caps notes at 500 characters, names at 30, boards at 200 notes, and request bodies at 4 KB, and only accepts coordinates in the DC area.
- Writes use ETag-conditional saves, so two people saving at the same moment don't overwrite each other.
- Rate limits: Netlify's platform limit (120 requests per minute per IP) plus a per-instance backstop (30 writes per minute per IP).
- The page polls every 10 seconds while visible and refreshes right away when you switch back to the tab. If the Function can't be reached, the panel shows an offline notice and pauses editing.

### Project layout

```
index.html               page shell and panel markup
src/main.ts              map setup, overlays, popups, pins, share
src/state.ts             URL hash encode/decode
src/board.ts             notes board client (polling, offline state)
netlify/functions/       notes API (Netlify Function)
netlify/lib/             notes validation, with tests
src/basemaps.ts          keyless base map styles
src/data/landmarks.ts    landmark list
src/data/metro.ts        WMATA colors and nearest-station math
public/data/*.geojson    bundled DC Open Data layers
scripts/fetch-data.mjs   downloads and slims the GeoJSON
netlify.toml             Netlify build settings
release/dc-map-site.zip  prebuilt site for Netlify Drop
```

### Privacy and configuration

- No API keys, accounts, or private data anywhere in the code or the repository. Only keyless public tile services and public datasets are used.
- Your pins and labels live only in the share link (the part after `#`). They never reach a server or this repository. Browsers don't send the `#` part to the web host, so Netlify never sees it.
- Notes live in Netlify Blobs on your Netlify site, not in this repository. Treat the board link like a private link: anyone who has it can read and change the notes. Your name and last board ID are stored only in your browser (localStorage).
- No configuration is needed. If a setting is ever added, it goes in a gitignored `.env` file, documented in `.env.example`.

### Data sources

- Neighborhood clusters, neighborhood names, DC boundary, Metro lines and stations: [DC Open Data / DC GIS](https://opendata.dc.gov) (public domain).
- Base map: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, via [OpenFreeMap](https://openfreemap.org) and [CARTO](https://carto.com/attributions).
- Walking times are rough estimates based on straight-line distance (about 20 minutes per mile, plus 25% to allow for street routes).
