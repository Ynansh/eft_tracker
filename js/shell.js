// Каркас всех страниц: боковое меню (разделы, режим, фракция, профиль), выезжающее меню на телефоне,
// сворачивание меню до иконок и плавные переходы между страницами. Общая логика — в common.js
const ICONS = {
  logo: '<circle cx="12" cy="12" r="8"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1.4"/>',
  quests: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M3.5 6l1.6 1.6L8 4.8M3.5 12l1.6 1.6L8 10.8M3.5 18l1.6 1.6L8 16.8"/>',
  story: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/><path d="M9 7.5h6"/>',
  items: '<path d="M3.5 7.5 12 3.5l8.5 4L12 11.5z"/><path d="M3.5 7.5v9l8.5 4 8.5-4v-9"/><path d="M12 11.5v9"/>',
  collapse: '<path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.2-3.6 3.8-5.5 7-5.5s5.8 1.9 7 5.5"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
};
const svgIcon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

// Разделы меню. «Сюжет» — вкладка на странице квестов
const NAV = [
  { id: 'quests', href: 'index.html?tab=quests', label: 'Квесты', icon: 'quests' },
  { id: 'story', href: 'index.html?tab=story', label: 'Сюжет', icon: 'story' },
  { id: 'items', href: 'items.html', label: 'Предметы', icon: 'items' },
];

const shell = {
  // Страница квестов переключает «Квесты»/«Сюжет» без перезагрузки
  onSamePage: null,
  setActive(id) {
    document.querySelectorAll('.side-nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === id));
  },
};

function renderProfile() {
  const ll = LL_TRADERS.map(t => `<label><span>${esc(t.name)}</span>
      <select data-ll="${t.id}">${[1, 2, 3, 4].map(n =>
        `<option ${(profile.ll[t.id] ?? 1) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`).join('');
  const rep = REP_TRADERS.map(t => `<label><span>${esc(t.name)}, реп.</span>
      <input type="number" step="0.01" data-rep="${t.id}" value="${profile.rep[t.id] ?? 0}"></label>`).join('');
  $('profileFields').innerHTML = `<label class="wide"><span>Уровень персонажа</span>
      <input type="number" min="1" max="79" data-level value="${profile.level}"></label>
    <div class="profile-sub">Лояльность торговцев</div>${ll}${rep}`;
  $('profileSummary').textContent = `ур. ${profile.level}`;
}

function initShell(onChange) {
  const page = document.body.dataset.page;
  $('sidebar').innerHTML = `
    <a class="brand" href="index.html?tab=quests">
      <span class="brand-mark">${svgIcon('logo')}</span>
      <span class="brand-text"><b>Tarkov</b><span>трекер квестов</span></span>
    </a>
    <nav class="side-nav" aria-label="Разделы">
      ${NAV.map(n => `<a href="${n.href}" data-nav="${n.id}" class="${n.id === page ? 'on' : ''}" title="${n.label}">
        ${svgIcon(n.icon)}<span>${n.label}</span></a>`).join('')}
    </nav>
    <div class="side-settings">
      <div class="side-label">Режим</div>
      <div class="seg mode" role="group" aria-label="Режим игры">
        <button type="button" data-mode="pvp">PvP</button>
        <button type="button" data-mode="pve">PvE</button>
        <button type="button" data-mode="season">Сезон</button>
      </div>
      <div class="side-label">Фракция</div>
      <div class="seg faction" role="group" aria-label="Фракция">
        <button type="button" data-faction="USEC">USEC</button>
        <button type="button" data-faction="BEAR">BEAR</button>
      </div>
      <div class="side-label">Тема</div>
      <div class="seg theme" role="group" aria-label="Тема оформления">
        <button type="button" data-theme-set="dark">${svgIcon('moon')}Тёмная</button>
        <button type="button" data-theme-set="light">${svgIcon('sun')}Светлая</button>
      </div>
      <details class="side-profile" id="sideProfile">
        <summary>${svgIcon('user')}<span>Профиль</span><small id="profileSummary"></small></summary>
        <div id="profileFields" class="profile-fields"></div>
      </details>
    </div>
    <button type="button" class="collapse-btn" id="collapseBtn" title="Свернуть меню">${svgIcon('collapse')}<span>Свернуть</span></button>`;

  // Кнопка меню для телефона — в начало шапки страницы
  document.querySelector('.page-head')?.insertAdjacentHTML('afterbegin',
    `<button type="button" class="menu-btn" id="menuBtn" aria-label="Открыть меню">${svgIcon('menu')}</button>`);

  // Открыт ли профиль и свёрнуто ли меню — запоминаем
  const profileBox = $('sideProfile');
  profileBox.open = load('eft-profile-open', false);
  profileBox.addEventListener('toggle', () => save('eft-profile-open', profileBox.open));
  document.body.classList.toggle('side-collapsed', load('eft-side-collapsed', false));
  $('collapseBtn').addEventListener('click', () => {
    const collapsed = document.body.classList.toggle('side-collapsed');
    save('eft-side-collapsed', collapsed);
  });

  // Выезжающее меню на телефоне
  const closeNav = () => document.body.classList.remove('nav-open');
  $('menuBtn')?.addEventListener('click', () => document.body.classList.add('nav-open'));
  document.querySelector('.scrim')?.addEventListener('click', closeNav);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeNav(); });

  // Тема оформления (применяется ещё в <head>, здесь — переключатель)
  const syncTheme = () => document.querySelectorAll('.theme button').forEach(b =>
    b.classList.toggle('on', b.dataset.themeSet === document.documentElement.dataset.theme));
  document.querySelector('.theme').addEventListener('click', e => {
    const b = e.target.closest('button[data-theme-set]');
    if (!b) return;
    document.documentElement.classList.add('theme-anim');
    document.documentElement.dataset.theme = b.dataset.themeSet;
    save('eft-theme', b.dataset.themeSet);
    syncTheme();
    setTimeout(() => document.documentElement.classList.remove('theme-anim'), 400);
  });
  syncTheme();

  renderProfile();
  bindSwitches(() => {
    renderProfile();
    onChange();
  });

  // Уровень, лояльность и репутация
  $('profileFields').addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.level !== undefined) profile.level = Math.max(1, parseInt(t.value, 10) || 1);
    else if (t.dataset.ll) profile.ll[t.dataset.ll] = parseInt(t.value, 10);
    else if (t.dataset.rep) profile.rep[t.dataset.rep] = parseFloat(t.value) || 0;
    else return;
    save(PROFILE_KEY(state.mode), profile);
    renderProfile();
    onChange();
  });

  // Разделы «Квесты» и «Сюжет» на странице квестов переключаются на месте
  $('sidebar').addEventListener('click', e => {
    const a = e.target.closest('.side-nav a');
    if (!a || !shell.onSamePage || page === 'items') return;
    e.preventDefault();
    shell.onSamePage(a.dataset.nav);
    closeNav();
  });
}

// Плавный переход между страницами трекера: текущая страница гаснет, новая проявляется
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
document.addEventListener('click', e => {
  const a = e.target.closest('a[href]');
  if (!a || reduceMotion || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
  const href = a.getAttribute('href');
  if (!/^[\w-]+\.html/.test(href)) return; // только свои страницы
  e.preventDefault();
  document.body.classList.add('page-out');
  setTimeout(() => { location.href = href; }, 160);
});
// Возврат кнопкой «Назад» из кэша страницы — снимаем затемнение
window.addEventListener('pageshow', () => document.body.classList.remove('page-out'));
