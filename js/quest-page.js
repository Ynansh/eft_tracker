// Страница одного квеста. Общая логика — в common.js
const ITEMS = window.ITEMS;
const GUIDES = window.GUIDES ?? {};
const WIKI = 'https://escapefromtarkov.fandom.com/ru/wiki/';

const quest = byId[new URLSearchParams(location.search).get('id')];

const icon = id => ITEMS[id]?.icon ? `<img src="${ITEMS[id].icon}" alt="" loading="lazy" onerror="imgMissing(this)">` : '';
const itemName = id => ITEMS[id]?.name ?? id;
const questLink = id => `<a href="quest.html?id=${id}">${esc(byId[id].name)}</a>`;
const dateRu = iso => iso.slice(0, 10).split('-').reverse().join('.');
// Копия скриншота tarkov.help на диске (get_th_screenshots.py) — под тем же именем, что в адресе
const thFile = url => 'img/th/' + decodeURIComponent(url.split('/').pop());

const section = (title, body) => body ? `<section><h2>${title}</h2>${body}</section>` : '';

function render() {
  if (!quest) {
    $('quest').innerHTML = '<p class="empty">Квест не найден. <a href="index.html">К списку квестов</a></p>';
    return;
  }
  document.title = `${quest.name} — Tarkov трекер`;
  $('progress').textContent = MODES[state.mode];

  const isDone = done.has(quest.id);
  const missing = isDone ? [] : missingReqs(quest);
  const anyMissing = isDone ? [] : missingAny(quest);
  const needed = isDone ? [] : profileMissing(quest);
  const locked = missing.length > 0 || anyMissing.length > 0 || needed.length > 0;
  const first = [...missing.map(questLink), ...anyMissing.map(g => uniqueByName(g).map(questLink).join(' или '))];
  const guide = GUIDES[quest.id];
  const maybeSeasonNote = state.mode === 'season' && !quest.modes.includes('season')
    ? '<div class="locked-by">Есть ли этот квест в сезоне — неизвестно</div>' : '';
  const storyLinks = (quest.storyReqs ?? []).filter(id => chapterById[id])
    .map(id => `<a href="story.html?id=${id}">${esc(chapterById[id].name)}</a>`).join(', ');

  const tags = [
    `<span class="tag trader">${esc(traderName[quest.trader])}</span>`,
    `<span>ур. ${quest.level}</span>`,
    quest.map && `<span>${esc(quest.map)}</span>`,
    chain.kappa.has(quest.id) && '<span class="tag kappa">Каппа</span>',
    quest.faction && `<span class="tag">${quest.faction}</span>`,
    quest.notOnTM && '<span class="tag stale" title="Квеста нет на tarkov-market: возможно, он устарел или убран из игры">нет на tarkov-market</span>',
  ].filter(Boolean).join('');

  const status = `<div class="status">
    <label class="done-check"><input type="checkbox" ${isDone ? 'checked' : ''} ${locked ? 'disabled' : ''}> Выполнено</label>
    ${!exists(quest) ? '<div class="locked-by">Этого квеста нет в выбранном режиме или у выбранной фракции</div>' : ''}
    ${needed.length ? `<div class="locked-by">🔒 Нужно: ${esc(needed.join(', '))}</div>` : ''}
    ${storyLinks ? `<div class="locked-by">Сюжет: ${storyLinks}</div>` : ''}
    ${first.length ? `<div class="locked-by">🔒 Сначала: ${first.join(', ')}</div>` : ''}
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

  // Прохождение: своё (по игровым данным, вики и tarkov.help), скриншоты с tarkov.help и текст с русской вики.
  // В guide может не быть вики — только скриншоты tarkov.help
  const wiki = guide?.title ? guide : null;
  const stale = wiki && (wiki.mismatch || wiki.edited < RELEASE_1_0);
  let source = '';
  if (wiki) {
    const warnings = [
      wiki.mismatch && 'Числа в целях на вики не совпадают с актуальными целями выше — прохождение может быть устаревшим.',
      wiki.edited < RELEASE_1_0 && `Страница вики не правилась после выхода 1.0 (${dateRu(RELEASE_1_0)}).`,
    ].filter(Boolean);
    source = `<p class="source">Источник: <a href="${WIKI}${encodeURIComponent(wiki.title)}" target="_blank" rel="noopener">
      Escape from Tarkov Wiki, «${esc(wiki.title)}»</a> (лицензия CC BY-NC-SA), последняя правка ${dateRu(wiki.edited)}.</p>
      ${warnings.map(w => `<p class="warning">⚠ ${w}</p>`).join('')}`;
  }
  const thUrl = quest.th && `https://tarkov.help/ru/quest/${encodeURIComponent(quest.th)}`;
  const own = guide?.own && `<div class="guide-cards">${guideCards(guide.own.blocks)}</div>
    <p class="source">Прохождение составлено по игровым данным (tarkov.dev), вики и tarkov.help, обновлено ${dateRu(guide.own.updated)}.</p>`;
  const shots = guide?.thShots?.length && `<div class="shots-block"><h3 class="sub">Скриншоты с tarkov.help</h3>
    ${blocksHtml(guide.thShots.map(url => ({ t: 'img', file: thFile(url), url, source: 'tarkov.help' })))}
    <p class="source">Скриншоты с сайта <a href="${thUrl}" target="_blank" rel="noopener">tarkov.help</a>.</p></div>`;
  const wikiCards = wiki?.walkthrough?.length && `<div class="guide-cards">${guideCards(wiki.walkthrough)}</div>${source}`;
  // Есть своё прохождение или вики устарела — текст с вики свёрнут
  const wikiPart = wikiCards && (own || stale
    ? `<details class="old-guide"><summary>Прохождение с вики${stale ? ' (может быть устаревшим)' : ''}</summary>${wikiCards}</details>`
    : wikiCards);
  const walkthrough = [own, shots, wikiPart].filter(Boolean).join('')
    || `<p class="empty">Прохождения пока нет.${thUrl ? ` Смотри <a href="${thUrl}" target="_blank" rel="noopener">гайд на tarkov.help ↗</a>` : ''}</p>`;

  const links = [
    wiki && `<a href="${WIKI}${encodeURIComponent(wiki.title)}" target="_blank" rel="noopener">Вики ↗</a>`,
    thUrl && `<a href="${thUrl}" target="_blank" rel="noopener">tarkov.help ↗</a>`,
    quest.slug && `<a href="https://eft.su/q/${encodeURIComponent(quest.slug)}" target="_blank" rel="noopener">eft.su ↗</a>`,
  ].filter(Boolean).join(' · ');

  $('quest').innerHTML = `
    <h1>${esc(quest.name)}</h1>
    <div class="meta">${tags}</div>
    ${quest.image ? `<img class="quest-image" src="${quest.image}" alt="" onerror="this.remove()">` : ''}
    ${status}
    ${section('Цели', objectives)}
    ${section('Нужные предметы', needs)}
    ${section('Нужные ключи', keys)}
    ${section('Как получить квест', wiki?.important?.length && blocksHtml(wiki.important))}
    ${section('Прохождение', walkthrough)}
    ${section('Примечания', wiki?.notes?.length && blocksHtml(wiki.notes))}
    ${wikiCards ? '' : source}
    ${links ? `<p class="links">${links}</p>` : ''}`;
}

$('quest').addEventListener('change', e => {
  if (!e.target.matches('.done-check input')) return;
  e.target.checked ? done.add(quest.id) : uncheck(quest.id);
  save(DONE_KEY[state.mode], [...done]);
  render();
});

initShell(render);
render();
