
/* Constantes y conexion con supabase*/
const SUPABASE_URL = 'https://ydtwjwuxrydpfqijfhzw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_y9kPBo6ZwsZKQ2g6QMuZbg_rfga3T9o';
const TABLE = 'tasks';
const UPDATED_COL = 'updated_ar';   // Escribi mal el nombre en la DB xd


const REST = `${SUPABASE_URL}/rest/v1/${TABLE}`;
const HEADERS = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
if (SUPABASE_KEY.startsWith('eyJ')) HEADERS.Authorization = `Bearer ${SUPABASE_KEY}`; 
const configured = !SUPABASE_URL.includes('TU-PROYECTO') && !SUPABASE_KEY.startsWith('TU-');

const LS_TASKS = 'tareas.sb.items.v1', LS_QUEUE = 'tareas.sb.cola.v1';
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
let tasks = read(LS_TASKS, []);
let queue = read(LS_QUEUE, []);     // {op:'create'|'update'|'delete', id, data}
let filter = 'all', syncing = false, editingId = null, problem = null, offline = !navigator.onLine;
const persist = () => { localStorage.setItem(LS_TASKS, JSON.stringify(tasks)); localStorage.setItem(LS_QUEUE, JSON.stringify(queue)); };
const isTmp = id => typeof id === 'string';   // ids locales temporales
const todayStr = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

/* ============ Cola de cambios ============ */
function enqueue(op, id, data) {
  if (op === 'update') {
    const prev = queue.find(q => q.id === id && (q.op === 'create' || q.op === 'update'));
    if (prev) { Object.assign(prev.data, data); return persist(); }
  }
  if (op === 'delete') {
    const wasNew = queue.some(q => q.id === id && q.op === 'create');
    queue = queue.filter(q => q.id !== id);
    if (wasNew) return persist();
  }
  queue.push({ op, id, data });
  persist();
}

class SyncError extends Error {}
async function call(url, opts) {
  const res = await fetch(url, { ...opts, headers: { ...HEADERS, ...opts.headers } });
  if (res.status === 401 || res.status === 403) throw new SyncError('auth');
  if (res.status >= 500) throw new SyncError('server');
  return res;
}

async function sync() {
  if (syncing || !navigator.onLine || !configured) return;
  syncing = true;
  try {
    while (queue.length) {
      const q = queue[0];
      if (q.op === 'create') {
        const res = await call(REST, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(q.data) });
        if (res.ok) {
          const row = (await res.json())[0];
          tasks.forEach(t => { if (t.id === q.id) t.id = row.id; });
          queue.forEach(x => { if (x.id === q.id) x.id = row.id; });   // cambios posteriores apuntan al id real
          if (editingId === q.id) editingId = row.id;
        }
      } else if (q.op === 'update') {
        await call(`${REST}?id=eq.${q.id}`, { method: 'PATCH', body: JSON.stringify({ ...q.data, [UPDATED_COL]: new Date().toISOString() }) });
      } else {
        await call(`${REST}?id=eq.${q.id}`, { method: 'DELETE' });
      }
      queue.shift(); persist();  
    }
    const res = await call(`${REST}?select=*&order=created_at.desc`, {});
    if (!res.ok) throw new SyncError('server');
    tasks = await res.json(); persist();
    problem = null; offline = false;
  } catch (e) {
    if (e instanceof SyncError && e.message === 'auth') problem = 'auth';
    offline = true;
  } finally { syncing = false; renderBanner(); render(); }
}

/* ============ Aviso de conexión ============ */
function renderBanner() {
  const b = document.getElementById('banner');
  let msg = '';
 if (!navigator.onLine) msg = 'Sin conexión. Puedes seguir trabajando: tus cambios se guardan aquí y se enviarán al reconectar.';
  else if (problem === 'auth') msg = 'Se rechazo la peticion, intente de nuevo.';
  else if (offline) msg = 'Reconectando con el servidor… tus cambios se enviarán en cuanto responda.';
  b.textContent = msg; b.classList.toggle('show', !!msg);
}
addEventListener('offline', () => { offline = true; renderBanner(); });
addEventListener('online', () => { renderBanner(); sync(); });
setInterval(() => { if (offline || queue.length) sync(); }, 15000);

