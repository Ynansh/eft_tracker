// Страница сюжетной главы. Общая логика — в common.js
const WIKI = 'https://escapefromtarkov.fandom.com/ru/wiki/';

const chapter = chapterById[new URLSearchParams(location.search).get('id')];

const dateRu = iso => iso.slice(0, 10).split('-').reverse().join('.');
const chapterLink = id => `<a href="story.html?id=${id}">${esc(chapterById[id].name)}</a>`;

// Какие торговцы открываются на шаге «Тура»
const unlocksByStep = {};
for (const [trader, u] of Object.entries(TRADER_UNLOCKS)) (unlocksByStep[u.step] ??= []).push(traderName[trader]);

const section = (title, body) => body ? `<section><h2>${title}</h2>${body}</section>` : '';

function render() {
  if (!chapter) {
    $('chapter').innerHTML = '<p class="empty">Глава не найдена. <a href="index.html">К списку квестов</a></p>';
    return;
  }
  document.title = `${chapter.name} — Tarkov трекер`;
  $('progress').textContent = MODES[state.mode];

  const isDone = chapterDone(chapter.id);
  const missing = isDone ? [] : chapterMissing(chapter);
  const locked = missing.length > 0;
  const steps = chapter.steps.filter(s => s.id);
  const n = steps.filter(s => stepDone(s.id)).length;

  // Есть ли что сбрасывать: отметка главы или отмеченные шаги
  const marked = isDone || steps.some(s => story.steps.has(s.id));
  const status = `<div class="status">
    <div class="status-row">
      <label class="done-check"><input type="checkbox" data-chapter ${isDone ? 'checked' : ''} ${locked ? 'disabled' : ''}> Глава пройдена</label>
      <button type="button" class="reset small" id="resetChapter" ${marked ? '' : 'disabled'}>Сбросить главу</button>
    </div>
    <div class="locked-by">Шагов отмечено: ${n} из ${steps.length}${isDone ? ' (глава пройдена — считаются все)' : ''}</div>
    ${missing.length ? `<div class="locked-by">🔒 Сначала: ${missing.map(chapterLink).join(', ')}</div>` : ''}
  </div>`;

  // Шаги с галочками; заголовки — варианты прохождения (например, концовки «Билета»)
  const stepsHtml = chapter.steps.map(s => s.h
    ? `<li class="step-head">${esc(s.h)}</li>`
    : `<li class="step${s.optional ? ' optional' : ''}"><label>
        <input type="checkbox" data-step="${s.id}" ${stepDone(s.id) ? 'checked' : ''} ${locked || isDone ? 'disabled' : ''}>
        <span>${esc(s.text)}</span>
        ${unlocksByStep[s.id] ? `<span class="tag trader">Открывает: ${esc(unlocksByStep[s.id].join(', '))}</span>` : ''}
      </label></li>`).join('');

  // Квесты, которым нужна эта глава
  const opens = QUESTS.filter(x => (x.storyReqs ?? []).includes(chapter.id));

  const warning = chapter.edited && chapter.edited < RELEASE_1_0
    ? `<p class="warning">⚠ Страница вики не правилась после выхода 1.0 (${dateRu(RELEASE_1_0)}).</p>` : '';

  $('chapter').innerHTML = `
    <h1>${esc(chapter.name)}</h1>
    <div class="meta"><span class="tag trader">Глава ${chapter.order}</span></div>
    ${chapter.cover ? thImg(chapter.cover, 'quest-image') : ''}
    ${status}
    ${section('Условия', chapter.important?.length && blocksHtml(chapter.important))}
    <div class="chapter-cols">
      <div class="col-steps">${section('Шаги', steps.length && `<ul class="steps">${stepsHtml}</ul>`)}</div>
      <div class="col-guide">${section('Прохождение', chapter.walkthrough?.length
        ? `<div class="guide-cards">${guideCards(chapter.walkthrough)}</div>` : '<p class="empty">Прохождения на вики нет.</p>')}</div>
    </div>
    ${section('Открывает квесты', opens.length && `<ul>${opens.map(x =>
      `<li><a href="quest.html?id=${x.id}">${esc(x.name)}</a> (${esc(traderName[x.trader] ?? '')})</li>`).join('')}</ul>`)}
    ${section('Примечания', chapter.notes?.length && blocksHtml(chapter.notes))}
    <p class="source">Источник: <a href="${WIKI}${encodeURIComponent(chapter.title)}" target="_blank" rel="noopener">
      Escape from Tarkov Wiki, «${esc(chapter.title)}»</a> (лицензия CC BY-NC-SA), последняя правка ${dateRu(chapter.edited)}.${
      chapter.cover ? ' Обложка — tarkov.help.' : ''}</p>
    ${warning}
    ${chapter.th ? `<p class="links"><a href="https://tarkov.help/ru/quest/${encodeURIComponent(chapter.th)}" target="_blank" rel="noopener">Глава на tarkov.help ↗</a></p>` : ''}`;
}

// Сбросить главу: снять отметку главы и всех её шагов
$('chapter').addEventListener('click', async e => {
  if (!e.target.closest('#resetChapter')) return;
  if (!await askConfirm(`Сбросить главу «${chapter.name}»?`,
    'Снимутся отметка главы и все отмеченные шаги. Другие главы не изменятся.', 'Сбросить главу')) return;
  story.chapters.delete(chapter.id);
  chapter.steps.forEach(s => s.id && story.steps.delete(s.id));
  saveStory();
  render();
});

$('chapter').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.chapter !== undefined) {
    t.checked ? story.chapters.add(chapter.id) : story.chapters.delete(chapter.id);
  } else if (t.dataset.step) {
    t.checked ? story.steps.add(t.dataset.step) : story.steps.delete(t.dataset.step);
  } else {
    return;
  }
  saveStory();
  render();
});

initShell(render);
render();
