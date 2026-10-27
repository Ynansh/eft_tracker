// Страница одного квеста. Общая логика — в common.js
const ITEMS = window.ITEMS;
const GUIDES = window.GUIDES ?? {};
const RELEASE_1_0 = '2025-11-15'; // выход EFT 1.0: правки вики до этой даты могут быть устаревшими
const WIKI = 'https://escapefromtarkov.fandom.com/ru/wiki/';

const quest = byId[new URLSearchParams(location.search).get('id')];

const icon = id => ITEMS[id]?.icon ? `<img src="${ITEMS[id].icon}" alt="" loading="lazy">` : '';
const itemName = id => ITEMS[id]?.name ?? id;
const questLink = id => `<a href="quest.html?id=${id}">${esc(byId[id].name)}</a>`;
const dateRu = iso => iso.slice(0, 10).split('-').reverse().join('.');

const section = (title, body) => body ? `<section><h2>${title}</h2>${body}</section>` : '';

function render() {
  if (!quest) {
    $('quest').innerHTML = '<p class="empty">Квест не найден. <a href="index.html">К списку квестов</a></p>';
    return;
  }
  document.title = `${quest.name} — Квесты Таркова`;
  $('progress').textContent = MODES[state.mode];

  const isDone = done.has(quest.id);
  const missing = isDone ? [] : missingReqs(quest);
  const needed = isDone ? [] : profileMissing(quest);
  const locked = missing.length > 0 || needed.length > 0;
  const guide = GUIDES[quest.id];
  const maybeSeasonNote = state.mode === 'season' && !quest.modes.includes('season')
    ? '<div class="locked-by">Квест с eft.su: есть ли он в сезоне — неизвестно</div>' : '';
  const storyLinks = (quest.storyReqs ?? []).filter(id => chapterById[id])
    .map(id => `<a href="story.html?id=${id}">${esc(chapterById[id].name)}</a>`).join(', ');

  const tags = [
    `<span class="tag trader">${esc(traderName[quest.trader])}</span>`,
    `<span>ур. ${quest.level}</span>`,
    quest.map && `<span>${esc(quest.map)}</span>`,
    chain.kappa.has(quest.id) && '<span class="tag kappa">Каппа</span>',
    quest.faction && `<span class="tag">${quest.faction}</span>`,
  ].filter(Boolean).join('');

  const status = `<div class="status">
    <label class="done-check"><input type="checkbox" ${isDone ? 'checked' : ''} ${locked ? 'disabled' : ''}> Выполнено</label>
    ${!exists(quest) ? '<div class="locked-by">Этого квеста нет в выбранном режиме или у выбранной фракции</div>' : ''}
    ${needed.length ? `<div class="locked-by">🔒 Нужно: ${esc(needed.join(', '))}</div>` : ''}
    ${storyLinks ? `<div class="locked-by">Сюжет: ${storyLinks}</div>` : ''}
    ${missing.length ? `<div class="locked-by">🔒 Сначала: ${missing.map(questLink).join(', ')}</div>` : ''}
    ${maybeSeasonNote}
  </div>`;

  const objectives = quest.objectives.length
    ? `<ul>${quest.objectives.map(o => `<li>${esc(o)}</li>`).join('')}</ul>` : '';

  const needs = quest.needs.length ? `<ul class="need-list">${quest.needs.map(n => `<li>
      <span class="need-icon">${icon(n.items[0])}</span>
      <span>${esc(n.text ?? itemName(n.items[0]))} — ${n.count} шт.
        ${n.fir ? '<span class="tag fir">Найдено в рейде</span>' : ''}
        ${n.plant ? '<span class="tag">Заложить</span>' : ''}
        ${n.optional ? '<span class="tag">Необязательно</span>' : ''}</span>
    </li>`).join('')}</ul>` : '';

  const keys = quest.keys.length ? `<ul class="need-list">${quest.keys.map(k => `<li>
      <span class="need-icon">${icon(k.keys[0])}</span>
      <span>${k.keys.map(i => esc(itemName(i))).join(' или ')}${k.map ? ` — ${esc(k.map)}` : ''}</span>
    </li>`).join('')}</ul>` : '';

  // Прохождение с русской вики и предупреждения об актуальности
  let source = '';
  if (guide) {
    const warnings = [
      guide.mismatch && 'Числа в целях на вики не совпадают с актуальными целями выше — прохождение может быть устаревшим.',
      guide.edited < RELEASE_1_0 && `Страница вики не правилась после выхода 1.0 (${dateRu(RELEASE_1_0)}).`,
    ].filter(Boolean);
    source = `<p class="source">Источник: <a href="${WIKI}${encodeURIComponent(guide.title)}" target="_blank" rel="noopener">
      Escape from Tarkov Wiki, «${esc(guide.title)}»</a> (лицензия CC BY-NC-SA), последняя правка ${dateRu(guide.edited)}.</p>
      ${warnings.map(w => `<p class="warning">⚠ ${w}</p>`).join('')}`;
  }

  const links = [
    guide && `<a href="${WIKI}${encodeURIComponent(guide.title)}" target="_blank" rel="noopener">Вики ↗</a>`,
    quest.slug && `<a href="https://eft.su/q/${encodeURIComponent(quest.slug)}" target="_blank" rel="noopener">eft.su ↗</a>`,
  ].filter(Boolean).join(' · ');

  $('quest').innerHTML = `
    <h1>${esc(quest.name)}</h1>
    <div class="meta">${tags}</div>
    ${quest.image ? `<img class="quest-image" src="${quest.image}" alt="">` : ''}
    ${status}
    ${section('Цели', objectives)}
    ${section('Нужные предметы', needs)}
    ${section('Нужные ключи', keys)}
    ${section('Как получить квест', guide?.important?.length && blocksHtml(guide.important))}
    ${section('Прохождение', guide?.walkthrough?.length
      ? `<div class="guide-cards">${guideCards(guide.walkthrough)}</div>`
      : '<p class="empty">Прохождения на вики нет.</p>')}
    ${section('Примечания', guide?.notes?.length && blocksHtml(guide.notes))}
    ${source}
    ${links ? `<p class="links">${links}</p>` : ''}`;
}

$('quest').addEventListener('change', e => {
  if (!e.target.matches('.done-check input')) return;
  e.target.checked ? done.add(quest.id) : uncheck(quest.id);
  save(DONE_KEY[state.mode], [...done]);
  render();
});

render();
