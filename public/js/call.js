import { Room, RoomEvent, Track } from 'https://cdn.jsdelivr.net/npm/livekit-client@2.15.4/+esm';

const $ = (id) => document.getElementById(id);

export function initCall() {
  const button = $('toggle');
  const status = $('status');
  const muteButton = $('mute');
  let room = null;
  let muted = false;

  const setStatus = (text) => { status.textContent = text; };

  function reset(message = 'מנותק') {
    room = null;
    muteButton.hidden = true;
    button.textContent = 'התחל שיחה';
    setStatus(message);
  }

  async function setMuted(value) {
    await room?.localParticipant.setMicrophoneEnabled(!value);
    muted = value;
    muteButton.textContent = muted ? 'בטל השתקה' : 'השתק מיקרופון';
    setStatus(muted ? 'מחובר - המיקרופון מושתק' : 'מחובר - אפשר לדבר');
  }

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
      room.on(RoomEvent.Disconnected, () => reset());
      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);
      button.textContent = 'סיים שיחה';
      await setMuted(false);
      muteButton.hidden = false;
    } catch (err) {
      console.error(err);
      await room?.disconnect();
      reset('שגיאת חיבור');
    } finally {
      button.disabled = false;
    }
  }

  muteButton.addEventListener('click', () => setMuted(!muted).catch(console.error));
  button.addEventListener('click', () => (room ? room.disconnect() : connect()));
}
