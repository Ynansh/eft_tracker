// Страница квестов. Общая логика — в common.js
Object.assign(state, {
  trader: load('eft-trader', TRADERS[0].id),
  // Открыты ли группы «Доступные», «Заблокированные», «Возможно, есть в сезоне» и «Выполненные»
  groups: { open: true, locked: true, maybe: true, done: false, ...load('eft-groups', {}) },
  query: '',
  flash: null, // квест, отметку которого только что поменяли, — подсвечивается
});

const STORY_TAB = 'story'; // вкладка «Сюжет» рядом с торговцами

// Квест не с tarkov.dev (eft.su, tarkov-market) в сезоне: неизвестно, есть ли он там
const maybeSeason = x => state.mode === 'season' && !x.modes.includes('season');

const inScope = x => exists(x) && (!state.kappaOnly || chain.kappa.has(x.id));

function visible() {
  const q = norm(state.query.trim());
  return QUESTS.filter(x => inScope(x) && (q ? norm(x.name).includes(q) : x.trader === state.trader));
}

function questHtml(x, showTrader) {
  const isDone = done.has(x.id);
  const missing = isDone ? [] : missingReqs(x);
  const anyMissing = isDone ? [] : missingAny(x);
  const needed = isDone ? [] : profileMissing(x);
  const locked = missing.length > 0 || anyMissing.length > 0 || needed.length > 0;
  const first = [...missing.map(id => esc(byId[id].name)),
    ...anyMissing.map(g => uniqueByName(g).map(id => esc(byId[id].name)).join(' или '))];
  const meta = [
    showTrader && `<span class="tag trader">${esc(traderName[x.trader])}</span>`,
    `<span>ур. ${x.level}</span>`,
    x.map && `<span>${esc(x.map)}</span>`,
    chain.kappa.has(x.id) && `<span class="tag kappa">Каппа</span>`,
    x.faction && `<span class="tag">${x.faction}</span>`,
    x.notOnTM && '<span class="tag stale" title="Квеста нет на tarkov-market: возможно, он устарел или убран из игры">нет на tarkov-market</span>',
  ].filter(Boolean).join('');
  const lockedBy = [
    needed.length && `<div class="locked-by">🔒 Нужно: ${esc(needed.join(', '))}</div>`,
    first.length && `<div class="locked-by">🔒 Сначала: ${first.join(', ')}</div>`,
  ].filter(Boolean).join('');
  const thumb = x.image
    ? `<img class="thumb" src="${x.image}" alt="" loading="lazy" onerror="imgMissing(this)">`
    : '<div class="thumb"></div>';
  const title = locked ? 'Квест пока недоступен' : isDone ? 'Вернуть в список' : 'Выполнено';
  const cls = [locked && 'locked', isDone && 'finished', state.flash === x.id && 'flash'].filter(Boolean).join(' ');
  return `<li class="quest ${cls}" data-id="${x.id}">
    <input type="checkbox" ${isDone ? 'checked' : ''} ${locked ? 'disabled' : ''} title="${title}">
    ${thumb}
    <a class="name" href="quest.html?id=${x.id}">${esc(x.name)}</a>
    <div class="meta">${meta}</div>
    ${lockedBy}
  </li>`;
}

function groupHtml(key, title, list, searching) {
  return `<details class="group" data-group="${key}" ${state.groups[key] ? 'open' : ''}>
    <summary><span class="chev"></span>${title}<small>${list.length}</small></summary>
    <ul class="list">${list.map(x => questHtml(x, searching)).join('')}</ul>
  </details>`;
}

