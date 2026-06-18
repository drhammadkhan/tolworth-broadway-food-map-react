# Handoff: Tolworth Broadway Food Map

## Overview
A single-page interactive local food guide for the 22 food outlets on Tolworth Broadway (KT6),
rendered in the **"Dala" dark-cosmic design system** (pure-black void, a single violet accent,
ultra-thin display type, particle constellations). It contains five experiences on one page:
a particle hero, an abstract local map of the street, a filterable restaurant directory, a
world-origin constellation, and a review blog with an add-review form that persists to the browser.

## About the Design Files
The files in this bundle are **design references created in HTML** — a streaming "Design Component"
prototype that demonstrates the intended look, layout, motion, and behavior. **They are not
production code to copy verbatim.** The `.dc.html` format uses a bespoke template runtime
(`<x-dc>`, `<sc-for>`, `{{ holes }}`, a `Component extends DCLogic` class) that will not exist in
your codebase.

Your task is to **recreate these designs in the target codebase's existing environment** (React,
Vue, Svelte, SwiftUI, etc.) using its established patterns, component primitives, and state
conventions. If no environment exists yet, pick the most appropriate framework (a React + Vite SPA
is a clean fit here) and implement there. Treat the HTML as the source of truth for **visual design,
copy, data, and interaction logic**, and re-express the runtime-specific parts (the particle canvas,
the projections, the filtering) in your stack's idioms.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, motion, and interactions are all
specified below and present in the prototype. Recreate the UI pixel-accurately using your codebase's
libraries. The exact hex values, type scale, radii, and copy are authoritative.

---

## Data Model

All content is driven by `restaurants.json` (included). 22 records. Each record:

```ts
type Restaurant = {
  id: string;            // slug, e.g. "pepe-s"
  name: string;          // "Pepe's"
  addr: string;          // "46 Tolworth Broadway, KT6 7HR"
  cuisine: string;       // "Peri-Peri Chicken"  (also the filter key)
  origin: string;        // human label, "Portugal / South Africa"
  codes: string[];       // ISO-2 country codes, ["PT","ZA"] — fusion = multiple
  lat: number;           // 51.38...  (real geocoded / interpolated)
  lng: number;           // -0.283...
  rating: number;        // 3.6 – 5.0
  price: string;         // "£" | "££"
  dish: string;          // recommended dish
  summary: string;       // 1-sentence description
  starter: string;       // placeholder "starter note" shown until a real review exists
};
```

A lookup table maps the 13 country codes to `{ name, lat, lng }` for the world map
(IN, TR, GB, US, MX, IR, PT, ZA, IT, AL, GR). It lives in the `CC` object in the logic class.

User-submitted reviews are stored separately (see State Management).

---

## Screens / Views

The page is one vertical scroll. Sticky nav on top. Sections in order: **Hero → Explore (map +
directory) → World map → Reviews → Footer**, plus two modal overlays (detail, review form) and a toast.

### 0. Nav (sticky)
- Sticky top, `z-index:50`, `padding:18px 40px`, background `rgba(0,0,0,0.55)` + `backdrop-filter:blur(14px)`, bottom border `1px solid rgba(255,255,255,0.08)`.
- Left: a 30×30 diamond logo (rotated 45° square, `1.5px solid #8052ff`, radius 8) containing un-rotated "TB" (700/11px), then wordmark "Tolworth Broadway" (600/15px).
- Right: text links **Local map / World map / Reviews** (`#9a9a9a` → `#fff` on hover, 14px/400) as anchors to `#map`, `#world`, `#reviews`; then a filled pill **ADD A REVIEW** (uppercase 600/12px, `#fff` on `#8052ff`, radius 24, padding `11px 18px`, hover `#9168ff`) that opens the review form modal with no restaurant pre-selected.

