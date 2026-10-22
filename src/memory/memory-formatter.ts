import type { UserMemory } from './types.js';

const GENDER_LINE = {
  male: 'מגדר: זכר. פני אליו בלשון זכר',
  female: 'מגדר: נקבה. פני אליה בלשון נקבה',
  other: 'מגדר: אחר. השתמשי בניסוח ניטרלי',
} as const;

/** Renders stored memory as a Hebrew block for the agent's instructions. Empty if nothing is known. */
const COMPANION_LABEL = {
  likes: 'מה אוהבים',
  style: 'סגנון מתאים',
  address: 'איך לפנות',
  avoid: 'להימנע',
  smiles: 'מה משמח ומצחיק',
  other: 'אחר',
} as const;

export function formatMemory({ user, deceased, companion, recentSummaries }: UserMemory): string {
  const profile = [
    user.firstName && `שם: ${user.firstName}`,
    user.addressAs && `איך לפנות: ${user.addressAs}`,
    user.gender && GENDER_LINE[user.gender],
    user.notes && `מה עוזר / ממה להימנע:\n${user.notes}`,
  ].filter(Boolean);

  const lost = deceased.map((d) =>
    [
      `- ${d.name}`,
      d.relationship && `(${d.relationship})`,
      d.dateOfDeath && `תאריך פטירה: ${d.dateOfDeath}`,
      d.circumstances && `נסיבות: ${d.circumstances}`,
      d.notes && `הערות: ${d.notes.replaceAll('\n', '; ')}`,
    ]
      .filter(Boolean)
      .join(' '),
  );

  const calls = recentSummaries.map((s) => {
    const threads = s.openThreads.length ? ` (נושאים פתוחים: ${s.openThreads.join(', ')})` : '';
    return `- ${s.startedAt.toISOString().slice(0, 10)}: ${s.summary}${threads}`;
  });

  const prefs = companion.map((c) => `- ${COMPANION_LABEL[c.category]}: ${c.note}`);

  if (!profile.length && !lost.length && !calls.length && !prefs.length) return '';

  return [
    'מה שאת כבר יודעת על האדם שמדבר איתך, משיחות קודמות. השתמשי בזה בטבעיות ובעדינות, ואל תקריאי את זה כרשימה:',
    ...(profile.length ? ['\nפרופיל:', ...profile.map((p) => `- ${p}`)] : []),
    ...(lost.length ? ['\nיקרים שנפטרו:', ...lost] : []),
    ...(prefs.length
      ? ['\nהעדפות למצב החברותי (רלוונטי רק אם המשתמש מבקש אותו במפורש):', ...prefs]
      : []),
    ...(calls.length ? ['\nסיכומי שיחות אחרונות (מהחדשה לישנה):', ...calls] : []),
  ].join('\n');
}
