// Общее для страниц квестов и предметов: сохранение, режим, фракция, прогресс, сюжет и цепочка Каппы
const TRADERS = window.TRADERS;
const QUESTS = window.QUESTS;
const STORY = window.STORY ?? [];
const TRADER_UNLOCKS = window.TRADER_UNLOCKS ?? {};
const traderName = Object.fromEntries(TRADERS.map(t => [t.id, t.name]));
const byId = Object.fromEntries(QUESTS.map(x => [x.id, x]));
const chapterById = Object.fromEntries(STORY.map(c => [c.id, c]));
const stepChapter = Object.fromEntries(STORY.flatMap(c => c.steps.filter(s => s.id).map(s => [s.id, c.id])));

// Сохранение в браузере (localStorage)
function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

const $ = id => document.getElementById(id);
const norm = s => s.toLowerCase().replace(/ё/g, 'е');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Режимы игры. Прогресс в каждом хранится отдельно
const MODES = { pvp: 'PvP', pve: 'PvE', season: 'Сезон' };
const DONE_KEY = { pvp: 'eft-done', pve: 'eft-done-pve', season: 'eft-done-season' };
const doneByMode = Object.fromEntries(Object.keys(MODES).map(m => [m, new Set(load(DONE_KEY[m], []))]));
const state = {
  mode: MODES[load('eft-mode', 'pvp')] ? load('eft-mode', 'pvp') : 'pvp',
  faction: load('eft-faction', 'USEC') === 'BEAR' ? 'BEAR' : 'USEC',
  kappaOnly: load('eft-kappa', false),
};
let done = doneByMode[state.mode];

// Квест есть в текущем режиме и у выбранной фракции. Квесты с eft.su в сезоне
// показываются отдельной группой: неизвестно, есть ли они там
const inMode = x => x.modes.includes(state.mode) || (state.mode === 'season' && !!x.maybeSeason);
const exists = x => inMode(x) && (!x.faction || x.faction === state.faction);

// Прогресс сюжета: пройденные главы и отмеченные шаги
const STORY_KEY = mode => `eft-story-${mode}`;
const loadStory = () => {
  const s = load(STORY_KEY(state.mode), {});
  return { chapters: new Set(s.chapters ?? []), steps: new Set(s.steps ?? []) };
};
let story = loadStory();
const saveStory = () => save(STORY_KEY(state.mode), { chapters: [...story.chapters], steps: [...story.steps] });
const chapterDone = id => story.chapters.has(id);
const stepDone = id => story.steps.has(id) || chapterDone(stepChapter[id]);
// Главы, которые нужно пройти раньше
const chapterMissing = c => c.requires.filter(r => !chapterDone(r));

// Предыдущие квесты. Если требование — квест, которого у нас нет (чужая фракция
// или другой режим), вместо него берём его собственные предыдущие
function effectiveReqs(id) {
  const out = new Set(), seen = new Set(), stack = [...byId[id].requires];
  while (stack.length) {
    const r = stack.pop();
    if (seen.has(r)) continue;
    seen.add(r);
    if (exists(byId[r])) out.add(r);
    else stack.push(...byId[r].requires);
  }
  return [...out];
}

// Цепочка Каппы: квесты из списка Каппы и все квесты, которые к ним ведут.
// Зависит от режима и фракции, поэтому пересчитывается при их смене
function buildChain() {
  const reqs = new Map(QUESTS.filter(exists).map(x => [x.id, effectiveReqs(x.id)]));
  const kappa = new Set();
  const stack = QUESTS.filter(x => x.kappa && exists(x)).map(x => x.id);
  while (stack.length) {
    const id = stack.pop();
    if (kappa.has(id)) continue;
    kappa.add(id);
    stack.push(...reqs.get(id));
  }
  // Квесты, которые блокируются по предыдущим: цепочка Каппы и сезонная цепочка
  const gated = new Set([...kappa, ...QUESTS.filter(x => exists(x) && seasonChain(x)).map(x => x.id)]);
  const dependents = new Map();
  for (const id of gated) {
    for (const r of reqs.get(id)) {
      if (!dependents.has(r)) dependents.set(r, []);
      dependents.get(r).push(id);
    }
  }
  return { reqs, kappa, gated, dependents };
}

// Квесты, которые есть только в сезоне, — цепочка KORD BREACH
function seasonChain(x) {
  return x.modes.length === 1 && x.modes[0] === 'season';
}

let chain = buildChain();

// Уровень персонажа, лояльность и репутация у торговцев — свои для PvP и PvE
const PROFILE_KEY = mode => `eft-profile-${mode}`;
const loadProfile = () => ({ level: 1, ll: {}, rep: {}, ...load(PROFILE_KEY(state.mode), {}) });
let profile = loadProfile();

// Торговцы, у которых в квестах встречаются требования по лояльности или репутации
const tradersWith = type => TRADERS.filter(t => QUESTS.some(x => x.traderReqs.some(r => r.trader === t.id && r.type === type)));
const LL_TRADERS = tradersWith('level');
const REP_TRADERS = tradersWith('reputation');

