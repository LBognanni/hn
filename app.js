const ALGOLIA  = 'https://hn.algolia.com/api/v1';
const CACHE_PFX = 'hn3_';
const READ_KEY  = 'hn3_read';

const todayUTC = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};
const dateKey = d => d.toISOString().slice(0, 10);
const fmtDate = d => d.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric', timeZone:'UTC'});

let currentDay  = todayUTC();
let stories     = [];
let readIds     = new Set(JSON.parse(localStorage.getItem(READ_KEY) || '[]'));
let busy        = false;

const feedEl    = document.getElementById('feed');
const statusEl  = document.getElementById('status');
const dateLbl   = document.getElementById('date-label');
const btnPrev   = document.getElementById('btn-prev');
const btnNext   = document.getElementById('btn-next');
const ptrEl     = document.getElementById('ptr');
const ptrTxt    = document.getElementById('ptr-txt');
const drawer    = document.getElementById('drawer');
const overlay   = document.getElementById('overlay');
const dTitle    = document.getElementById('d-title');
const dMeta     = document.getElementById('d-meta');
const dClose    = document.getElementById('d-close');
const dLink     = document.getElementById('d-link');
const dScroll   = document.getElementById('d-scroll');
const offlineEl = document.getElementById('offline');

const esc = s => String(s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

const ago = t => {
  const s = Math.floor(Date.now()/1000 - t);
  if (s < 60) return s+'s';
  if (s < 3600) return Math.floor(s/60)+'m';
  if (s < 86400) return Math.floor(s/3600)+'h';
  return Math.floor(s/86400)+'d';
};

const host = url => {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./,''); }
  catch { return ''; }
};

const cacheSet = (k, v) => {
  try { localStorage.setItem(CACHE_PFX+k, JSON.stringify(v)); } catch {}
};
const cacheGet = k => {
  try { return JSON.parse(localStorage.getItem(CACHE_PFX+k)); }
  catch { return null; }
};