### 1. Hero (`#top`)
- Full-bleed black `<section>`, `height:82vh; min-height:600px`, `overflow:hidden`.
- **Background:** a full-section `<canvas id="hero-field">` running the particle constellation (see Interactions).
- Inner content `max-width:1200px`, centered, `position:relative; z-index:5`.
- **Stats column, top-right** (`top:60px; right:40px`, text-right): three stacked figures separated by hairline bottom-borders (`1px solid rgba(255,255,255,0.12)`, `padding:16px 0`). Each: a 200-weight 46px number (`letter-spacing:-0.03em`) over an 11px/400 uppercase label (`#9a9a9a`, `letter-spacing:0.07em`):
  - `22` — Food outlets (computed = `DATA.length`)
  - `13` — Origin countries (computed = unique country codes)
  - `{savedReviews}` — Saved reviews (**dynamic**, colored `#8052ff`; starts 0)
- **Headline block, bottom-left** (`left:40px; bottom:52px; max-width:780px`):
  - Eyebrow "22 OUTLETS · ONE STRETCH · KT6" — 600/12px, uppercase, `letter-spacing:0.16em`, `#8052ff`, `margin-bottom:20px` (outlet count is `DATA.length`).
  - `<h1>` "Eat your way<br>down the Broadway." — weight **200**, `font-size:clamp(48px,8vw,94px)`, `line-height:0.86`, `letter-spacing:-0.045em`, `#fff`.
  - Sub-paragraph (`#bdbdbd`, 16px/400, `line-height:1.55`, `max-width:440px`): "Restaurants, origins, reviews and photos from one stretch of Tolworth — mapped marker by marker into a living local food guide."
  - Two pills (`margin-top:30px`, gap 14): filled **EXPLORE THE MAP** → `#map`; outlined **READ REVIEWS** (`1px solid rgba(255,255,255,0.25)`, hover border `#fff`) → `#reviews`.

### 2. Explore — Map + Directory (`#map`)
`max-width:1200px`, `padding:90px 40px 0`, `scroll-margin-top:84px`.
- Eyebrow "LOCAL GUIDE" (`#8052ff`), `<h2>` "Explore every restaurant on Tolworth Broadway." (weight 200, `clamp(34px,5vw,58px)`, `letter-spacing:-0.035em`), muted sub-paragraph.
- **Controls row** (`margin-top:38px`, flex, gap 14, wrap):
  - Search input (flex:1, min 240px): `#0b0b0b` bg, `1px solid rgba(255,255,255,0.14)`, radius 24, `padding:14px 18px 14px 40px`, a `⌕` glyph absolutely placed left; focus border `#8052ff`. Filters live.
  - Cuisine `<select>` (min 190px, same chrome): first option "All cuisines", then unique `cuisine` values sorted A–Z.
  - Reset button: 48×48 circle, `↺`, transparent with hairline border; clears search + cuisine.
  - Below: "Showing **{n}** of 22 outlets".
- **Map panel:** `height:440px`, radius 24, `1px` hairline border, background `radial-gradient(ellipse 70% 90% at 50% 50%, #0a0a14 0%, #000 70%)`, `overflow:hidden`. Contains:
  - Corner labels: "TOLWORTH BROADWAY · A240" (top-left), "← KT6 7DQ" / "KT6 7HT →" (bottom corners), all small uppercase muted.
  - **Street spine:** an SVG `viewBox="0 0 1000 440" preserveAspectRatio="none"` with one `<polyline>` through all markers in west→east order, `stroke:#8052ff; stroke-width:1.5; stroke-opacity:0.55; vector-effect:non-scaling-stroke`, and the SVG carries `filter:drop-shadow(0 0 7px rgba(128,82,255,0.45))` for the glow.
  - **Markers:** one absolutely-positioned circular `<button>` per restaurant. Diameter = `9 + (rating-3.5)*6` px. `transform:translate(-50%,-50%)`; on hover/selected add `scale(1.4)`. Fill: selected `#ffb829`, in-filter `#8052ff`, filtered-out `#333` at `opacity:0.32`. Glow via `box-shadow 0 0 12px rgba(128,82,255,0.55)` (amber variant when selected). A name tooltip (child `<span>`) fades in (`opacity 0→1`) on hover/selected. Click opens the **detail modal**.
