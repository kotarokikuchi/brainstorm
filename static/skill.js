// Skill: documento Markdown usado como skill de um LLM (o editor vem depois)
import { t } from './i18n.js';

let deps = null;   // {api, scheduleSave, setStatus, resetSave}
let skill = null;

export const initSkill = (d) => { deps = d; };
export const currentSkill = () => skill;
export function closeSkill() { skill = null; }

export const newSkill = (id, title, content) => ({ id, version: 0, type: 'skill', title, tags: [], content });

export async function openSkill(id) {
  const r = await deps.api('GET', `/${id}`);
  if (!r.ok) {
    if (r.status === 500) alert(t('map.openError'));
    location.hash = '#/';
    return;
  }
  const doc = await r.json();
  if (doc.type !== 'skill') { location.hash = `#/${doc.type === 'board' ? 'board' : 'map'}/${id}`; return; }
  skill = doc;
  deps.resetSave();
  document.body.dataset.view = 'skill';
  deps.setStatus(t('status.saved'));
  document.querySelector('#title').textContent = skill.title;
}

export function renameSkill(title) {
  if (!skill || !title || title === skill.title) return;
  skill.title = title;
  document.querySelector('#title').textContent = title;
  deps.scheduleSave(skill);
}
