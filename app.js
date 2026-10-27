// Страница квестов. Общая логика — в common.js
Object.assign(state, {
  trader: load('eft-trader', TRADERS[0].id),
  doneOpen: load('eft-done-open', false),
  // Свёрнуты ли группы «Доступные», «Заблокированные» и «Возможно, есть в сезоне»
  groups: { open: true, locked: true, maybe: true, ...load('eft-groups', {}) },
  query: '',
});

const STORY_TAB = 'story'; // вкладка «Сюжет» рядом с торговцами

// Квест с eft.su в сезоне: неизвестно, есть ли он там
const maybeSeason = x => state.mode === 'season' && !x.modes.includes('season');

const inScope = x => exists(x) && (!state.kappaOnly || chain.kappa.has(x.id));

function visible() {
  const q = norm(state.query.trim());
  return QUESTS.filter(x => inScope(x) && (q ? norm(x.name).includes(q) : x.trader === state.trader));
}

function renderProfile() {
  const ll = LL_TRADERS.map(t => `<label>${esc(t.name)}
      <select data-ll="${t.id}">${[1, 2, 3, 4].map(n =>
        `<option ${(profile.ll[t.id] ?? 1) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`).join('');
  const rep = REP_TRADERS.map(t => `<label>${esc(t.name)}, реп.
      <input type="number" step="0.01" data-rep="${t.id}" value="${profile.rep[t.id] ?? 0}"></label>`).join('');
  $('profileFields').innerHTML = `<label>Уровень
      <input type="number" min="1" max="79" data-level value="${profile.level}"></label>${ll}${rep}`;
}

function questHtml(x, showTrader) {
  const isDone = done.has(x.id);
  const missing = isDone ? [] : missingReqs(x);
  const needed = isDone ? [] : profileMissing(x);
  const locked = missing.length > 0 || needed.length > 0;
  const meta = [
    showTrader && `<span class="tag trader">${esc(traderName[x.trader])}</span>`,
    `<span>ур. ${x.level}</span>`,
    x.map && `<span>${esc(x.map)}</span>`,
    chain.kappa.has(x.id) && `<span class="tag kappa">Каппа</span>`,
    x.faction && `<span class="tag">${x.faction}</span>`,
  ].filter(Boolean).join('');
  const lockedBy = [
    needed.length && `<div class="locked-by">🔒 Нужно: ${esc(needed.join(', '))}</div>`,
    missing.length && `<div class="locked-by">🔒 Сначала: ${missing.map(id => esc(byId[id].name)).join(', ')}</div>`,
  ].filter(Boolean).join('');
  const thumb = x.image
    ? `<img class="thumb" src="${x.image}" alt="" loading="lazy">`
    : '<div class="thumb"></div>';
  const title = locked ? 'Квест пока недоступен' : isDone ? 'Вернуть в список' : 'Выполнено';
  return `<li class="quest${locked ? ' locked' : ''}" data-id="${x.id}">
    <input type="checkbox" ${isDone ? 'checked' : ''} ${locked ? 'disabled' : ''} title="${title}">
    ${thumb}
    <a class="name" href="quest.html?id=${x.id}">${esc(x.name)}</a>
    <div class="meta">${meta}</div>
    ${lockedBy}
  </li>`;
}

function groupHtml(key, title, list, searching) {
  return `<details class="group" data-group="${key}" ${state.groups[key] ? 'open' : ''}>
    <summary>${title} <small>${list.length}</small></summary>
    <ul class="list">${list.map(x => questHtml(x, searching)).join('')}</ul>
  </details>`;
}

// Строка сюжетной главы
function chapterHtml(c) {
  const isDone = chapterDone(c.id);
  const missing = isDone ? [] : chapterMissing(c);
  const steps = c.steps.filter(s => s.id);
  const n = steps.filter(s => stepDone(s.id)).length;
  return `<li class="quest chapter${missing.length ? ' locked' : ''}${isDone ? ' finished' : ''}" data-chapter="${c.id}">
    <input type="checkbox" ${isDone ? 'checked' : ''} ${missing.length ? 'disabled' : ''}
      title="${missing.length ? 'Глава пока недоступна' : isDone ? 'Снять отметку' : 'Глава пройдена'}">
    <div class="thumb chapter-num">${c.order}</div>
    <a class="name" href="story.html?id=${c.id}">${esc(c.name)}</a>
    <div class="meta"><span>шагов ${n} из ${steps.length}</span></div>
    ${missing.length ? `<div class="locked-by">🔒 Сначала: ${missing.map(id => esc(chapterById[id].name)).join(', ')}</div>` : ''}
  </li>`;
}

function render() {
  const searching = state.query.trim() !== '';
  const storyTab = state.trader === STORY_TAB && !searching;
  // Если у текущего торговца нет квестов под фильтр — переключаемся на первого, у кого есть
  if (state.trader !== STORY_TAB && !QUESTS.some(x => x.trader === state.trader && inScope(x))) {
    state.trader = TRADERS.find(t => QUESTS.some(x => x.trader === t.id && inScope(x)))?.id ?? state.trader;
  }
  const items = storyTab ? [] : visible();
  const todo = items.filter(x => !done.has(x.id));
  const finished = items.filter(x => done.has(x.id));
  const maybe = todo.filter(maybeSeason);
  const sure = todo.filter(x => !maybeSeason(x));
  const available = sure.filter(x => !isLocked(x));
  const locked = sure.filter(isLocked);

  // Вкладки со счётчиками: сначала «Сюжет», потом торговцы
  $('tabs').classList.toggle('searching', searching);
  const storyCount = STORY.filter(c => chapterDone(c.id)).length;
  $('tabs').innerHTML = (STORY.length ? `<button type="button" data-trader="${STORY_TAB}"
      class="story-tab ${state.trader === STORY_TAB ? 'on' : ''}">Сюжет<small>${storyCount}/${STORY.length}</small></button>` : '') +
    TRADERS.map(t => {
      const all = QUESTS.filter(x => x.trader === t.id && inScope(x));
      if (!all.length) return '';
      const n = all.filter(x => done.has(x.id)).length;
      return `<button type="button" data-trader="${t.id}" class="${t.id === state.trader ? 'on' : ''}">
        ${esc(t.name)}<small>${n}/${all.length}</small></button>`;
    }).join('');

  // Общий прогресс
  const pool = QUESTS.filter(inScope);
  const total = pool.filter(x => done.has(x.id)).length;
  $('progress').innerHTML = `${MODES[state.mode]}, ${state.kappaOnly ? 'Каппа' : 'всего'}: <b>${total}</b> из ${pool.length}`;

  $('profileSummary').textContent = `Уровень и лояльность (${MODES[state.mode]}): ур. ${profile.level}`;

  $('hint').hidden = !searching;
  $('hint').textContent = `Поиск по всем торговцам: найдено ${items.length}`;

  if (storyTab) {
    $('groups').innerHTML = `<p class="hint">Главы истории. Шаги отмечаются на странице главы.
      «Тур» открывает торговцев: пока нужный шаг не отмечен, их квесты закрыты.</p>
      <ul class="list">${STORY.map(chapterHtml).join('')}</ul>`;
  } else {
    $('groups').innerHTML = todo.length
      ? [available.length && groupHtml('open', 'Доступные', available, searching),
         locked.length && groupHtml('locked', 'Заблокированные', locked, searching),
         maybe.length && groupHtml('maybe', 'Возможно, есть в сезоне (с eft.su)', maybe, searching)].filter(Boolean).join('')
      : `<p class="empty">${items.length ? 'Всё выполнено 👍' : 'Ничего не найдено'}</p>`;
  }
  $('done').hidden = storyTab;

  $('done').classList.toggle('open', state.doneOpen);
  document.body.classList.toggle('done-open', state.doneOpen);
  $('doneToggle').innerHTML = `${state.doneOpen ? '▾' : '▴'} Выполнено: <b>${finished.length}</b>` +
    (searching ? ' (по поиску)' : ` у торговца ${esc(traderName[state.trader])}`);
  $('doneList').innerHTML = finished.map(x => questHtml(x, searching)).join('');
}

// Галочка «выполнено» у квеста или «пройдена» у главы
function onCheck(e) {
  if (!e.target.matches('input[type=checkbox]')) return;
  const row = e.target.closest('.quest');
  if (row.dataset.chapter) {
    e.target.checked ? story.chapters.add(row.dataset.chapter) : story.chapters.delete(row.dataset.chapter);
    saveStory();
  } else {
    e.target.checked ? done.add(row.dataset.id) : uncheck(row.dataset.id);
    save(DONE_KEY[state.mode], [...done]);
  }
  render();
}
$('groups').addEventListener('change', onCheck);
$('doneList').addEventListener('change', onCheck);

// Свернуть/развернуть группу (toggle не всплывает, поэтому ловим на погружении)
$('groups').addEventListener('toggle', e => {
  const key = e.target.dataset?.group;
  if (!key) return;
  state.groups[key] = e.target.open;
  save('eft-groups', state.groups);
}, true);

$('tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-trader]');
  if (!b) return;
  state.trader = b.dataset.trader;
  state.query = '';
  $('search').value = '';
  save('eft-trader', state.trader);
  render();
});

// Изменения уровня, лояльности и репутации
$('profileFields').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.level !== undefined) profile.level = Math.max(1, parseInt(t.value, 10) || 1);
  else if (t.dataset.ll) profile.ll[t.dataset.ll] = parseInt(t.value, 10);
  else if (t.dataset.rep) profile.rep[t.dataset.rep] = parseFloat(t.value) || 0;
  else return;
  save(PROFILE_KEY(state.mode), profile);
  render();
});

bindSwitches(() => {
  renderProfile();
  render();
});

$('search').addEventListener('input', e => {
  state.query = e.target.value;
  render();
});

$('doneToggle').addEventListener('click', () => {
  state.doneOpen = !state.doneOpen;
  save('eft-done-open', state.doneOpen);
  render();
});

$('reset').addEventListener('click', () => openReset(state.trader === STORY_TAB ? 'story' : 'quests'));

if (!traderName[state.trader] && state.trader !== STORY_TAB) state.trader = TRADERS[0].id;
renderProfile();
render();