- **Directory grid** (`margin-top:24px`): `grid-template-columns:repeat(auto-fill,minmax(290px,1fr))`, gap 18. Cards = filtered set, sorted A–Z by name. Card: `#0a0a0a` bg, `1px solid rgba(255,255,255,0.10)`, radius 24, `padding:24px`, column flex gap 14; hover border `rgba(128,82,255,0.6)` + bg `#0c0a14`. Contents: top row = cuisine pill (outlined violet) + `★ {rating}` (amber); name (weight 200, 27px); origin (11px uppercase muted); summary (`#bdbdbd` 14px); footer row = `{price} · {street}` and a review-count chip ("Starter note" grey, or "N reviews" violet) with "→". Click opens detail modal.
- Empty state when no matches: centered "No outlets match that filter. Reset".

### 3. World origin map (`#world`)
`padding:110px 40px 0`. Eyebrow "WORLD MAP", `<h2>` "See where the food comes from.", sub-paragraph.
- **Panel:** `height:540px`, radius 24, hairline border, same radial-gradient void, `overflow:hidden`.
  - SVG `viewBox="0 0 100 100" preserveAspectRatio="none"`: faint graticule (lines at 25/50/75% both axes, white `opacity 0.04–0.05`), plus one `<line>` per foreign country from the GB hub to that node (`stroke:#8052ff; stroke-opacity:0.4; vector-effect:non-scaling-stroke`, group has a violet drop-shadow).
  - **Nodes:** 11 anchors positioned by an **equirectangular projection fitted to the data's bounding box** (`x = padX + (lng-lngMin)/(lngMax-lngMin)*(100-2padX)`, `y` inverted with latitude; `padX=11, padY=17`). A vertical **de-clustering pass** nudges any node within 11%/12% of an already-placed node downward by 7% until clear (prevents the Mediterranean cluster's labels from colliding). Node = circle of diameter `11 + count*3.4` px; GB hub is `#ffb829` (others `#8052ff`) with matching glow. Label below: country name (12px) + "×{count}" (violet). Clicking a node sets the directory search to that country name and is an anchor to `#map`.
  - Hub caption "◆ TOLWORTH" sits above the GB node in amber.
- **Legend** below (`margin-top:22px`, wrap, gap 10): one hairline pill per country (violet dot + name + count), sorted by count desc.
- Counts (from the data): GB 5, US 5, IN 3, IT 3, TR 2, MX 2, IR 1, PT 1, ZA 1, AL 1, GR 1.

### 4. Review blog (`#reviews`)
`padding:110px 40px 0`. Header row: left = eyebrow "REVIEW BLOG" + `<h2>` "Latest notes and write-ups."; right = a sort `<select>` (Newest review / Rating / Name) and an "ADD A REVIEW" pill.
- **Grid:** `repeat(auto-fill,minmax(330px,1fr))`, gap 18. One card per restaurant showing its **latest user review if any, else its starter note**. Card: `#0a0a0a`, hairline border (hover violet), radius 24, `overflow:hidden`. Optional photo banner (`height:170px; object-fit:cover`) when the latest review has a photo. Body: cuisine label + `★ rating`; name (weight 200, 24px); review text; footer (top hairline) = byline (`#8052ff` for a real reviewer, else "Local Guide" grey) and meta (formatted date, or "Starter note"). Click opens detail modal.
- Sort: **newest** = user-reviewed first by timestamp desc then name; **rating** = rating desc; **name** = A–Z.

### 5. Footer
`max-width:1200px`, top hairline, `padding:48px 40px 60px`, space-between. Left: small TB logo + "Tolworth Broadway Food Map" + "Built from `Tolworth_Broadway_Food_Outlets.xlsx` (monospace). Review submissions are saved in this browser." Right: "TOLWORTH · KT6".

