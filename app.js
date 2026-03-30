import { h, render } from 'https://esm.sh/preact@10.25.4';
import { useState, useEffect, useCallback, useRef, useMemo, useReducer } from 'https://esm.sh/preact@10.25.4/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
const html = htm.bind(h);

// ── Constants & helpers ─────────────────────────────────────────────

const ALGOLIA   = 'https://hn.algolia.com/api/v1';
const CACHE_PFX     = 'hn3_';
const READ_KEY      = 'hn3_read';
const COLLAPSED_PFX = 'hn3_col_';
const DAY_MS        = 86400000;
const DAY_S         = 86400;
const COLLAPSED_TTL = 7 * DAY_MS;

const todayUTC = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};
const dateKey = d => d.toISOString().slice(0, 10);
const fmtDate = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

const ago = t => {
  const s = Math.floor(Date.now() / 1000 - t);
  if (s < 60)    return s + 's';
  if (s < 3600)  return Math.floor(s / 60) + 'm';
  if (s < DAY_S) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / DAY_S) + 'd';
};

const host = url => {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
};

// ── LocalStorage helpers ────────────────────────────────────────────

const cacheSet = (k, v) => {
  try { localStorage.setItem(CACHE_PFX + k, JSON.stringify(v)); } catch {}
};
const cacheGet = k => {
  try { return JSON.parse(localStorage.getItem(CACHE_PFX + k)); }
  catch { return null; }
};
const loadReadIds = () => {
  try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) || '[]')); }
  catch { return new Set(); }
};
const saveReadIds = ids => {
  try { localStorage.setItem(READ_KEY, JSON.stringify([...ids])); } catch {}
};

const loadCollapsed = storyId => {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSED_PFX + storyId));
    if (!raw || Date.now() - raw.ts > COLLAPSED_TTL) return new Set();
    return new Set(raw.ids);
  } catch { return new Set(); }
};
const saveCollapsed = (storyId, set) => {
  try {
    if (set.size === 0) localStorage.removeItem(COLLAPSED_PFX + storyId);
    else localStorage.setItem(COLLAPSED_PFX + storyId, JSON.stringify({ ids: [...set], ts: Date.now() }));
  } catch {}
};

// ── API ─────────────────────────────────────────────────────────────

const fetchStories = async (day) => {
  const start = day.getTime() / 1000;
  const end   = start + DAY_S;
  const url   = `${ALGOLIA}/search_by_date?tags=story&hitsPerPage=1000&numericFilters=created_at_i>=${start},created_at_i<${end}`;
  const r     = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const json  = await r.json();
  return (json.hits || []).map(h => ({
    id:          parseInt(h.objectID),
    title:       h.title || '(untitled)',
    url:         h.url   || null,
    score:       h.points || 0,
    by:          h.author || '',
    time:        h.created_at_i || 0,
    descendants: h.num_comments || 0,
  }));
};

const fetchComments = async (storyId, storyAuthor) => {
  const url  = `${ALGOLIA}/search?tags=comment,story_${storyId}&hitsPerPage=500`;
  const r    = await fetch(url);
  const json = await r.json();
  const hits = (json.hits || []).filter(h => h.author && !h._deleted_);
  if (!hits.length) return [];

  const childrenOf = {};
  hits.forEach(h => {
    const p = String(h.parent_id);
    if (!childrenOf[p]) childrenOf[p] = [];
    childrenOf[p].push(h);
  });

  const flat = [];
  const walk = (parentId, depth) => {
    (childrenOf[parentId] || []).sort((a, b) => a.created_at_i - b.created_at_i).forEach(h => {
      flat.push({
        id:    h.objectID,
        by:    h.author,
        text:  h.comment_text || '',
        time:  h.created_at_i || 0,
        depth,
        isOp:  h.author === storyAuthor,
      });
      walk(h.objectID, depth + 1);
    });
  };
  walk(String(storyId), 0);
  return flat;
};

const fetchStoryItem = async (id) => {
  const r    = await fetch(`${ALGOLIA}/items/${id}`);
  const item = await r.json();
  return {
    id:          item.id,
    title:       item.title || '(untitled)',
    url:         item.url   || null,
    score:       item.points || 0,
    by:          item.author || '',
    time:        item.created_at_i || 0,
    descendants: item.children ? item.children.length : 0,
  };
};

// ── Hash / history helpers ──────────────────────────────────────────

