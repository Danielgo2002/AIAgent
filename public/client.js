import { Room, RoomEvent, Track } from 'https://cdn.jsdelivr.net/npm/livekit-client@2.15.4/+esm';

const $ = (id) => document.getElementById(id);
const button = $('toggle');
const status = $('status');
const muteButton = $('mute');
let room = null;

const setStatus = (text) => { status.textContent = text; };

// ---------- memory tables ----------

const GENDERS = { male: 'זכר', female: 'נקבה', other: 'אחר' };
const COMPANION_CATEGORIES = { likes: 'אוהב/ת', style: 'סגנון', address: 'איך לפנות', avoid: 'להימנע', smiles: 'משמח/מצחיק', other: 'אחר' };
const fmtDateTime = (v) => new Date(v).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });

/** Builds a table with textContent only; stored text is LLM-generated and must not be parsed as HTML. */
function renderTable(container, headers, rows) {
  container.replaceChildren();
  if (!rows.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'אין מידע שמור';
    container.append(p);
    return;
  }
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  for (const h of headers) head.insertCell().outerHTML = `<th>${h}</th>`;
  const body = table.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    for (const cell of row) tr.insertCell().textContent = cell ?? '';
  }
  container.append(table);
}

let latestSummaryId = null;

async function refreshMemory() {
  const res = await fetch('/api/memory');
  if (!res.ok) {
    console.error('[memory] fetch failed', res.status);
    return;
  }
  const { user, deceased, companion, recentSummaries } = await res.json();
  latestSummaryId = recentSummaries[0]?.id ?? null;
  console.debug('[memory] refreshed', { deceased: deceased.length, summaries: recentSummaries.length });

  const hasProfile = user.firstName || user.addressAs || user.gender || user.notes;
  renderTable($('profile'), ['שם', 'פונים אליו כ', 'מגדר', 'הערות'],
    hasProfile ? [[user.firstName, user.addressAs, GENDERS[user.gender], user.notes]] : []);
  renderTable($('deceased'), ['שם', 'קרבה', 'תאריך פטירה', 'נסיבות', 'הערות'],
    deceased.map((d) => [d.name, d.relationship, d.dateOfDeath, d.circumstances, d.notes]));
  renderTable($('companion'), ['קטגוריה', 'העדפה', 'נשמר ב'],
    companion.map((c) => [COMPANION_CATEGORIES[c.category] ?? c.category, c.note, fmtDateTime(c.createdAt)]));
  renderTable($('calls'), ['תאריך', 'סיכום', 'מצב רוח', 'נושאים פתוחים'],
    recentSummaries.map((s) => [fmtDateTime(s.startedAt), s.summary, s.mood, s.openThreads.join('\n')]));
}

// ---------- live memory events ----------

function addEvent({ tool, input, at }) {
  const list = $('events');
  list.querySelector('.empty')?.remove();
  const li = document.createElement('li');
  const time = document.createElement('time');
  time.textContent = fmtDateTime(at);
  const code = document.createElement('code');
  code.textContent = tool;
  li.append(time, code, ` ${JSON.stringify(input)}`);
  list.prepend(li);
}

// ---------- call ----------

async function connect() {
  button.disabled = true;
  setStatus('מתחבר...');
  try {
    const res = await fetch('/api/token', { method: 'POST' });
    if (!res.ok) throw new Error(`token request failed: ${res.status}`);
    const { token, url } = await res.json();

    room = new Room();
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) document.body.appendChild(track.attach());
    });
    room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
      if (topic !== 'memory') return;
      try {
        const event = JSON.parse(new TextDecoder().decode(payload));
        console.debug('[memory] event', event);
        addEvent(event);
      } catch (err) {
        console.error('bad memory event', err);
      }
      refreshMemory();
    });
    room.on(RoomEvent.Disconnected, () => reset());

    await room.connect(url, token);
    await room.localParticipant.setMicrophoneEnabled(true);
    button.textContent = 'סיים שיחה';
    setMuted(false);
    muteButton.hidden = false;
    setStatus('מחובר - אפשר לדבר');
  } catch (err) {
    console.error(err);
    await room?.disconnect();
    reset('שגיאת חיבור');
  } finally {
    button.disabled = false;
  }
}

function reset(message = 'מנותק') {
  room = null;
  muteButton.hidden = true;
  button.textContent = 'התחל שיחה';
  setStatus(message);
  if (message === 'מנותק') waitForSummary();
}

/** The agent writes the call summary after the call ends (LLM analysis); poll until a new one appears. */
async function waitForSummary() {
  const before = latestSummaryId;
  const deadline = Date.now() + 60_000;
  setStatus('מנותק - מסכם את השיחה...');
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    await refreshMemory();
    if (latestSummaryId !== before) {
      console.debug('[memory] new call summary received');
      return setStatus('מנותק - השיחה נשמרה');
    }
  }
  console.warn('[memory] no new call summary within 60s');
  setStatus('מנותק');
}

let muted = false;

async function setMuted(value) {
  await room?.localParticipant.setMicrophoneEnabled(!value);
  muted = value;
  muteButton.textContent = muted ? 'בטל השתקה' : 'השתק מיקרופון';
  setStatus(muted ? 'מחובר - המיקרופון מושתק' : 'מחובר - אפשר לדבר');
}

muteButton.addEventListener('click', () => setMuted(!muted).catch(console.error));

button.addEventListener('click', () => (room ? room.disconnect() : connect()));

$('clear').addEventListener('click', async () => {
  if (!confirm('למחוק את כל מה שהסוכן זוכר עליך? לא ניתן לשחזר.')) return;
  const res = await fetch('/api/memory', { method: 'DELETE' });
  if (!res.ok) return alert('המחיקה נכשלה');
  $('events').replaceChildren();
  await refreshMemory();
});

refreshMemory();
