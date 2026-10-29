import { getToken, setToken, Unauthorized } from './api.js';
import { initCall } from './call.js';
import { startDashboard } from './dashboard.js';

const $ = (id) => document.getElementById(id);

function showGate(message = '') {
  $('gate').hidden = false;
  $('gate-error').textContent = message;
  $('app').hidden = true;
}

function start() {
  $('gate').hidden = true;
  $('app').hidden = false;
  startDashboard(() => showGate('הטוקן לא תקין')).catch((err) => {
    console.error(err);
    showGate(err instanceof Unauthorized ? 'הטוקן לא תקין' : `שגיאה בטעינת הנתונים: ${err.message}`);
  });
}

$('gate-form').addEventListener('submit', (e) => {
  e.preventDefault();
  setToken($('gate-token').value.trim());
  $('gate-token').value = '';
  start();
});

initCall();
getToken() ? start() : showGate();
