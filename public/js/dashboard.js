import { apiFetch, streamEvents, Unauthorized } from './api.js';

const $ = (id) => document.getElementById(id);

const GENDERS = { male: 'זכר', female: 'נקבה', other: 'אחר' };
const CATEGORIES = { likes: 'אוהב/ת', style: 'סגנון', address: 'איך לפנות', avoid: 'להימנע', smiles: 'משמח/מצחיק', other: 'אחר' };
const fmt = (v) => (v ? new Date(v).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '');

const state = { users: [], selectedId: null, live: new Set(), events: [], scope: 'selected', query: '' };

// Module-level guards so startDashboard can be called again (after a 401 and a new token)
// without duplicating listeners or event-stream loops.
let listenersBound = false;
let streamRunning = false;
let authLostHandler = () => {};

export const userLabel = (u) => {
  const base = u.isDemo ? 'Demo (web)' : u.firstName || 'מתקשר/ת לא מזוהה';
  return u.phoneLast4 ? `${base} ••••${u.phoneLast4}` : base;
};

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

/** Routes a failed async call: expired token goes back to the gate, anything else is logged. */
const handleError = (err) => (err instanceof Unauthorized ? authLostHandler() : console.error(err));

/** Plain-text table: stored text is model-generated and must never be parsed as HTML. */
function table(headers, rows) {
  if (!rows.length) return el('p', { className: 'empty', textContent: 'אין מידע שמור' });
  const t = el('table');
  const head = t.createTHead().insertRow();
  for (const h of headers) head.append(el('th', { textContent: h }));
  const body = t.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    for (const cell of row) tr.insertCell().textContent = cell ?? '';
  }
  return t;
}

function section(name, title, content) {
  const d = el('details', { className: 'sec' }, el('summary', { textContent: title }), content);
  let open = true;
  try { open = localStorage.getItem(`sec:${name}`) !== 'closed'; } catch { /* ignore */ }
  d.open = open;
  d.addEventListener('toggle', () => {
    try { localStorage.setItem(`sec:${name}`, d.open ? 'open' : 'closed'); } catch { /* ignore */ }
  });
  return d;
}

// ---------- user list ----------

function renderList() {
  const list = $('users');
  list.replaceChildren();
  if (!state.users.length) {
    list.append(el('li', { className: 'empty', textContent: 'לא נמצאו משתמשים' }));
    return;
  }
  for (const u of state.users) {
    const li = el('li', { className: u.id === state.selectedId ? 'selected' : '' });
    const btn = el('button', { type: 'button' },
      el('span', { className: 'name', textContent: userLabel(u) }),
      el('span', { className: 'meta', textContent: u.lastCallAt ? `שיחה אחרונה: ${fmt(u.lastCallAt)}` : 'אין שיחות' }));
    if (state.live.has(u.id)) btn.append(el('span', { className: 'badge', textContent: 'בשיחה עכשיו' }));
    btn.addEventListener('click', () => selectUser(u.id).catch(handleError));
    li.append(btn);
    list.append(li);
  }
}

export async function loadUsers() {
  const res = await apiFetch(`/api/users?q=${encodeURIComponent(state.query)}`);
  if (!res.ok) throw new Error(`users failed: ${res.status}`);
  state.users = await res.json();
  if (!state.selectedId && state.users[0]) state.selectedId = state.users[0].id;
  renderList();
  if (state.selectedId) await showUser(state.selectedId);
}

// ---------- selected user ----------

async function selectUser(id) {
  state.selectedId = id;
  renderList();
  renderEvents();
  await showUser(id);
}