/* ============ Acciones ============ */
function addTask(f) {
  const t = { id: crypto.randomUUID(), title: f.title.trim(), notes: f.notes.trim() || null, completed: false,
              due_date: f.due_date, created_at: new Date().toISOString() };
  tasks.unshift(t);
  enqueue('create', t.id, { title: t.title, notes: t.notes, completed: false, due_date: t.due_date });
  render(); sync();
}
function updateTask(id, patch) {
  const t = tasks.find(x => x.id === id); if (!t) return;
  Object.assign(t, patch); enqueue('update', id, patch); render(); sync();
}
function removeTask(id) { tasks = tasks.filter(x => x.id !== id); enqueue('delete', id); render(); sync(); }

/* ============ Interfaz ============ */
const $list = document.getElementById('list');
function el(tag, props = {}, ...kids) { const n = Object.assign(document.createElement(tag), props); kids.forEach(k => n.append(k)); return n; }

function editor(t) {
  const title = el('input', { type: 'text', value: t.title, maxLength: 200, ariaLabel: 'Título' });
  const notes = el('textarea', { rows: 2, value: t.notes || '', placeholder: 'Notas', ariaLabel: 'Notas' });
  const date = el('input', { type: 'date', value: String(t.due_date).slice(0, 10), required: true, ariaLabel: 'Fecha límite' });
  const save = el('button', { className: 'btn', type: 'button' }, 'Guardar cambios');
  const cancel = el('button', { className: 'btn ghost', type: 'button' }, 'Cancelar');
  save.onclick = () => {
    const v = title.value.trim(); if (!v || !date.value) return;
    const patch = { title: v, notes: notes.value.trim() || null, due_date: date.value };
    editingId = null; updateTask(t.id, patch);
  };
  cancel.onclick = () => { editingId = null; render(); };
  const box = el('div', { className: 'panel', style: 'margin:0;border:0;padding:0' }, title, notes, el('div', { className: 'row' }, date, save, cancel));
  setTimeout(() => title.focus(), 0);
  return el('li', { className: 'editing' }, box);
}

function render() {
  const pending = tasks.filter(t => !t.completed).length;
  const n = queue.length;
  document.getElementById('summary').textContent =
    (tasks.length ? `${pending} pendiente${pending !== 1 ? 's' : ''} de ${tasks.length}` : 'Todo en orden')
    + (n ? ` · ${n} cambio${n > 1 ? 's' : ''} sin enviar` : '');
  if (editingId !== null && $list.querySelector('.editing')) return;   // no pisar una edición en curso

  const shown = tasks.filter(t => filter === 'all' || (filter === 'done') === t.completed);
  $list.replaceChildren();
  if (!shown.length) {
    $list.append(el('li', { className: 'empty' }, tasks.length ? 'No hay tareas en este filtro.' : 'Aún no tienes tareas. Escribe la primera arriba.'));
    return;
  }
  const today = todayStr();
  for (const t of shown) {
    if (t.id === editingId) { $list.append(editor(t)); continue; }
    const due = String(t.due_date).slice(0, 10);
    const late = due < today && !t.completed;
    const chk = el('input', { type: 'checkbox', className: 'chk', checked: t.completed, ariaLabel: 'Marcar como hecha' });
    chk.onchange = () => updateTask(t.id, { completed: chk.checked });
    const title = el('button', { className: 'title', type: 'button', title: 'Editar' }, t.title);
    title.onclick = () => { editingId = t.id; $list.querySelector('.editing')?.remove(); render(); };
    const body = el('div', { className: 'body' }, title);
    if (t.notes) body.append(el('p', { className: 'notes' }, t.notes));
    body.append(el('div', { className: 'meta' }, `${late ? 'Venció' : 'Vence'} ${due}` + (isTmp(t.id) ? ' · sin enviar' : '')));
    const del = el('button', { className: 'del', type: 'button', ariaLabel: 'Eliminar tarea', title: 'Eliminar' }, '×');
    del.onclick = () => removeTask(t.id);
    $list.append(el('li', { className: t.completed ? 'done' : late ? 'late' : '' }, chk, body, del));
  }
}

const form = document.getElementById('form');
form.due_date.value = todayStr();
form.addEventListener('submit', e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(form));
  if (!f.title.trim() || !f.due_date) return;
  addTask(f); form.reset(); form.due_date.value = todayStr(); form.title.focus();
});
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  filter = b.dataset.f; editingId = null;
  document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-pressed', x === b));
  render();
});

/* ============ Arranque ============ */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
renderBanner(); render(); sync();