### Modals

**Detail modal** (opened by any marker / directory card / blog card; `z-index:80`):
Fixed full-screen scrim `rgba(0,0,0,0.7)` + blur; click-outside closes; inner panel `max-width:620px`, `#070707`, hairline border, radius 24, `tbfade` entrance. Top: a 180px **striped placeholder banner** (`repeating-linear-gradient(135deg, #0d0d0d 0 11px, #101010 11px 22px)`) with monospace caption `[ storefront photo — {name} ]` and a round close "×" button. Body: cuisine pill + `★ rating`; name (weight 200, 42px); a 3-up meta row (Origin / Address / Price, 10px uppercase labels over 14px values); summary; "Recommended · {dish}". Then a **Reviews** subsection with a "Write a review" button (opens the form pre-set to this restaurant): lists this restaurant's user reviews (name + `★`, optional photo, text, dish · date), or a dashed "Starter note" card when none exist.

**Review form modal** (`z-index:90`): same scrim pattern; panel `max-width:520px`. Title "Add a review" + close. Fields (each label 11px uppercase `#9a9a9a`; inputs `#0b0b0b`, hairline border, radius 14, focus `#8052ff`):
- Restaurant `<select>` — shown only when opened without a pre-set restaurant; otherwise a fixed violet chip naming the restaurant.
- Your name (text) + Visit date (`type=date`, `color-scheme:dark`) side by side.
- Rating — five clickable `★` glyphs (`#ffb829` filled / `rgba(255,255,255,0.22)` empty), hover `scale(1.15)`; label shows "Rating · N.0".
- Recommended dish (text).
- Review (textarea, 4 rows, vertical-resize).
- Photo — a styled "＋ Upload photo" label wrapping a hidden `type=file`; shows a 54×54 rounded preview when set.
- Full-width **SAVE REVIEW** pill + "Saved in this browser only." caption.

**Toast** (`z-index:120`): centered bottom pill, `#8052ff` bg, white 13px, `tbfade` in, auto-dismiss ~2.6s. Used for validation ("Pick a restaurant first", "Add your name and a few words") and success ("Review saved to this browser").

---

## Interactions & Behavior
- **Particle hero:** `<canvas>` with ~`W*H/1500` particles, 60% gaussian-clustered around (0.62W, 0.42H) and the rest scattered. Each is a 2–6px circle/diamond/triangle/square in `#8052ff`/`#ffb829`/`#15846e`/`#fff`, slowly drifting, gently returning toward a home point, twinkling via a sine alpha. Pointer within ~110px repels particles. DPR-capped at 2, `ResizeObserver` re-seeds on resize. Honor `prefers-reduced-motion` in your build (the prototype does not yet).
- **Filtering is shared state:** the search box + cuisine select drive both the directory (hide non-matches) and the map (dim non-matches to 32% with grey fill). Search matches across name+cuisine+origin+address+dish, case-insensitive.
- **Selection:** clicking a marker or card sets `selectedId` (marker turns amber + enlarges) and opens the detail modal.
- **World node click:** sets search query = country name, clears cuisine, anchors to `#map`.
- **Review submit:** validates restaurant + name + text; builds `{id, restaurantId, name, date, rating, dish, text, photo(dataURL), createdAt}`, prepends to the list, persists, closes modal, fires success toast, bumps the "Saved reviews" stat, and surfaces in the blog + detail panels.
- **Transitions:** marker `transform/box-shadow` 0.2s; card border 0.2s; modal/toast `tbfade` (0.25s ease, fade + 8px rise); star hover 0.12s.
- **Navigation:** in-page anchors with `scroll-margin-top:84px` to clear the sticky nav. (Never use `scrollIntoView` if porting to the same runtime constraints; in your own app, normal routing/scroll is fine.)