async function showUser(id) {
  const pane = $('detail');
  const res = await apiFetch(`/api/users/${id}/memory`);
  if (res.status === 404) {
    state.selectedId = null;
    pane.replaceChildren(el('p', { className: 'empty', textContent: 'המשתמש לא נמצא' }));
    return;
  }
  if (!res.ok) throw new Error(`memory failed: ${res.status}`);
  const { user, deceased, companion, recentSummaries } = await res.json();
  const summary = state.users.find((u) => u.id === id);
  const label = summary ? userLabel(summary) : user.firstName || id;

  const hasProfile = user.firstName || user.addressAs || user.gender || user.notes;
  pane.replaceChildren(
    el('h2', { textContent: label }),
    section('profile', 'פרופיל', table(['שם', 'פונים אליו כ', 'מגדר', 'הערות'],
      hasProfile ? [[user.firstName, user.addressAs, GENDERS[user.gender], user.notes]] : [])),
    section('deceased', 'יקירים שנפטרו', table(['שם', 'קרבה', 'תאריך פטירה', 'נסיבות', 'הערות'],
      deceased.map((d) => [d.name, d.relationship, d.dateOfDeath, d.circumstances, d.notes]))),
    section('companion', 'העדפות למצב חברותי', table(['קטגוריה', 'העדפה', 'נשמר ב'],
      companion.map((c) => [CATEGORIES[c.category] ?? c.category, c.note, fmt(c.createdAt)]))),
    section('calls', `סיכומי שיחות (${recentSummaries.length})`, table(['תאריך', 'סיכום', 'מצב רוח', 'נושאים פתוחים'],
      recentSummaries.map((s) => [fmt(s.startedAt), s.summary, s.mood, s.openThreads.join('\n')]))),
    deleteControl(id, label),
  );
}

function deleteControl(id, label) {
  const input = el('input', { type: 'text', placeholder: `הקלד/י "${label}" לאישור` });
  const confirm = el('button', { type: 'button', className: 'danger', textContent: 'מחק משתמש', disabled: true });
  // Exact match with the label (surrounding whitespace in the input is ignored).
  input.addEventListener('input', () => { confirm.disabled = input.value.trim() !== label; });
  confirm.addEventListener('click', async () => {
    try {
      const res = await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) return;
      state.selectedId = null;
      await loadUsers();
    } catch (err) {
      handleError(err);
    }
  });
  return el('div', { className: 'delete' }, el('p', { className: 'muted', textContent: 'מחיקה סופית של המשתמש ושל כל המידע עליו' }), input, confirm);
}

// ---------- live feed ----------

function renderEvents() {
  const list = $('events');
  list.replaceChildren();
  const shown = state.events.filter((e) => state.scope === 'all' || e.userId === state.selectedId);
  if (!shown.length) {
    list.append(el('li', { className: 'empty', textContent: 'אין אירועים עדיין' }));
    return;
  }
  for (const e of shown) {
    const who = state.users.find((u) => u.id === e.userId);
    const what = e.kind === 'memory' ? e.tool : e.kind === 'call_started' ? 'השיחה התחילה' : 'השיחה הסתיימה';
    list.append(el('li', {},
      el('time', { textContent: fmt(e.at) }),
      el('code', { textContent: what }),
      ` ${who ? userLabel(who) : ''} ${e.input ? JSON.stringify(e.input) : ''}`));
  }
}

async function handleEvent(event) {
  state.events.unshift(event);
  state.events.length = Math.min(state.events.length, 100);
  if (event.kind === 'call_started') state.live.add(event.userId);
  if (event.kind === 'call_ended') state.live.delete(event.userId);
  const known = state.users.some((u) => u.id === event.userId);
  try {
    // call_started/call_ended (and unknown users) reload the list, which also refreshes the
    // selected user's detail (new summary after call_ended). Memory events for the selected
    // user refresh only the detail.
    if (!known || event.kind !== 'memory') await loadUsers();
    else if (event.userId === state.selectedId) await showUser(event.userId);
  } catch (err) {
    handleError(err);
  }
  renderList();
  renderEvents();
}

// Called synchronously by the stream reader; never lets a rejection escape.
const onEvent = (event) => { handleEvent(event).catch(handleError); };

export async function startDashboard(onAuthLost) {
  authLostHandler = onAuthLost;
  if (!listenersBound) {
    listenersBound = true;
    let timer;
    $('search').addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.query = e.target.value.trim();
        loadUsers().catch(handleError);
      }, 250);
    });
    for (const radio of document.querySelectorAll('input[name="scope"]')) {
      radio.addEventListener('change', () => { state.scope = radio.value; renderEvents(); });
    }
  }
  await loadUsers();
  renderEvents();
  if (streamRunning) return; // a loop from an earlier call is still alive and uses the new token
  streamRunning = true;
  // Reconnect with a short delay if the stream drops; stop only when the token is rejected.
  try {
    for (;;) {
      try {
        await streamEvents(onEvent);
      } catch (err) {
        if (err instanceof Unauthorized) return authLostHandler();
        console.error('event stream error', err);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  } finally {
    streamRunning = false;
  }
}
