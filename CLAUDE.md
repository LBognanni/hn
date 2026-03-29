# HN Reader — PWA

A lean, battery-efficient Hacker News PWA for Android. Designed to be installed via Firefox so links open in the browser with its adblocker intact.

## Project structure

```
index.html      — markup only
style.css       — all styles
app.js          — all application logic
sw.js           — service worker
manifest.json   — PWA manifest for home screen installation
CLAUDE.md       — this file
```

No build step, no bundler, no dependencies to install.

## How to run locally

Serve over HTTP — opening `index.html` as a `file://` URL will break the service worker and API fetches:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

The PWA install prompt and service worker require **HTTPS** in production, but localhost is exempt.

## How to deploy

Drop the folder on any static host.

**Netlify** — drag the folder onto netlify.com/drop.

**GitHub Pages** — push to a repo, enable Pages from Settings → Pages → Deploy from branch `main` / root.

Once live over HTTPS, open in Firefox for Android → three-dot menu → "Install".

## Architecture

### APIs used

| Purpose | API |
|---|---|
| Stories by day | `hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=created_at_i>=X,created_at_i<Y` |
| Comments | `hn.algolia.com/api/v1/search?tags=comment,story_{id}&hitsPerPage=500` |

Both APIs are fully public, no auth required. Algolia was chosen over the Firebase API because it returns complete data in a single request.

### Data flow

**Stories:**
1. Fetch stories for the current UTC calendar day via Algolia time-range filter
2. Sort client-side by `num_comments` descending
3. Render to DOM; cache result in `localStorage` keyed by date (`hn3_s_YYYY-MM-DD`)

**Comments:**
1. Algolia `search?tags=comment,story_{id}&hitsPerPage=500` → flat array
2. Build `childrenOf` map (parent_id → children)
3. DFS walk from story root to reconstruct thread order and compute depths
4. Render flat list with CSS `--d` custom property controlling indentation

### Offline / caching

Stories are cached in `localStorage`. On load, the cache renders immediately while a fresh fetch runs in the background. If offline, the cache is used silently and an offline badge is shown.

`sw.js` caches the app shell (`index.html`, `style.css`, `app.js`) and Google Fonts. Algolia API calls are never intercepted.

### localStorage keys

| Key | Contents |
|---|---|
| `hn3_s_YYYY-MM-DD` | Cached story array for that UTC day |
| `hn3_read` | JSON array of read story IDs |

## UI behaviour

**Date navigation** — bottom bar shows the current day with `←` / `→` buttons to move between days. Forward button disabled on today.

**Story tap** — opens the comment drawer. The story title inside the drawer links to the article.

**Comment button tap** — also opens the comment drawer (same as tapping the story row).

**Comment drawer** — full-screen slide-up. Close via ✕ button, backdrop tap, or swipe down from the top while scrolled to the top. URL hash is updated to `#storyId` so the browser back button closes the drawer and forward reopens it.

**Collapse a comment thread** — tap anywhere on a comment. Collapsing hides all descendant comments.

**Pull to refresh** — pull down from the top of the feed (not inside the drawer). Releases at 75px threshold.

**Unread tracking** — orange dot on unread stories. Persists across sessions via localStorage.

## Known limitations

- Algolia caps comment results at 1000. Threads with more than 1000 comments will be truncated.
- Stories are scoped to UTC calendar days, so a story posted at 11pm in your local timezone may appear on a different day than expected.