## State Management
- `q` (search string), `cuisine` ('all' | cuisine), `blogSort` ('newest'|'rating'|'name').
- `selectedId`, `hoverId` (map highlight).
- `modal` (null | 'detail' | 'form'), `activeId` (restaurant in focus).
- `reviews: Review[]` — **persisted to `localStorage` key `tolworth_reviews_v2`** as JSON; loaded on mount.
- `form` — `{ restaurantId, name, date, rating, dish, text, photo }`; photo read via `FileReader` to a data URL.
- `toast` (string | null, auto-clears).
- Derived (memoize where sensible): filtered list, unique cuisines, map node geometry + street polyline, world projection + de-cluster + hub lines, blog items, country counts, average rating.

## Design Tokens

**Colors**
| Token | Hex | Use |
|---|---|---|
| Void | `#000000` | page canvas |
| Bone | `#ffffff` | primary text / hairlines |
| Ash | `#bdbdbd` | secondary text |
| Smoke | `#9a9a9a` | tertiary / nav rest |
| Plum Voltage | `#8052ff` | the only filled accent / CTAs / markers (hover `#9168ff`) |
| Amber Spark | `#ffb829` | ratings, selected marker, hub node |
| Lichen | `#15846e` | occasional particle node color only |
| Surfaces | `#0a0a0a`, `#0b0b0b`, `#070707` | cards, inputs, modals (near-black, no elevation) |
| Hairlines | `rgba(255,255,255,0.08–0.14)` | borders/dividers |

**Type** — single family. Spec font is **Acronym**; the prototype substitutes **Sora** (Google Fonts, weights 200/400/500/600/700). Display headlines are weight **200** with negative tracking; body is 400 with slight positive tracking. Scale: hero `clamp(48–94px)`, section H2 `clamp(34–58px)`, card name 24–27px, body 14–16px, labels/eyebrows 11–12px uppercase.
- Display tracking `-0.035em … -0.045em`; eyebrow/label tracking `0.05–0.16em`; body `~0.02em`.

**Spacing** base 6px → 6/12/18/24/30/36/60/96/120. Section vertical rhythm ~90–110px. Page `max-width:1200px`, gutters 40px.

**Radius** — 24px everywhere interactive (nav, cards, buttons, panels, pills); 14px on form inputs; 12px on small thumbnails; full circles for markers/dots. **No shadows/elevation** anywhere except the intentional violet/amber **glows** on map + world nodes (drop-shadow / box-shadow) — these are a deliberate exception to the system's flat rule, requested for "glowing nodes".

## Assets
- **No raster assets shipped.** Storefront imagery uses CSS striped placeholders; the original spreadsheet referenced `assets/review-images/<slug>.png` which were not provided — wire real photos here if available.
- **Review photos** are user-uploaded at runtime (stored as data URLs in localStorage).
- **Font:** Sora via Google Fonts (swap to licensed "Acronym" if you have it).
- **Glyphs used as icons:** `⌕` (search), `↺` (reset), `★` (rating), `×` (close), `＋` (upload), `◆` (hub) — replace with your icon set if preferred.

## Files
- `Tolworth Broadway Food Map.dc.html` — the full interactive prototype (hero, map, directory, world map, reviews, modals). Primary reference.
- `Tolworth Hero Options.dc.html` — three explored hero treatments (A split / B centered / **C editorial — the one shipped**). Useful for alternate hero layouts.
- `restaurants.json` — the 22-record dataset (source of truth for content + coordinates).
- `DESIGN.md`, `tokens.json`, `variables.css`, `theme.css` — the full "Dala" design system (CSS custom properties + Tailwind v4 `@theme` are ready to paste).

> Note on the `.dc.html` runtime: ignore the `<x-dc>`, `<sc-for>`, `{{ }}` and `Component extends DCLogic`
> scaffolding — that's a prototyping harness. Port the **markup, inline styles, data, and the logic
> class's methods** (filtering, projections, particle engine, persistence) into your framework's
> idioms.
