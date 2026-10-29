const KEY = 'adminToken';

export const getToken = () => {
  try { return sessionStorage.getItem(KEY) ?? ''; } catch { return ''; }
};
export const setToken = (value) => {
  try { value ? sessionStorage.setItem(KEY, value) : sessionStorage.removeItem(KEY); } catch { /* ignore */ }
};

export class Unauthorized extends Error {}

export async function apiFetch(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { ...options.headers, authorization: `Bearer ${getToken()}` } });
  if (res.status === 401) {
    setToken('');
    throw new Unauthorized();
  }
  return res;
}

/** Reads the server-sent-event stream with fetch so the Authorization header can be sent. */
export async function streamEvents(onEvent, signal) {
  const res = await apiFetch('/api/events', { signal });
  if (!res.ok || !res.body) throw new Error(`events stream failed: ${res.status}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try { onEvent(JSON.parse(line.slice(6))); } catch (err) { console.error('bad event', err); }
    }
  }
}