const fetchStories = async (day) => {
  const start = day.getTime() / 1000;
  const end   = start + 86400;
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

const showStatus = (ico, msg, isErr) => {
  feedEl.innerHTML = '';
  statusEl.style.display = '';
  statusEl.className = isErr ? 'err' : '';
  statusEl.innerHTML = `<span class="ico">${ico}</span>${msg}`;
};

const renderFeed = (animate = true) => {
  const filtered = stories.filter(s => s.descendants > 0 || s.score > 0).sort((a, b) => b.descendants - a.descendants);
  if (!filtered.length) {
    showStatus('&#x25EF;', 'no stories', false);
    return;
  }
  statusEl.style.display = 'none';
  feedEl.innerHTML = filtered.map((s, i) => {
    const isRead = readIds.has(s.id);
    const d      = host(s.url);
    return `<div class="story ${isRead?'read':'unread'}" data-id="${s.id}"
              style="${animate ? `animation-delay:${Math.min(i*.025,.5)}s` : 'animation:none'}"
              onclick="storyClick(event,${s.id})">
      <div class="rank">${i+1}</div>
      <div>
        <div class="s-title">${isRead?'':'<span class="dot"></span>'}${esc(s.title)}${
          d?` <span class="domain">${esc(d)}</span>`:''}</div>
        <div class="s-meta">
          <span class="pts">&#x25B2; ${s.score}</span>
          <span>${ago(s.time)}</span>
          <span>${esc(s.by)}</span>
          <button class="cmt-btn" onclick="openComments(event,${s.id})">
            &#x25CE; ${s.descendants}
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
};

const updateNav = () => {
  dateLbl.textContent = fmtDate(currentDay);
  btnNext.disabled = dateKey(currentDay) >= dateKey(todayUTC());
};

const load = async () => {
  if (busy) return;
  busy = true;
  updateNav();
  showStatus('&#x25CC;', 'loading\u2026', false);
  const key    = 's_' + dateKey(currentDay);
  const cached = cacheGet(key);
  if (cached) { stories = cached; renderFeed(); }
  try {
    const fresh = await fetchStories(currentDay);
    stories = fresh;
    cacheSet(key, fresh);
    renderFeed(!cached);
  } catch (err) {
    console.error(err);
    if (!cached) showStatus('&#x2715;', 'failed to load — check connection', true);
    else flashOffline();
  }
  busy = false;
};

const markRead = id => {
  readIds.add(id);
  try { localStorage.setItem(READ_KEY, JSON.stringify([...readIds])); } catch {}
  const el = feedEl.querySelector(`.story[data-id="${id}"]`);
  if (el) { el.classList.remove('unread'); el.classList.add('read'); }
};

window.storyClick = (e, id) => {
  if (e.target.closest('.cmt-btn')) return;
  openComments(e, id);
};

window.openComments = async (e, id, pushHistory = true) => {
  if (e) e.stopPropagation();
  markRead(id);
  const s = stories.find(x => x.id === id);
  if (!s) return;
  dTitle.textContent = s.title;
  if (s.url) { dTitle.href = s.url; } else { dTitle.removeAttribute('href'); }
  dMeta.innerHTML = `<span>&#x25B2; ${s.score}</span>
    <span>${s.descendants} comments</span>
    <span>${esc(s.by)}</span>
    <span>${ago(s.time)}</span>`;
  if (s.url) {
    dLink.href = s.url;
    dLink.textContent = '\u2197 ' + (host(s.url) || 'open article');
    dLink.style.display = 'block';
  } else {
    dLink.style.display = 'none';
  }
  dScroll.innerHTML = '<div id="c-loading">loading comments\u2026</div>';
  openDrawer(id, pushHistory);

  try {
    const url  = `${ALGOLIA}/search?tags=comment,story_${id}&hitsPerPage=500`;
    const r    = await fetch(url);
    const json = await r.json();
    const hits = (json.hits || []).filter(h => h.author && !h._deleted_);

    if (!hits.length) {
      dScroll.innerHTML = '<div id="c-loading">no comments yet</div>';
      return;
    }

    const childrenOf = {};
    hits.forEach(h => {
      const p = String(h.parent_id);
      if (!childrenOf[p]) childrenOf[p] = [];
      childrenOf[p].push(h);
    });

    const flat = [];
    const walk = (parentId, depth) => {
      (childrenOf[parentId] || []).forEach(h => {
        flat.push({
          id:   h.objectID,
          by:   h.author,
          text: h.comment_text || '',
          time: h.created_at_i || 0,
          depth,
          isOp: h.author === s.by,
        });
        walk(h.objectID, depth + 1);
      });
    };
    walk(String(id), 0);

    dScroll.innerHTML = flat.length
      ? flat.map(renderComment).join('')
      : '<div id="c-loading">no visible comments</div>';
  } catch (err) {
    console.error(err);
    dScroll.innerHTML = '<div id="c-loading">failed to load comments</div>';
  }
};

const renderComment = c => `
  <div class="comment" data-id="${c.id}" data-d="${c.depth}" style="--d:${c.depth}" onclick="tog(this,event)">
    <div class="c-head">
      <span class="c-by${c.isOp?' op':''}">${esc(c.by)}${c.isOp?' \u2605':''}</span>
      <span class="c-age">${ago(c.time)}</span>
    </div>
    <div class="c-body">${c.text||''}</div>
    <div class="c-col-info">thread collapsed</div>
  </div>`;

window.tog = (el, e) => {
  if (e && (e.target.closest('a') || window.getSelection().toString())) return;
  const depth = parseInt(el.dataset.d);
  const col   = el.classList.toggle('col');
  let next = el.nextElementSibling;
  while (next && next.classList.contains('comment')) {
    if (parseInt(next.dataset.d) <= depth) break;
    next.style.display = col ? 'none' : '';
    next = next.nextElementSibling;
  }
};

const parseHash = () => {
  const h = location.hash.slice(1);
  if (!h) return {date: null, storyId: null};
  const parts = h.split('/');
  if (/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
    return {date: parts[0], storyId: parts[1] ? parseInt(parts[1]) : null};
  }
  // legacy: bare story id
  return {date: null, storyId: parseInt(parts[0]) || null};
};

const dateHash = (day, storyId) => {
  const d = dateKey(day);
  return storyId ? `${d}/${storyId}` : d;
};

const openDrawer = (id, pushHistory = true) => {
  drawer.classList.add('open');
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  if (id && pushHistory) {
    history.pushState({storyId: id}, '', '#' + dateHash(currentDay, id));
    drawerOwnsHistory = true;
  } else {
    drawerOwnsHistory = false;
  }
};
const closeDrawer = () => {
  drawer.classList.remove('open');
  overlay.classList.remove('open');
  document.body.style.overflow = '';
};
const dismissDrawer = () => {
  if (drawerOwnsHistory) history.back();
  else closeDrawer();
};
dClose.addEventListener('click', dismissDrawer);
overlay.addEventListener('click', dismissDrawer);

let drawerOwnsHistory = false;
let tsY = 0;
drawer.addEventListener('touchstart', e => { tsY = e.touches[0].clientY; }, {passive:true});
drawer.addEventListener('touchend', e => {
  if (e.changedTouches[0].clientY - tsY > 80 && dScroll.scrollTop === 0) dismissDrawer();
}, {passive:true});

btnPrev.addEventListener('click', () => {
  currentDay = new Date(currentDay.getTime() - 86400000);
  stories = [];
  history.pushState({date: dateKey(currentDay)}, '', '#' + dateKey(currentDay));
  load();
});
btnNext.addEventListener('click', () => {
  if (btnNext.disabled) return;
  currentDay = new Date(currentDay.getTime() + 86400000);
  stories = [];
  history.pushState({date: dateKey(currentDay)}, '', '#' + dateKey(currentDay));
  load();
});

let ptrY = 0, ptrOn = false, ptrFired = false;
document.addEventListener('touchstart', e => {
  if (window.scrollY === 0 && !drawer.classList.contains('open')) {
    ptrY = e.touches[0].clientY; ptrOn = true; ptrFired = false;
  }
}, {passive:true});
document.addEventListener('touchmove', e => {
  if (!ptrOn) return;
  const dy = e.touches[0].clientY - ptrY;
  if (dy > 10) {
    ptrEl.classList.add('visible');
    ptrEl.classList.remove('loading');
    ptrTxt.textContent = dy > 75 ? 'release to refresh' : 'pull to refresh';
    if (dy > 75) ptrFired = true;
  }
}, {passive:true});
document.addEventListener('touchend', async () => {
  if (!ptrOn) return;
  ptrOn = false;
  if (ptrFired) {
    ptrEl.classList.add('loading');
    ptrTxt.textContent = 'refreshing\u2026';
    await load();
    ptrEl.classList.remove('visible', 'loading');
  } else {
    ptrEl.classList.remove('visible');
  }
  ptrFired = false;
}, {passive:true});

const flashOffline = () => {
  offlineEl.classList.add('show');
  setTimeout(() => offlineEl.classList.remove('show'), 3000);
};
window.addEventListener('offline', flashOffline);

const openFromHash = () => {
  const {storyId} = parseHash();
  if (storyId) openComments(null, storyId, false);
};

window.addEventListener('popstate', () => {
  const {date, storyId} = parseHash();
  const newDay = date ? new Date(date + 'T00:00:00Z') : todayUTC();
  if (dateKey(newDay) !== dateKey(currentDay)) {
    currentDay = newDay;
    stories = [];
    closeDrawer();
    load();
  } else if (storyId) {
    openComments(null, storyId);
  } else {
    closeDrawer();
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(console.error);
}

const {date: initDate} = parseHash();
if (initDate) {
  const d = new Date(initDate + 'T00:00:00Z');
  if (d <= todayUTC()) currentDay = d;
}

load().then(openFromHash);