// Строка сюжетной главы
function chapterHtml(c) {
  const isDone = chapterDone(c.id);
  const missing = isDone ? [] : chapterMissing(c);
  const steps = c.steps.filter(s => s.id);
  const n = steps.filter(s => stepDone(s.id)).length;
  return `<li class="quest chapter${missing.length ? ' locked' : ''}${isDone ? ' finished' : ''}${state.flash === c.id ? ' flash' : ''}" data-chapter="${c.id}">
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

  $('pageTitle').textContent = storyTab ? 'Сюжет' : 'Квесты';
  document.title = `${storyTab ? 'Сюжет' : 'Квесты'} — Tarkov трекер`;
  shell.setActive(storyTab ? 'story' : 'quests');

  $('hint').hidden = !searching;
  $('hint').textContent = `Поиск по всем торговцам: найдено ${items.length}`;

  if (storyTab) {
    $('groups').innerHTML = `<p class="hint">Главы истории. Шаги отмечаются на странице главы.
      «Тур» открывает торговцев: пока нужный шаг не отмечен, их квесты закрыты.</p>
      <ul class="list">${STORY.map(chapterHtml).join('')}</ul>`;
  } else if (!items.length) {
    $('groups').innerHTML = '<p class="empty">Ничего не найдено</p>';
  } else {
    // Выполненные — последней группой, по умолчанию свёрнуты
    $('groups').innerHTML = (todo.length ? '' : '<p class="empty">Всё выполнено 👍</p>') +
      [available.length && groupHtml('open', 'Доступные', available, searching),
       locked.length && groupHtml('locked', 'Заблокированные', locked, searching),
       maybe.length && groupHtml('maybe', 'Возможно, есть в сезоне', maybe, searching),
       finished.length && groupHtml('done', 'Выполненные', finished, searching)].filter(Boolean).join('');
  }
  state.flash = null;
}

// Переключение вкладки: торговец или «Сюжет»
function openTab(id) {
  state.trader = id;
  state.query = '';
  $('search').value = '';
  if (id !== STORY_TAB) save('eft-last-trader', id);
  save('eft-trader', state.trader);
  render();
}

// Галочка «выполнено» у квеста или «пройдена» у главы
function onCheck(e) {
  if (!e.target.matches('input[type=checkbox]')) return;
  const row = e.target.closest('.quest');
  if (row.dataset.chapter) {
    e.target.checked ? story.chapters.add(row.dataset.chapter) : story.chapters.delete(row.dataset.chapter);
    saveStory();
    state.flash = row.dataset.chapter;
  } else {
    e.target.checked ? done.add(row.dataset.id) : uncheck(row.dataset.id);
    save(DONE_KEY[state.mode], [...done]);
    state.flash = row.dataset.id;
  }
  render();
}
$('groups').addEventListener('change', onCheck);

// Свернуть/развернуть группу (toggle не всплывает, поэтому ловим на погружении)
$('groups').addEventListener('toggle', e => {
  const key = e.target.dataset?.group;
  if (!key) return;
  state.groups[key] = e.target.open;
  save('eft-groups', state.groups);
}, true);

$('tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-trader]');
  if (b) openTab(b.dataset.trader);
});

// Пункты меню «Квесты» и «Сюжет» на этой же странице — без перезагрузки
const lastTrader = () => {
  const t = load('eft-last-trader', TRADERS[0].id);
  return traderName[t] ? t : TRADERS[0].id;
};
shell.onSamePage = id => openTab(id === 'story' ? STORY_TAB : (state.trader === STORY_TAB ? lastTrader() : state.trader));

initShell(render);

$('search').addEventListener('input', e => {
  state.query = e.target.value;
  render();
});

$('reset').addEventListener('click', () => openReset(state.trader === STORY_TAB ? 'story' : 'quests'));

// Раздел из адреса: index.html?tab=story или ?tab=quests (ссылки из меню)
const tab = new URLSearchParams(location.search).get('tab');
if (tab === 'story') state.trader = STORY_TAB;
else if (tab === 'quests' && state.trader === STORY_TAB) state.trader = lastTrader();
if (!traderName[state.trader] && state.trader !== STORY_TAB) state.trader = TRADERS[0].id;
render();
