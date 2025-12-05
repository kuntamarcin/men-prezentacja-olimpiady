# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Development and commands

### Local preview

This is a static HTML/CSS/JS application with no build step. To work on it locally, serve the repository root as static files and open `index.html` in a browser.

Example options:

```bash
# Using a simple static server (requires Node.js)
npx serve .
```

```bash
# Using Python's built-in HTTP server
python3 -m http.server 4173
```

Then open `http://localhost:4173/` (or the URL printed by the server) in a browser.

### Build and deployment

- There is **no build command**; `netlify.toml` sets `build.command = "# no build command"`, so Netlify (or any static host) serves files directly from the repository.
- The app entry point is `index.html`, which loads `style.css`, `app.js`, and two background videos `bg-1.mp4` and `bg-2.mp4`.

### Tests and linting

- There is no test framework configured (no `package.json`, no test scripts, and no test files).
- There is no configured linter or formatter.

If tests or linting are added in the future, prefer to document how to run them here.

## Architecture overview

### High-level structure

This project is a single-page, fullscreen presentation for contest laureates:

- `index.html` defines the DOM structure: loading overlay, video background layer, slide container, start overlay (with "Start presentation" and "Download offline" buttons), and an error overlay.
- `style.css` defines typography, video backgrounds, slide layout, animations, overlays, and button styles. It also embeds the `Uni Sans Heavy` font from `fonts/Uni Sans Heavy.otf`.
- `app.js` contains all application logic: data fetching/parsing, slide model creation, rendering, animations, offline ZIP generation, keyboard navigation, and initialization.
- `netlify.toml` configures a Netlify deployment as a static site with no build step.

There are no modules or bundlers; all logic lives in `app.js` and executes in the browser.

### Data flow and state

- Data source:
  - Online mode fetches contest data from a Google Sheet via the Google Visualization API JSON endpoint, using the hard-coded `SHEET_ID` in `app.js`.
  - Offline mode uses `window.OFFLINE_CONTESTS`, a precomputed JSON structure embedded into the generated offline HTML.
- Parsing:
  - `fetchSheetData()` downloads the sheet and extracts the JSON table from the JSONP response.
  - `parseContestsFromTable(table)` maps sheet rows into a normalized `contests` array, each contest containing a `title`, `organizer`, and an array of `winners` with `name`, `school`, and `region`.
  - Column lookup is resilient: it first tries metadata labels; if missing, it infers header indices from the first row values.
- Slides:
  - `buildSlidesFromContests(contests)` converts contests into a linear `slides` array in the global `state`.
  - Contests without winners become a single `titleOnly` slide; contests with winners become a `title` slide followed by a `winners` slide.
- Global state is held in the `state` object (`contests`, `slides`, `currentSlideIndex`, `presentationStarted`, `pollingTimer`, `currentAnimation`). All rendering and navigation functions read/write this state.

### Rendering and navigation

- Rendering pipeline:
  - `renderCurrentSlide()` reads the current slide from `state.slides`, clears `#slide-layer`, and injects freshly created slide content.
  - `createTitleSlideContent(contest, { blue })` builds title-only or title slides, optionally using a blue color scheme for `titleOnly`.
  - `createWinnersSlideContent(contest)` builds the winners slide, including a header and one block per winner.
  - `fitSlideContentToSafeArea()` measures the slide content height vs. the `#slide-layer` height and scales the entire content down if necessary so that very long lists still fit onscreen.
  - `setBackgroundForSlide(slide)` toggles visibility between `#video-title-bg` and `#video-winners-bg` so title and winners slides use different looping backgrounds.
- Helpers and formatting:
  - `fixOrphans(text)` enforces non-breaking spaces after common short Polish words (to avoid typographic orphans) and bolds the word "Olimpiada".
  - `showError(message)` writes to `#error-message` and logs to the console.
- Navigation:
  - `nextSlide`, `prevSlide`, `goToFirstSlide`, and `goToLastSlide` update `state.currentSlideIndex` and call `renderCurrentSlide()`.
  - `setupKeyboardNavigation()` binds arrow keys, `PageUp/PageDown`, `Home`, `End`, and spacebar to these navigation functions, active only after the presentation starts.
- Presentation lifecycle:
  - `startPresentation()` hides the start overlay, marks `presentationStarted`, renders the first slide, and starts background polling.
  - `requestFullscreen()` attempts to enter fullscreen for the entire document.

### Animations

- Animations are powered by the external `anime.js` library loaded in `index.html`.
- `fadeInSequence(elements)` animates any elements with the `.fade-seq` class using a staggered fade/translate/scale-in effect:
  - It cancels any existing animation stored in `state.currentAnimation`.
  - It stages all elements with initial opacity/transform and then runs a single `anime()` call with a staggered `delay` for a dignified, sequential reveal (title → subtitle → winners).

### Polling and live updates

- `startPolling()` sets up periodic refresh only in online mode (skipped when `window.OFFLINE_CONTESTS` is defined).
- `refreshData()` re-fetches the sheet, rebuilds `contests` and `slides`, and attempts to preserve the current slide by matching contest title and slide type. If the current slide disappears, it clamps the index to a valid range and re-renders if the presentation is running.

### Offline export

- The "Download offline" button in `index.html` is wired to `generateOfflineZip()` via a click listener in the `DOMContentLoaded` handler.
- `generateOfflineZip()`:
  - Fetches the current contests (from `window.OFFLINE_CONTESTS` if present, otherwise from the live sheet).
  - Fetches runtime assets: background videos, the `Uni Sans Heavy` font, `app.js`, `style.css`, and the minified `anime.js` script.
  - Assembles an offline `index.html` string that embeds `style.css` inline, includes a small inline script setting `window.OFFLINE_CONTESTS` to the fetched JSON, and loads `app.js` and `anime.min.js` as separate files.
  - Uses `JSZip` to create a `prezentacja-offline.zip` containing `index.html`, `anime.min.js`, `app.js`, both background videos, and the font under `fonts/`.
  - Triggers a download in the browser and restores the button UI state.

### Initialization sequence

On `DOMContentLoaded`:

1. `setupKeyboardNavigation()` is called.
2. DOM references are captured for overlays, the start button, the download button, and the background videos.
3. Click handlers are attached to the start button (fullscreen + `startPresentation`) and the offline download button (`generateOfflineZip`).
4. A safety net timeout hides the loading overlay and shows an error if initialization takes too long.
5. The app:
   - Fetches contests (from the sheet or `window.OFFLINE_CONTESTS`).
   - Builds `state.slides`.
   - Waits for video `canplaythrough` events (with a timeout fallback).
   - Hides the loading overlay, shows the start overlay, and ensures the title background video is visible.
   - Shows an error if there is no data to display.

If initialization fails at any step, the error overlay is shown with a generic error message.