const SIGN = { '>=': '≥', '<=': '≤', '<': '<', '>': '>', '=': '=' };
const compare = (v, op, target) =>
  op === '>=' ? v >= target : op === '<=' ? v <= target : op === '<' ? v < target : op === '>' ? v > target : v === target;

// Чего не хватает по уровню, торговцам и сюжету (проверяется для всех квестов)
function profileMissing(x) {
  const out = [];
  // Торговец открывается на одном из шагов «Тура»
  const unlock = TRADER_UNLOCKS[x.trader];
  if (unlock && !stepDone(unlock.step)) out.push(`Тур: «${unlock.text}»`);
  for (const c of x.storyReqs ?? []) if (!chapterDone(c)) out.push(`глава «${chapterById[c]?.name ?? c}»`);
  if (x.level > profile.level) out.push(`ур. ${x.level}`);
  for (const r of x.traderReqs) {
    if (r.type === 'level') {
      if ((profile.ll[r.trader] ?? 1) < r.value) out.push(`${traderName[r.trader]} ЛЛ${r.value}`);
    } else if (!compare(profile.rep[r.trader] ?? 0, r.compare, r.value)) {
      out.push(`${traderName[r.trader]} реп. ${SIGN[r.compare] ?? r.compare} ${r.value}`);
    }
  }
  return out;
}

// Невыполненные предыдущие квесты; по ним блокируются цепочка Каппы и сезонная цепочка
const missingReqs = x => chain.gated.has(x.id) ? chain.reqs.get(x.id).filter(r => !done.has(r)) : [];

const isLocked = x => !done.has(x.id) && (missingReqs(x).length > 0 || profileMissing(x).length > 0);

// Снять отметку. Квесты Каппы, которые держатся на этом квесте, тоже теряют отметку
function uncheck(id) {
  const toClear = [], seen = new Set(), stack = [...(chain.dependents.get(id) ?? [])];
  while (stack.length) {
    const d = stack.pop();
    if (seen.has(d)) continue;
    seen.add(d);
    if (done.has(d)) toClear.push(d);
    stack.push(...(chain.dependents.get(d) ?? []));
  }
  if (toClear.length &&
      !confirm(`Снять отметку и с квестов, которые после него?\n\n${toClear.map(d => byId[d].name).join('\n')}`)) {
    return;
  }
  done.delete(id);
  toClear.forEach(d => done.delete(d));
}

// Сброс прогресса текущего режима. main — что сбрасывается всегда, остальное — по галочкам
const RESET_PARTS = {
  quests: 'Отметки выполненных квестов',
  story: 'Прогресс сюжета',
  profile: 'Уровень и лояльность',
  questItems: 'Собранные предметы для квестов',
  hideout: 'Убежище: построенные уровни и собранные предметы',
};

function resetParts(parts) {
  const m = state.mode;
  const found = load(`eft-found-${m}`, {});
  for (const part of parts) {
    if (part === 'quests') save(DONE_KEY[m], []);
    if (part === 'story') save(STORY_KEY(m), {});
    if (part === 'profile') save(PROFILE_KEY(m), {});
    if (part === 'hideout') save(`eft-hideout-${m}`, []);
    const prefix = part === 'questItems' ? 'q:' : part === 'hideout' ? 'h:' : null;
    if (prefix) for (const k of Object.keys(found)) if (k.startsWith(prefix)) delete found[k];
  }
  save(`eft-found-${m}`, found);
}

function openReset(main) {
  let dialog = $('resetDialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'resetDialog';
    dialog.className = 'reset-dialog';
    document.body.append(dialog);
  }
  const others = Object.keys(RESET_PARTS).filter(k => k !== main);
  dialog.innerHTML = `<form method="dialog">
    <h2>Сброс (${MODES[state.mode]})</h2>
    <p>Будет сброшено: <b>${RESET_PARTS[main]}</b></p>
    <p>Можно также сбросить:</p>
    ${others.map(k => `<label><input type="checkbox" value="${k}"> ${RESET_PARTS[k]}</label>`).join('')}
    <div class="dialog-buttons">
      <button value="cancel">Отмена</button>
      <button value="ok" class="danger">Сбросить</button>
    </div>
  </form>`;
  dialog.querySelector('button[value="ok"]').addEventListener('click', () => {
    const extra = [...dialog.querySelectorAll('input:checked')].map(i => i.value);
    resetParts([main, ...extra]);
    location.reload();
  });
  dialog.showModal();
}

