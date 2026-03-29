# HN Reader — PWA

A lean, battery-efficient Hacker News PWA for Android. Designed to be installed via Firefox so links open in the browser with its adblocker intact.

## Project structure

```
index.html      — entire app (HTML + CSS + JS, single file)
manifest.json   — PWA manifest for home screen installation
CLAUDE.md       — this file
```

Everything lives in `index.html`. There is no build step, no bundler, no dependencies to install.

## How to run locally

Serve the two files over HTTP — opening `index.html` directly as a `file://` URL will break the service worker and API fetches. Any static server works:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open `http://localhost:8080` in your browser.

The PWA install prompt and service worker require **HTTPS** in production, but localhost is exempt.

## How to deploy

Drop both files on any static host. Recommended options:

**Netlify** — drag the folder onto netlify.com/drop. Done, HTTPS included.

**GitHub Pages** — push to a repo, enable Pages from Settings → Pages → Deploy from branch `main` / root.

Once live over HTTPS, open in Firefox for Android and tap the three-dot menu → "Install" to add to the home screen.

## Architecture

### APIs used

| Purpose | API | Notes |
|---|---|---|
| Story feeds | `hn.algolia.com/api/v1/search` | Single request returns 60 full stories |
| Comments | `hn.algolia.com/api/v1/search?tags=comment,story_{id}` | Single request returns up to 500 comments |
| No auth required | — | Both APIs are fully public |

The Algolia HN Search API was chosen over the official Firebase API specifically because it returns complete story/comment data in one request rather than requiring one HTTP round-trip per item.

### Data flow

**Stories:**
1. Algolia `search?tags=front_page&hitsPerPage=60&numericFilters=created_at_i>{24h ago}` → array of hits
2. Filter client-side by `minScore` threshold
3. Sort client-side by `num_comments` descending
4. Render to DOM; cache result in `localStorage`

**Comments:**
1. Algolia `search?tags=comment,story_{id}&hitsPerPage=500` → flat array of all comments
2. Build `childrenOf` map (parent_id → children)
3. DFS walk from story root to reconstruct correct thread order and compute depths
4. Render flat list with CSS `--d` custom property controlling indentation

### Offline / caching

Stories are cached in `localStorage` under keys like `hn3_s_front_page`. On load, the cached version is rendered immediately while a fresh fetch runs in the background. If the network is unavailable, the cache is used silently and an offline badge is shown.

The service worker (registered as an inline blob) caches the app shell and Google Fonts. API calls always go to the network and are never intercepted by the SW.

### localStorage keys

| Key | Contents |
|---|---|
| `hn3_s_{feedName}` | Cached story array for each feed |
| `hn3_read` | JSON array of read story IDs |
| `hn3_score` | Saved minimum score filter value |

## UI behaviour

**Feeds:** top, new, best, ask, show — map to Algolia tags `front_page`, `story` (date-sorted), `story` (relevance-sorted), `ask_hn`, `show_hn`.

**Story tap** — opens the article URL in a new tab. For Ask HN / text-only posts with no URL, opens the comment drawer instead.

**Comment button tap** — opens comment drawer without navigating away.

**Comment drawer** — slides up from the bottom. Close by tapping the ✕ button, tapping the backdrop, or swiping down from the top of the drawer while scrolled to the top.

**Collapse a comment thread** — tap the author/timestamp line. The `[−]` / `[+]` hint on the right shows state. Collapsing hides all descendant comments.

**Pull to refresh** — pull down from the top of the feed (not inside the drawer). Releases at 75px drag threshold.

**Unread tracking** — orange dot on stories not yet tapped. Persists across sessions via localStorage.

**Score filter** — min points input in the filter bar. Filters the already-fetched story list client-side; does not re-fetch.

## Known limitations

- Algolia caps comment results at 1000. Threads with more than 1000 comments will be truncated.
- The service worker is registered from a blob URL, which works in Chrome and Firefox but may be blocked in some hardened browser configurations. If SW registration fails the app still works fully, just without offline shell caching.
- Stories are filtered to the last 24 hours. This is hardcoded in `fetchStories` via `numericFilters=created_at_i>{timestamp}`.

## Suggested improvements for Claude Code

Here are the most valuable things to add or fix, roughly in priority order:

- **Light mode / theme toggle** — currently dark-only. Add a toggle that swaps a `data-theme` attribute on `<html>` and persists the preference.
- **Paginate comments beyond 1000** — use Algolia's `page` parameter to fetch additional pages if `nbHits > hitsPerPage`.
- **Swipe between feed tabs** — horizontal swipe gesture on the feed to move between top/new/best/ask/show.
- **Story time window control** — expose the 24h filter as a UI toggle (e.g. 6h / 24h / 72h) instead of hardcoding it.
- **Share sheet integration** — add a share button on the comment drawer header that calls the Web Share API (`navigator.share`) with the story URL and title.
- **Proper service worker file** — move the inline SW blob to a real `sw.js` file so it can be scoped correctly and pre-cache `index.html` at install time for true offline support.
- **Better PWA icons** — `manifest.json` currently references inline SVG data URIs. Replace with real PNG icon files at 192×192 and 512×512 for correct home screen appearance on all Android launchers.