const parseHash = () => {
  const h = location.hash.slice(1);
  if (!h) return { date: null, storyId: null };
  const parts = h.split('/');
  if (/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
    return { date: parts[0], storyId: parts[1] ? parseInt(parts[1]) : null };
  }
  return { date: null, storyId: parseInt(parts[0]) || null };
};

const dateHash = (day, storyId) => {
  const d = dateKey(day);
  return storyId ? `${d}/${storyId}` : d;
};

// ── Reducer ─────────────────────────────────────────────────────────

const initState = (day) => ({
  currentDay:       day,
  stories:          [],
  readIds:          loadReadIds(),
  loading:          false,
  loadGeneration:   0,
  error:            null,
  drawerStoryId:    null,
  drawerStory:      null,
  drawerOwnsHistory: false,
  comments:         null, // null | 'loading' | [] | 'error'
  offlineFlash:     false,
});

const reducer = (state, action) => {
  switch (action.type) {
    case 'SET_DAY':
      return { ...state, currentDay: action.day, stories: [], error: null, loadGeneration: state.loadGeneration + 1 };
    case 'LOAD_START':
      return { ...state, loading: true, error: null };
    case 'LOAD_CACHED':
      if (action.generation !== state.loadGeneration) return state;
      return { ...state, stories: action.stories };
    case 'LOAD_SUCCESS':
      if (action.generation !== state.loadGeneration) return state;
      return { ...state, stories: action.stories, loading: false };
    case 'LOAD_FAIL':
      if (action.generation !== state.loadGeneration) return state;
      return { ...state, error: action.error, loading: false };
    case 'MARK_READ': {
      const readIds = new Set(state.readIds);
      readIds.add(action.id);
      return { ...state, readIds };
    }
    case 'OPEN_DRAWER':
      return { ...state, drawerStoryId: action.storyId, drawerStory: action.story || null, drawerOwnsHistory: action.pushHistory, comments: 'loading' };
    case 'SET_DRAWER_STORY':
      return { ...state, drawerStory: action.story };
    case 'SET_COMMENTS':
      return { ...state, comments: action.comments };
    case 'CLOSE_DRAWER':
      return { ...state, drawerStoryId: null, drawerStory: null, drawerOwnsHistory: false, comments: null };
    case 'FLASH_OFFLINE':
      return { ...state, offlineFlash: action.show };
    default:
      return state;
  }
};

// ── Components ──────────────────────────────────────────────────────

function Status({ icon, message, isError }) {
  return html`
    <div id="status" class=${isError ? 'err' : ''}>
      <span class="ico" dangerouslySetInnerHTML=${{ __html: icon }} />
      ${message}
    </div>`;
}

function Story({ story, index, isRead, animate, onOpen }) {
  const d = host(story.url);
  return html`
    <div class="story ${isRead ? 'read' : 'unread'}"
         style=${animate ? `animation-delay:${Math.min(index * 0.025, 0.5)}s` : 'animation:none'}
         onClick=${() => onOpen(story.id)}>
      <div class="rank">${index + 1}</div>
      <div>
        <div class="s-title">
          ${!isRead && html`<span class="dot" />`}
          ${story.title}
          ${d ? html` <span class="domain">${d}</span>` : null}
        </div>
        <div class="s-meta">
          <span class="pts" dangerouslySetInnerHTML=${{ __html: '&#x25B2; ' + story.score }} />
          <span>${ago(story.time)}</span>
          <span>${story.by}</span>
          <button class="cmt-btn">
            <span>🗨</span> ${ story.descendants } 
          </button>
        </div>
      </div>
    </div>`;
}

function Feed({ stories, readIds, loading, error, animate, onOpenStory }) {
  const filtered = useMemo(
    () => stories.filter(s => s.descendants > 0 || s.score > 0).sort((a, b) => b.descendants - a.descendants),
    [stories]
  );

  if (loading && !filtered.length) {
    return html`<div id="feed"><${Status} icon="\u25CC" message="loading\u2026" /></div>`;
  }
  if (error && !filtered.length) {
    return html`<div id="feed"><${Status} icon="\u2715" message="failed to load \u2014 check connection" isError /></div>`;
  }
  if (!filtered.length) {
    return html`<div id="feed"><${Status} icon="\u25EF" message="no stories" /></div>`;
  }

  return html`
    <div id="feed">
      ${filtered.map((s, i) => html`
        <${Story} key=${s.id} story=${s} index=${i}
                  isRead=${readIds.has(s.id)} animate=${animate}
                  onOpen=${onOpenStory} />
      `)}
    </div>`;
}