// Переключатели режима, фракции и Каппы в шапке. onChange вызывается после смены
function bindSwitches(onChange) {
  const sync = () => {
    document.querySelectorAll('.mode button').forEach(b => b.classList.toggle('on', b.dataset.mode === state.mode));
    document.querySelectorAll('.faction button').forEach(b => b.classList.toggle('on', b.dataset.faction === state.faction));
    document.querySelectorAll('.focus button').forEach(b =>
      b.classList.toggle('on', (b.dataset.kappa === '1') === state.kappaOnly));
  };
  document.querySelector('.mode').addEventListener('click', e => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    state.mode = b.dataset.mode;
    done = doneByMode[state.mode];
    chain = buildChain();
    profile = loadProfile();
    story = loadStory();
    save('eft-mode', state.mode);
    sync();
    onChange();
    applyModeLook(true);
  });
  document.querySelector('.faction').addEventListener('click', e => {
    const b = e.target.closest('button[data-faction]');
    if (!b) return;
    state.faction = b.dataset.faction;
    chain = buildChain();
    save('eft-faction', state.faction);
    sync();
    onChange();
  });
  document.querySelector('.focus')?.addEventListener('click', e => {
    const b = e.target.closest('button[data-kappa]');
    if (!b) return;
    state.kappaOnly = b.dataset.kappa === '1';
    save('eft-kappa', state.kappaOnly);
    sync();
    onChange();
  });
  sync();
}

// Текст с вики: подряд идущие пункты собираются в список, подряд идущие скриншоты — в галерею
function blocksHtml(blocks) {
  let html = '', list = [], shots = [];
  const flush = () => {
    if (list.length) html += `<ul>${list.join('')}</ul>`;
    if (shots.length) html += `<div class="shots">${shots.join('')}</div>`;
    list = [];
    shots = [];
  };
  for (const b of blocks) {
    if (b.t === 'li') { if (shots.length) flush(); list.push(`<li>${esc(b.text)}</li>`); continue; }
    if (b.t === 'img') {
      if (list.length) flush();
      const caption = [b.caption, b.date && `загружено ${b.date.split('-').reverse().join('.')}`].filter(Boolean).join(' · ');
      // В лёгком архиве скриншотов может не быть (их докачивает get_screenshots.py) — тогда прячем
      shots.push(`<figure class="shot"><img src="${b.file}" alt="${esc(b.caption ?? '')}" loading="lazy"
          onerror="hideMissingShot(this)">
        ${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}</figure>`);
      continue;
    }
    flush();
    html += b.t === 'h' ? `<h4>${esc(b.text)}</h4>` : `<p>${esc(b.text)}</p>`;
  }
  flush();
  return html;
}

// Скриншот не нашёлся — убираем его, а если галерея опустела, то и её
function hideMissingShot(img) {
  const gallery = img.closest('.shots');
  img.closest('.shot')?.remove();
  if (gallery && !gallery.children.length) gallery.remove();
}

// Прохождение карточками: новая карточка на каждом подзаголовке (задача, этап, локация),
// раздел «Награды» внутри карточки выделяется отдельно
function guideCards(blocks) {
  const cards = [];
  let card = null;
  const start = title => { card = { title, body: [], reward: [], inReward: false }; cards.push(card); };
  for (const b of blocks) {
    if (b.t === 'h' && (b.level ?? 3) <= 3) { start(b.text); continue; }
    if (!card) start(null);
    if (b.t === 'h' && /^Наград/i.test(b.text)) { card.inReward = true; continue; }
    if (b.t === 'h') card.inReward = false;
    (card.inReward ? card.reward : card.body).push(b);
  }
  let n = 0; // номера только у карточек с заголовком
  return cards.filter(c => c.title || c.body.length || c.reward.length).map(c => `<article class="guide-card">
      ${c.title ? `<h3><span class="card-num">${++n}</span>${esc(c.title)}</h3>` : ''}
      ${blocksHtml(c.body)}
      ${c.reward.length ? `<div class="reward"><div class="reward-title">🎁 Награды</div>${blocksHtml(c.reward)}</div>` : ''}
    </article>`).join('');
}

// Скриншот во весь экран по клику
document.addEventListener('click', e => {
  const img = e.target.closest('.shot img');
  const box = $('lightbox');
  if (img) {
    let lb = box;
    if (!lb) {
      lb = document.createElement('div');
      lb.id = 'lightbox';
      lb.className = 'lightbox';
      document.body.append(lb);
    }
    const caption = img.closest('.shot').querySelector('figcaption')?.textContent ?? '';
    lb.innerHTML = `<img src="${img.getAttribute('src')}" alt=""><div class="lightbox-caption">${esc(caption)}</div>`;
    lb.classList.add('open');
  } else if (box && e.target.closest('#lightbox')) {
    box.classList.remove('open');
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') $('lightbox')?.classList.remove('open');
});

// Цвет и плавная смена режима: PvP, PvE и сезон немного отличаются оттенком
function applyModeLook(animate) {
  document.body.dataset.mode = state.mode;
  if (!animate) return;
  document.body.classList.remove('mode-fade');
  void document.body.offsetWidth; // перезапуск анимации
  document.body.classList.add('mode-fade');
}
applyModeLook(false);
