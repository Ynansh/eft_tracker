// Страница предметов для квестов и убежища. Общая логика — в common.js
const ITEMS = window.ITEMS;
// Убежище своё в каждом режиме (в сезоне другие требования)
const hideout = () => window.HIDEOUT[state.mode] ?? [];

Object.assign(state, {
  kind: load('eft-items-kind', 'quests') === 'hideout' ? 'hideout' : 'quests',
  query: '',
});

// Сколько уже найдено и какие уровни убежища построены — свои для PvP и PvE
const FOUND_KEY = mode => `eft-found-${mode}`;
const BUILT_KEY = mode => `eft-hideout-${mode}`;
let found = load(FOUND_KEY(state.mode), {});
let built = new Set(load(BUILT_KEY(state.mode), []));

const itemName = id => ITEMS[id]?.name ?? id;

// Предметы для невыполненных квестов, сведённые по предмету и «найдено в рейде»
function questEntries() {
  const map = new Map();
  for (const x of QUESTS) {
    if (!exists(x) || done.has(x.id) || (state.kappaOnly && !chain.kappa.has(x.id))) continue;
    x.needs.forEach((n, i) => {
      // «Любой из нескольких» — отдельная карточка на каждую такую цель
      const key = n.items.length > 1 ? `q:${x.id}:${i}` : `q:${n.items[0]}:${n.fir ? 1 : 0}`;
      if (!map.has(key)) map.set(key, { key, items: n.items, fir: n.fir, text: n.text, total: 0, uses: [] });
      const e = map.get(key);
      e.total += n.count;
      e.uses.push({
        name: x.name, count: n.count, kappa: chain.kappa.has(x.id),
        note: [n.plant && 'заложить', n.optional && 'необязательно'].filter(Boolean).join(', '),
      });
    });
  }
  return [...map.values()];
}

// Предметы для непостроенных уровней убежища
function hideoutEntries() {
  const map = new Map();
  for (const s of hideout()) {
    for (const lv of s.levels) {
      if (built.has(`${s.id}-${lv.level}`)) continue;
      for (const n of lv.needs) {
        const key = `h:${n.item}:${n.fir ? 1 : 0}`;
        if (!map.has(key)) map.set(key, { key, items: [n.item], fir: n.fir, text: null, total: 0, uses: [] });
        const e = map.get(key);
        e.total += n.count;
        e.uses.push({ name: `${s.name}, ур. ${lv.level}`, count: n.count, kappa: false, note: '' });
      }
    }
  }
  return [...map.values()];
}

function cardHtml(e) {
  const have = Math.min(found[e.key] ?? 0, e.total);
  const complete = have >= e.total;
  const first = ITEMS[e.items[0]];
  const icon = first?.icon
    ? `<img src="${first.icon}" alt="" loading="lazy" onerror="imgMissing(this, '?')">`
    : '<div class="no-icon">?</div>';
  const title = e.text ?? itemName(e.items[0]);
  const anyOf = e.items.length > 1
    ? `<div class="any-of">Любой из: ${e.items.slice(0, 4).map(i => esc(itemName(i))).join(', ')}${
        e.items.length > 4 ? ` и ещё ${e.items.length - 4}` : ''}</div>`
    : '';
  const fir = e.fir
    ? '<span class="tag fir">Найдено в рейде</span>'
    : '<span class="tag">Можно не из рейда</span>';
  const uses = e.uses.map(u => `<li>${esc(u.name)} — ${u.count} шт.${u.note ? ` (${u.note})` : ''}${
    u.kappa ? ' <span class="tag kappa">Каппа</span>' : ''}</li>`).join('');
  return `<li class="item-card${complete ? ' complete' : ''}" data-key="${esc(e.key)}">
    <div class="item-side">
      <div class="item-icon">${icon}</div>
      <div class="counter">
        <button type="button" data-step="-1" aria-label="Минус один">−</button>
        <span><b>${have}</b>/${e.total}</span>
        <button type="button" data-step="1" aria-label="Плюс один">+</button>
      </div>
    </div>
    <div class="item-body">
      <div class="item-name">${esc(title)}</div>
      ${anyOf}
      <div class="item-tags">${fir}</div>
      <ul class="uses">${uses}</ul>
    </div>
  </li>`;
}

function renderStations() {
  $('stationList').innerHTML = hideout().map(s => `<div class="station">
      <span>${esc(s.name)}</span>
      ${s.levels.map(lv => `<label><input type="checkbox" data-station="${s.id}" data-level="${lv.level}"
        ${built.has(`${s.id}-${lv.level}`) ? 'checked' : ''}> ${lv.level}</label>`).join('')}
    </div>`).join('');
}

let entries = [];

function render() {
  document.querySelectorAll('.kind button').forEach(b => b.classList.toggle('on', b.dataset.kind === state.kind));
  document.querySelector('.focus').hidden = state.kind !== 'quests';
  $('stations').hidden = state.kind !== 'hideout';

  entries = state.kind === 'quests' ? questEntries() : hideoutEntries();
  const q = norm(state.query.trim());
  const shown = entries
    .filter(e => !q || e.items.some(i => norm(itemName(i)).includes(q)) || (e.text && norm(e.text).includes(q)))
    .map(e => ({ e, complete: (found[e.key] ?? 0) >= e.total, title: e.text ?? itemName(e.items[0]) }))
    .sort((a, b) => a.complete - b.complete || a.title.localeCompare(b.title, 'ru'));

  const completeCount = entries.filter(e => (found[e.key] ?? 0) >= e.total).length;
  $('progress').innerHTML = `${MODES[state.mode]}: собрано <b>${completeCount}</b> из ${entries.length}`;
  $('items').innerHTML = shown.length
    ? shown.map(s => cardHtml(s.e)).join('')
    : `<li class="empty">${entries.length ? 'Ничего не найдено' : 'Ничего не нужно 👍'}</li>`;
}

// Кнопки +/− под иконкой
$('items').addEventListener('click', e => {
  const b = e.target.closest('button[data-step]');
  if (!b) return;
  const key = b.closest('.item-card').dataset.key;
  const entry = entries.find(x => x.key === key);
  const next = Math.min(entry.total, Math.max(0, Math.min(found[key] ?? 0, entry.total) + Number(b.dataset.step)));
  if (next) found[key] = next; else delete found[key];
  save(FOUND_KEY(state.mode), found);
  render();
});

// Отметка построенных уровней: уровень выше включает нижние, снятие — убирает верхние
$('stationList').addEventListener('change', e => {
  const t = e.target;
  if (!t.dataset.station) return;
  const s = hideout().find(x => x.id === t.dataset.station);
  const level = Number(t.dataset.level);
  for (const lv of s.levels) {
    const key = `${s.id}-${lv.level}`;
    if (t.checked && lv.level <= level) built.add(key);
    if (!t.checked && lv.level >= level) built.delete(key);
  }
  save(BUILT_KEY(state.mode), [...built]);
  renderStations();
  render();
});

document.querySelector('.kind').addEventListener('click', e => {
  const b = e.target.closest('button[data-kind]');
  if (!b) return;
  state.kind = b.dataset.kind;
  save('eft-items-kind', state.kind);
  render();
});

bindSwitches(() => {
  found = load(FOUND_KEY(state.mode), {});
  built = new Set(load(BUILT_KEY(state.mode), []));
  renderStations();
  render();
});

$('search').addEventListener('input', e => {
  state.query = e.target.value;
  render();
});

$('reset').addEventListener('click', () => openReset(state.kind === 'quests' ? 'questItems' : 'hideout'));

renderStations();
render();
