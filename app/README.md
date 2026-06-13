# Tolworth Broadway Food Map

A single-page interactive local food guide for the 19 food outlets on Tolworth
Broadway (KT6), built in the **"Dala" dark-cosmic design system** (pure-black void,
violet accent, ultra-thin display type, particle constellations).

This is the production implementation of the design handoff in the parent directory
(`../DESIGN.md`, `../README.md`). It is a **React + Vite SPA** with no backend —
user-submitted reviews persist to `localStorage`.

## Run

```bash
npm install
npm run dev      # dev server on http://localhost:5173
npm run build    # production build to dist/
npm run preview  # preview the production build
```

## Structure

Everything lives in `src/App.jsx` (single-file by design — the prototype is one page):

- **Data** — `src/restaurants.json` (the handoff dataset) is normalised at the top of
  `App.jsx` into the field names the UI uses (`addr`, `cuisine`, `codes`, `dish`, etc.).
- **`useHero`** — the particle-constellation canvas engine (DPR-capped, `ResizeObserver`
  re-seed, pointer-repel).
- **`LocalMap`** — a real [Leaflet](https://leafletjs.com) map (via `react-leaflet`)
  using free CARTO dark tiles. Markers are placed at each outlet's true `lat`/`lng`,
  styled as brand-coloured glowing pins (violet / amber-when-selected, sized by rating,
  dimmed when filtered out), with hover/selected tooltips and a violet polyline tracing
  the street west→east. The map panel uses `isolation: isolate` so Leaflet's internal
  z-indexes stay contained and the detail/review modals render above it.
- **Geometry helpers** — `computeWorld` (equirectangular projection + vertical
  de-cluster for the world map) is computed once at module load, alongside the local
  map's `STREET_ORDER` / `MAP_BOUNDS`.
- **Sections** — `Nav`, `Hero`, `MapSection`, `WorldSection`, footer.
- **Modals** — `DetailModal`, `ReviewFormModal`, and the `Toast`.
- **State** — search query, cuisine filter, directory sort, selection/hover, the active
  modal, and the reviews array (persisted under `localStorage` key
  `tolworth_reviews_v2`).

## Sections

Hero (particle field + stats) → Explore (local map + the unified restaurant directory)
→ World origin map → Footer. Two modal overlays (restaurant detail, review form) and a
bottom toast.

Each restaurant appears **once**, in a single directory card (`#directory`, in
`MapSection`) that merges general info — cuisine, rating, origin, summary — with its
latest review (reviewer, rating, quoted text, photo banner) or a "starter note" when
none exists yet. The directory shares search + cuisine filters with the map and adds a
sort control (name / rating / newest review). Clicking a card (or a map marker, or a
world-map node) opens the detail modal where the full review history lives.

## Design system

Colors, type scale, spacing, and radii follow the Dala tokens in `../DESIGN.md`
(`#8052ff` plum-voltage accent, `#ffb829` amber for ratings/selection, Sora as the
Acronym substitute). The only deliberate exception to the system's flat/no-shadow rule
is the violet/amber **glows** on map and world-map nodes, as specified in the handoff.

## Notes / TODO

- **Reduced motion** — the handoff calls for honoring `prefers-reduced-motion` in the
  particle hero; not yet wired up.
- **Storefront photos** — the dataset references `assets/review-images/<slug>.png`,
  which were not shipped. The detail modal and cards use CSS striped placeholders;
  drop real images in and wire them up when available.
- **Font** — using Sora (Google Fonts) as the Acronym substitute; swap to licensed
  Acronym if available.