function Comment({ comment, collapsed, onToggle }) {
  return html`
    <div class="comment ${collapsed ? 'col' : ''}"
         data-d=${comment.depth} style="--d:${comment.depth}"
         onClick=${e => {
           if (e.target.closest('a') || window.getSelection().toString()) return;
           onToggle(comment.id);
         }}>
      <div class="c-head">
        <span class="c-by${comment.isOp ? ' op' : ''}">${comment.by}${comment.isOp ? ' \u2605' : ''}</span>
        <span class="c-age">${ago(comment.time)}</span>
      </div>
      <div class="c-body" style="padding-left:calc(${comment.depth} * 13px)"
           dangerouslySetInnerHTML=${{ __html: comment.text }} />
      <div class="c-col-info" style="padding-left:calc(${comment.depth} * 13px)">thread collapsed</div>
    </div>`;
}

function CommentList({ comments, storyId }) {
  const [collapsed, setCollapsed] = useState(() => loadCollapsed(storyId));

  // Load persisted collapsed state when story changes
  useEffect(() => { setCollapsed(loadCollapsed(storyId)); }, [storyId]);

  // Persist collapsed state
  useEffect(() => { if (storyId) saveCollapsed(storyId, collapsed); }, [storyId, collapsed]);

  const toggle = useCallback((id) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (comments === 'loading') {
    return html`<div id="c-loading">loading comments\u2026</div>`;
  }
  if (comments === 'error') {
    return html`<div id="c-loading">failed to load comments</div>`;
  }
  if (!comments || !comments.length) {
    return html`<div id="c-loading">no comments yet</div>`;
  }

  // Filter out children of collapsed comments
  const visible = [];
  const collapsedDepths = []; // stack of [id, depth] of collapsed ancestors
  for (const c of comments) {
    // Pop ancestors that are at same or deeper depth (we've moved past their subtree)
    while (collapsedDepths.length && collapsedDepths[collapsedDepths.length - 1][1] >= c.depth) {
      collapsedDepths.pop();
    }
    if (collapsedDepths.length) continue; // hidden by a collapsed ancestor
    visible.push(c);
    if (collapsed.has(c.id)) collapsedDepths.push([c.id, c.depth]);
  }

  return html`${visible.map(c => html`
    <${Comment} key=${c.id} comment=${c}
                collapsed=${collapsed.has(c.id)} onToggle=${toggle} />
  `)}`;
}

function Drawer({ storyId, story, comments, onClose, drawerRef }) {
  if (!story) {
    return html`
      <div id="drawer" ref=${drawerRef}>
        <div id="d-scroll"><div id="c-loading">loading\u2026</div></div>
      </div>`;
  }
  const d = host(story.url);
  return html`
    <div id="drawer" class=${storyId ? 'open' : ''} ref=${drawerRef}>
      <div id="d-head">
        <a id="d-title" href=${story.url || null}
           target="_blank" rel="noopener noreferrer">${story.title}</a>
        <div id="d-meta">
          <span dangerouslySetInnerHTML=${{ __html: '&#x25B2; ' + story.score }} />
          <span>${story.descendants} comments</span>
          <span>${story.by}</span>
          <span>${ago(story.time)}</span>
        </div>
        <button id="d-close" onClick=${onClose}>\u2715</button>
      </div>
      ${story.url ? html`
        <a id="d-link" href=${story.url} target="_blank" rel="noopener noreferrer">
          ${'\u2197 ' + (d || 'open article')}
        </a>` : null}
      <div id="d-scroll">
        <${CommentList} comments=${comments} storyId=${storyId} />
      </div>
    </div>`;
}

function PullToRefresh({ state }) {
  return html`
    <div id="ptr" class=${state === 'pulling' || state === 'ready' ? 'visible' : ''}>
      <div class="ptr-spin" style=${state === 'refreshing' ? 'display:block' : ''} />
      <span id="ptr-txt">${
        state === 'ready' ? 'release to refresh' :
        state === 'refreshing' ? 'refreshing\u2026' :
        'pull to refresh'
      }</span>
    </div>`;
}

function Header({ currentDay, onPrev, onNext }) {
  const isToday = dateKey(currentDay) >= dateKey(todayUTC());
  return html`
    <div id="header">
      <div id="logo">HN</div>
      <div id="date-nav">
        <button class="nav-btn" onClick=${onPrev}>\u2190</button>
        <span id="date-label">${fmtDate(currentDay)}</span>
        <button class="nav-btn" disabled=${isToday} onClick=${onNext}>\u2192</button>
      </div>
    </div>`;
}

function OfflineToast({ show }) {
  return html`<div id="offline" class=${show ? 'show' : ''}>\u26A1 offline \u2014 cached stories</div>`;
}

// ── App ─────────────────────────────────────────────────────────────

function App() {
  const { date: initDate } = parseHash();
  const initDay = useMemo(() => {
    if (initDate) {
      const d = new Date(initDate + 'T00:00:00Z');
      if (d <= todayUTC()) return d;
    }
    return todayUTC();
  }, []);

  const [state, dispatch] = useReducer(reducer, initDay, initState);
  const { currentDay, stories, readIds, loading, loadGeneration, error,
          drawerStoryId, drawerStory, drawerOwnsHistory, comments, offlineFlash } = state;

  const animateRef    = useRef(true);
  const drawerRef     = useRef(null);
  const dismissingRef = useRef(false);
  const ptrYRef       = useRef(0);
  const ptrOnRef      = useRef(false);
  const ptrFiredRef   = useRef(false);
  const [ptrState, setPtrState] = useState('idle');

  // ── Load stories ──────────────────────────────────────────────
  const load = useCallback(async (day, generation) => {
    dispatch({ type: 'LOAD_START' });
    const key    = 's_' + dateKey(day);
    const cached = cacheGet(key);
    if (cached) {
      animateRef.current = false;
      dispatch({ type: 'LOAD_CACHED', stories: cached, generation });
    }
    try {
      const fresh = await fetchStories(day);
      cacheSet(key, fresh);
      if (!cached) animateRef.current = true;
      dispatch({ type: 'LOAD_SUCCESS', stories: fresh, generation });
    } catch (err) {
      console.error(err);
      if (!cached) {
        dispatch({ type: 'LOAD_FAIL', error: err.message, generation });
      } else {
        dispatch({ type: 'FLASH_OFFLINE', show: true });
        setTimeout(() => dispatch({ type: 'FLASH_OFFLINE', show: false }), 3000);
      }
    }
  }, []);

  // Initial load + loads when day changes
  useEffect(() => {
    load(currentDay, loadGeneration);
  }, [currentDay, loadGeneration]);

  // ── Read tracking persistence ─────────────────────────────────
  useEffect(() => { saveReadIds(readIds); }, [readIds]);

  // ── Drawer: body overflow ─────────────────────────────────────
  useEffect(() => {
    document.body.style.overflow = drawerStoryId ? 'hidden' : '';
  }, [drawerStoryId]);

  // ── Drawer: fetch comments + story metadata ───────────────────
  useEffect(() => {
    if (!drawerStoryId) return;
    let cancelled = false;

    // Find story in feed or fetch independently
    const s = stories.find(x => x.id === drawerStoryId);
    if (s) {
      dispatch({ type: 'SET_DRAWER_STORY', story: s });
    } else {
      fetchStoryItem(drawerStoryId)
        .then(item => { if (!cancelled) dispatch({ type: 'SET_DRAWER_STORY', story: item }); })
        .catch(() => {});
    }

    // Fetch comments
    const author = s ? s.by : null;
    fetchComments(drawerStoryId, author)
      .then(flat => {
        if (cancelled) return;
        dispatch({ type: 'SET_COMMENTS', comments: flat.length ? flat : [] });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'SET_COMMENTS', comments: 'error' });
      });

    return () => { cancelled = true; };
  }, [drawerStoryId, stories]);

  // ── Open story ────────────────────────────────────────────────
  const openStory = useCallback((id, pushHistory = true) => {
    dispatch({ type: 'MARK_READ', id });
    const s = stories.find(x => x.id === id);
    dispatch({ type: 'OPEN_DRAWER', storyId: id, story: s || null, pushHistory });
    if (pushHistory) {
      history.pushState({ storyId: id }, '', '#' + dateHash(currentDay, id));
    }
  }, [stories, currentDay]);

  const dismissDrawer = useCallback(() => {
    dispatch({ type: 'CLOSE_DRAWER' });
    if (drawerOwnsHistory) {
      dismissingRef.current = true;
      history.back();
    }
  }, [drawerOwnsHistory]);

  // ── Drawer swipe-to-close ─────────────────────────────────────
  useEffect(() => {
    const el = drawerRef.current;
    if (!el) return;
    let tsY = 0;
    const onStart = e => { tsY = e.touches[0].clientY; };
    const onEnd = e => {
      const scrollEl = el.querySelector('#d-scroll');
      if (e.changedTouches[0].clientY - tsY > 80 && scrollEl && scrollEl.scrollTop === 0) {
        dismissDrawer();
      }
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchend', onEnd);
    };
  }, [dismissDrawer]);

  // ── Date navigation ───────────────────────────────────────────
  const navigate = useCallback((delta) => {
    const newDay = new Date(currentDay.getTime() + delta * DAY_MS);
    if (delta > 0 && dateKey(newDay) > dateKey(todayUTC())) return;
    dispatch({ type: 'SET_DAY', day: newDay });
    animateRef.current = true;
    history.pushState({ date: dateKey(newDay) }, '', '#' + dateKey(newDay));
  }, [currentDay]);

  // ── Pull-to-refresh ───────────────────────────────────────────
  useEffect(() => {
    const onStart = e => {
      if (window.scrollY === 0 && !drawerStoryId) {
        ptrYRef.current = e.touches[0].clientY;
        ptrOnRef.current = true;
        ptrFiredRef.current = false;
      }
    };
    const onMove = e => {
      if (!ptrOnRef.current) return;
      const dy = e.touches[0].clientY - ptrYRef.current;
      if (dy > 10) {
        setPtrState(dy > 75 ? 'ready' : 'pulling');
        if (dy > 75) ptrFiredRef.current = true;
      }
    };
    const onEnd = async () => {
      if (!ptrOnRef.current) return;
      ptrOnRef.current = false;
      if (ptrFiredRef.current) {
        setPtrState('refreshing');
        await load(currentDay, loadGeneration);
        setPtrState('idle');
      } else {
        setPtrState('idle');
      }
      ptrFiredRef.current = false;
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };
  }, [drawerStoryId, currentDay, loadGeneration, load]);

  // ── Popstate ──────────────────────────────────────────────────
  useEffect(() => {
    const handler = () => {
      if (dismissingRef.current) { dismissingRef.current = false; return; }
      const { date, storyId } = parseHash();
      const newDay = date ? new Date(date + 'T00:00:00Z') : todayUTC();
      if (dateKey(newDay) !== dateKey(currentDay)) {
        dispatch({ type: 'CLOSE_DRAWER' });
        dispatch({ type: 'SET_DAY', day: newDay });
      } else if (storyId) {
        openStory(storyId, false);
      } else {
        dispatch({ type: 'CLOSE_DRAWER' });
      }
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [currentDay, openStory]);

  // ── Offline event ─────────────────────────────────────────────
  useEffect(() => {
    const handler = () => {
      dispatch({ type: 'FLASH_OFFLINE', show: true });
      setTimeout(() => dispatch({ type: 'FLASH_OFFLINE', show: false }), 3000);
    };
    window.addEventListener('offline', handler);
    return () => window.removeEventListener('offline', handler);
  }, []);

  // ── Open story from initial hash ──────────────────────────────
  useEffect(() => {
    const { storyId } = parseHash();
    if (storyId) openStory(storyId, false);
  }, []);

  // ── Service worker ────────────────────────────────────────────
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(console.error);
    }
  }, []);

  return html`
    <${PullToRefresh} state=${ptrState} />
    <${Feed} stories=${stories} readIds=${readIds}
             loading=${loading} error=${error}
             animate=${animateRef.current} onOpenStory=${openStory} />
    <div id="overlay" class=${drawerStoryId ? 'open' : ''} onClick=${dismissDrawer} />
    <${Drawer} storyId=${drawerStoryId} story=${drawerStory}
               comments=${comments} onClose=${dismissDrawer}
               drawerRef=${drawerRef} />
    <${Header} currentDay=${currentDay} onPrev=${() => navigate(-1)} onNext=${() => navigate(1)} />
    <${OfflineToast} show=${offlineFlash} />
  `;
}

render(html`<${App} />`, document.getElementById('app'));
