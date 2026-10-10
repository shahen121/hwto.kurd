/**
 * ui.js — all shared UI building blocks: shell, nav, cards, rows, grids,
 * heroes, skeletons, error/empty states, load-more, toasts.
 *
 * Everything returns an HTML string so pages can compose views declaratively;
 * after inserting HTML a page calls hydrate() to wire up lazy images.
 */

import {
  escapeHtml,
  attr,
  cssUrl,
  lazyImage,
  hydrateLazyImages,
  attachImageFallbacks,
  posterUrl,
  heroImage,
  formatRating,
  ratingPercent,
  yearOf,
  mediaLabel,
  detailHref,
  watchHref
} from './utils.js';

export function hydrate(root) {
  hydrateLazyImages(root);
  attachImageFallbacks(root);
}

/* ------------------------------- shell -------------------------------- */

const isCategory = (route, slug) =>
  route.name === 'list' && route.section === 'category' && route.category === slug;

/**
 * The header nav. Items with `children` render as a dropdown («التصنيفات»)
 * whose children are regular links — the panel is a child of the <li> so its
 * absolute positioning escapes `.nav-list`'s horizontal scrolling.
 */
const NAV = [
  { href: '#/', label: 'الرئيسية', match: (r) => r.name === 'home' },
  {
    id: 'categories',
    label: 'التصنيفات',
    children: [
      { href: '#/category/anime', label: 'أنمي', match: (r) => isCategory(r, 'anime') },
      { href: '#/category/series', label: 'مسلسلات', match: (r) => isCategory(r, 'series') },
      { href: '#/category/movies', label: 'أفلام', match: (r) => isCategory(r, 'movies') },
      { href: '#/category/asian', label: 'أفلام ومسلسلات آسيوية', match: (r) => isCategory(r, 'asian') },
      { href: '#/category/turkish', label: 'تركية', match: (r) => isCategory(r, 'turkish') }
    ]
  },
  { href: '#/trending/movie', label: 'الأفلام الرائجة', match: (r) => r.name === 'list' && r.section === 'trending' && r.type === 'movie' },
  { href: '#/trending/tv', label: 'المسلسلات الرائجة', match: (r) => r.name === 'list' && r.section === 'trending' && r.type === 'tv' },
  { href: '#/upcoming', label: 'القادمة', match: (r) => r.name === 'list' && r.section === 'upcoming' },
  { href: '#/toprated/movie', label: 'الأعلى تقييماً', match: (r) => r.name === 'list' && r.section === 'toprated' },
  { href: '#/site', label: 'مكتبة الموقع', match: (r) => r.name === 'list' && r.section === 'site' }
];

const navLink = (item) =>
  `<a class="nav-link" href="${attr(item.href)}" data-nav="${attr(item.label)}">${escapeHtml(item.label)}</a>`;

function navItem(item) {
  if (!item.children) return `<li>${navLink(item)}</li>`;

  const panelId = `nav-panel-${item.id}`;
  return `
            <li class="nav-drop" id="nav-drop">
              <button class="nav-link nav-drop-toggle" type="button" aria-expanded="false" aria-controls="${panelId}">
                <span>${escapeHtml(item.label)}</span>
                <svg class="nav-drop-caret" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
              </button>
              <ul class="nav-drop-panel" id="${panelId}">
                ${item.children
                  .map(
                    (child) =>
                      `<li><a class="nav-link nav-drop-link" href="${attr(child.href)}" data-nav="${attr(child.label)}">${escapeHtml(child.label)}</a></li>`
                  )
                  .join('')}
              </ul>
            </li>`;
}

export function renderShell(root) {
  root.innerHTML = `
    <header class="site-header" id="site-header">
      <div class="container header-inner">
        <a class="brand" href="#/" aria-label="hwto.kurd — الرئيسية">
          <img src="/logo.svg" alt="hwto.kurd" class="brand-logo-img">
        </a>

        <button class="nav-toggle" id="nav-toggle" aria-label="القائمة" aria-expanded="false" aria-controls="site-nav">
          <span></span><span></span><span></span>
        </button>

        <nav class="site-nav" id="site-nav" aria-label="التنقل الرئيسي">
          <ul class="nav-list">
            ${NAV.map(navItem).join('')}
          </ul>
        </nav>

        <form class="header-search" id="header-search" role="search" autocomplete="off">
          <label class="sr-only" for="global-search">ابحث عن فيلم أو مسلسل</label>
          <span class="search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>
          </span>
          <input id="global-search" type="search" name="q" placeholder="ابحث عن فيلم أو مسلسل…" enterkeyhint="search">
          <button type="submit" class="search-submit" aria-label="بحث">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>
          </button>
        </form>
      </div>
    </header>

    <main id="app-view" class="app-view" tabindex="-1"></main>

    <footer class="site-footer">
      <div class="container footer-inner">
        <div class="footer-brand">
          <a class="footer-brand-link" href="#/" aria-label="hwto.kurd — الرئيسية">
            <img src="/logo.svg" alt="hwto.kurd" class="footer-logo-img">
          </a>
          <p>واجهة عصرية ترفيهية لمشاهدة واستكشاف أحدث الأفلام والمسلسلات بجودة عالية.</p>
        </div>
        <nav class="footer-nav" aria-label="روابط الموقع">
          <a href="#/">الرئيسية</a>
          <a href="#/category/anime">أنمي</a>
          <a href="#/category/series">مسلسلات</a>
          <a href="#/category/movies">أفلام</a>
          <a href="#/category/asian">آسيوية</a>
          <a href="#/category/turkish">تركية</a>
          <a href="#/trending/movie">أفلام رائجة</a>
          <a href="#/trending/tv">مسلسلات رائجة</a>
          <a href="#/upcoming">أفلام قادمة</a>
          <a href="#/toprated/movie">الأعلى تقييماً</a>
          <a href="#/site">مكتبة الموقع</a>
        </nav>
        <p class="footer-note">جميع الحقوق محفوظة لـ hwto.kurd © — البيانات والصور مستوردة عبر واجهة TMDB.</p>
      </div>
    </footer>

    <div class="toast-zone" id="toast-zone" role="status" aria-live="polite"></div>
  `;
}

export function setNavActive(route) {
  const links = document.querySelectorAll('.nav-link');
  const candidates = NAV.flatMap((item) => (item.children ? item.children : [item]));
  const active = candidates.find((item) => item.match && item.match(route));
  const activeHref = active && active.href ? active.href : '';
  links.forEach((link) => {
    const href = link.getAttribute('href');
    const isActive = Boolean(activeHref) && href === activeHref;
    link.classList.toggle('is-active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  // The «التصنيفات» dropdown lights up when any of its children is the route.
  document.querySelectorAll('.nav-drop').forEach((drop) => {
    const on = Boolean(drop.querySelector('.nav-link.is-active'));
    drop.classList.toggle('is-active', on);
    const toggle = drop.querySelector('.nav-drop-toggle');
    if (toggle) toggle.classList.toggle('is-active', on);
  });
}

/* ------------------------------ headings ------------------------------ */

export function sectionHeader(title, { href = '', subtitle = '' } = {}) {
  return `
    <div class="section-head">
      <div>
        <h2 class="section-title">${escapeHtml(title)}</h2>
        ${subtitle ? `<p class="section-sub">${escapeHtml(subtitle)}</p>` : ''}
      </div>
      ${href ? `<a class="section-more" href="${attr(href)}">عرض الكل<span aria-hidden="true"> ←</span></a>` : ''}
    </div>`;
}

/**
 * `meta` is raw HTML on purpose (callers pass static markup such as a counter
 * span) — never feed API-derived text into it; escape such text before use.
 */
export function pageHeader(title, { subtitle = '', meta = '' } = {}) {
  return `
    <div class="page-head">
      <h1 class="page-title">${escapeHtml(title)}</h1>
      ${subtitle ? `<p class="page-sub">${escapeHtml(subtitle)}</p>` : ''}
      ${meta ? `<p class="page-meta">${meta}</p>` : ''}
    </div>`;
}

/* ------------------------------- cards -------------------------------- */

export function movieCard(item, { eager = false, showRank = false } = {}) {
  if (!item) return '';
  const rating = formatRating(item.voteAverage);
  const hasRating = item.voteAverage > 0;
  const year = yearOf(item.releaseDate);
  const src = posterUrl(item);
  const href = detailHref(item);

  return `
    <article class="card" tabindex="-1">
      <a class="card-link" href="${attr(href)}" aria-label="${attr(item.title || 'بدون عنوان')}">
        <div class="card-poster">
          ${lazyImage(src, item.title || '', { eager, ratio: '2 / 3' })}
          <span class="card-type">${mediaLabel(item.mediaType)}</span>
          ${hasRating ? `<span class="card-rating" title="التقييم ${attr(rating)} من 10">
            <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M12 17.3l-6.2 3.7 1.7-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.5 4.8 1.7 7z"/></svg>
            ${escapeHtml(rating)}
          </span>` : ''}
          ${showRank && item.rank ? `<span class="card-rank">#${escapeHtml(String(item.rank))}</span>` : ''}
          <span class="card-play" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M8 5.5v13l11-6.5z"/></svg>
          </span>
        </div>
        <div class="card-body">
          <h3 class="card-title">${escapeHtml(item.title || 'بدون عنوان')}</h3>
          <p class="card-meta">${year ? escapeHtml(year) : '—'}${hasRating ? ` <span class="dot">•</span> ${escapeHtml(rating)} ★` : ''}</p>
        </div>
      </a>
    </article>`;
}

export function movieRow(items, opts = {}) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return '';
  return `
    <div class="row-scroller" role="list">
      ${list.map((item) => `<div class="row-cell" role="listitem">${movieCard(item, opts)}</div>`).join('')}
    </div>`;
}

export function movieGrid(items, opts = {}) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return '';
  return `<div class="grid">${list.map((item) => movieCard(item, opts)).join('')}</div>`;
}

export function section(title, items, { href = '', subtitle = '', card = {} } = {}) {
  if (!items || !items.length) return '';
  return `
    <section class="section">
      ${sectionHeader(title, { href, subtitle })}
      ${movieRow(items, card)}
    </section>`;
}

/* -------------------------------- hero -------------------------------- */

export function hero(item, { eyebrow = 'مختارات اليوم', kicker = '' } = {}) {
  if (!item) return '';
  const bg = heroImage(item);
  const rating = formatRating(item.voteAverage);
  const year = yearOf(item.releaseDate);
  return `
    <section class="hero" ${bg ? `style="--hero-img:${attr(cssUrl(bg))}"` : ''}>
      <div class="hero-backdrop" aria-hidden="true"></div>
      <div class="hero-glow" aria-hidden="true"></div>
      <div class="container hero-inner">
        <div class="hero-copy">
          ${kicker ? `<p class="hero-kicker">${escapeHtml(kicker)}</p>` : `<p class="hero-kicker">${escapeHtml(eyebrow)}</p>`}
          <h1 class="hero-title">${escapeHtml(item.title || '')}</h1>
          <div class="hero-facts">
            ${has(item.voteAverage) ? `<span class="chip chip-rating"><span class="chip-star" aria-hidden="true">★</span>${escapeHtml(rating)}</span>` : ''}
            ${year ? `<span class="chip">${escapeHtml(year)}</span>` : ''}
            <span class="chip">${mediaLabel(item.mediaType)}</span>
            <span class="chip chip-live">متوفر الآن</span>
          </div>
          <p class="hero-overview">${escapeHtml(trim(item.overview, 240) || 'لا يوجد وصف متوفر لهذا العنوان حالياً.')}</p>
          <div class="hero-actions">
            <a class="btn btn-primary btn-watch" href="${attr(watchHref(item))}">
              <span class="btn-play" aria-hidden="true">▶</span>
              شاهد الآن
            </a>
            <a class="btn btn-ghost" href="${attr(detailHref(item))}">
              التفاصيل
            </a>
            <button class="btn btn-ghost" type="button" data-scroll-to="sections">
              تصفّح بقية المحتوى
            </button>
          </div>
        </div>
        <div class="hero-poster">
          ${lazyImage(posterUrl(item), item.title || '', { eager: true, ratio: '2 / 3' })}
          <div class="hero-poster-ring" aria-hidden="true"></div>
        </div>
      </div>
      <div class="hero-fade" aria-hidden="true"></div>
    </section>`;
}

const has = (v) => Number.isFinite(Number(v)) && Number(v) > 0;

function trim(text, max) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

/* ------------------------------- stats -------------------------------- */

export function statsBar(stats) {
  if (!stats) return '';
  const items = [
    { label: 'فيلم', value: stats.movies },
    { label: 'مسلسل', value: stats.tvShows },
    { label: 'عنوان رائج', value: stats.trending },
    { label: 'قيد الإضافة', value: stats.upcoming },
    { label: 'الأعلى تقييماً', value: stats.topRated }
  ].filter((s) => Number.isFinite(s.value) && s.value > 0);

  if (!items.length) return '';

  return `
    <section class="stats" aria-label="إحصاءات المكتبة">
      <div class="container stats-inner">
        ${items
          .map(
            (s) => `
          <div class="stat">
            <span class="stat-value" data-count="${attr(String(s.value))}">${escapeHtml(String(s.value))}</span>
            <span class="stat-label">${escapeHtml(s.label)}</span>
          </div>`
          )
          .join('')}
      </div>
    </section>`;
}

/* --------------------------- loading / states ------------------------- */

export function skeletonCards(count = 6) {
  return Array.from({ length: count })
    .map(
      () => `
      <div class="card skeleton" aria-hidden="true">
        <div class="card-poster sk-poster shimmer"></div>
        <div class="card-body">
          <div class="sk-line shimmer" style="width:78%"></div>
          <div class="sk-line sk-line-sm shimmer" style="width:46%"></div>
        </div>
      </div>`
    )
    .join('');
}

export function skeletonRow(count = 6) {
  return `<div class="row-scroller">${Array.from({ length: count })
    .map(() => `<div class="row-cell">${skeletonCards(1)}</div>`)
    .join('')}</div>`;
}

export function skeletonGrid(count = 12) {
  return `<div class="grid">${skeletonCards(count)}</div>`;
}

export function skeletonSections(count = 3) {
  return Array.from({ length: count })
    .map(
      () => `
      <section class="section">
        <div class="section-head">
          <div class="sk-line shimmer" style="width:220px;height:22px"></div>
        </div>
        ${skeletonRow(6)}
      </section>`
    )
    .join('');
}

export function skeletonHero() {
  return `
    <section class="hero hero-skeleton">
      <div class="container hero-inner">
        <div class="hero-copy">
          <div class="sk-line shimmer" style="width:140px;height:16px"></div>
          <div class="sk-line shimmer" style="width:min(560px,80%);height:44px;margin-top:14px"></div>
          <div class="sk-line shimmer" style="width:min(680px,90%);height:60px;margin-top:16px"></div>
          <div class="sk-row" style="margin-top:20px">
            <span class="sk-pill shimmer"></span><span class="sk-pill shimmer"></span><span class="sk-pill shimmer"></span>
          </div>
        </div>
        <div class="hero-poster"><div class="sk-poster shimmer" style="aspect-ratio:2/3"></div></div>
      </div>
    </section>`;
}

export function errorState(message, { onRetry = '', retryId = 'retry-btn' } = {}) {
  return `
    <div class="state state-error" role="alert">
      <span class="state-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="42" height="42" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 8v5"></path><circle cx="12" cy="16.5" r="1.1" fill="currentColor" stroke="none"></circle><path d="M10.3 3.9L2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path></svg>
      </span>
      <h2 class="state-title">تعذّر تحميل المحتوى</h2>
      <p class="state-text">${escapeHtml(message || 'حدث خطأ أثناء جلب البيانات، حاول مرة أخرى.')}</p>
      ${onRetry ? `<button class="btn btn-primary" type="button" id="${attr(retryId)}">إعادة المحاولة</button>` : ''}
    </div>`;
}

export function emptyState(message, { title = 'لا توجد نتائج', hint = '' } = {}) {
  return `
    <div class="state state-empty">
      <span class="state-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="42" height="42" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>
      </span>
      <h2 class="state-title">${escapeHtml(title)}</h2>
      <p class="state-text">${escapeHtml(message)}</p>
      ${hint ? `<p class="state-hint">${escapeHtml(hint)}</p>` : ''}
    </div>`;
}

export function loadingBlock(label = 'جارٍ التحميل…') {
  return `
    <div class="state state-loading" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <p class="state-text">${escapeHtml(label)}</p>
    </div>`;
}

export function loadMoreButton({ id = 'load-more', label = 'عرض المزيد', hidden = false } = {}) {
  return `
    <div class="load-more-wrap" ${hidden ? 'hidden' : ''}>
      <button class="btn btn-outline" type="button" id="${attr(id)}">${escapeHtml(label)}</button>
    </div>`;
}

/* -------------------------------- toast -------------------------------- */

export function showToast(message, { timeout = 3200 } = {}) {
  const zone = document.getElementById('toast-zone');
  if (!zone) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  zone.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-visible'));
  setTimeout(() => {
    el.classList.remove('is-visible');
    setTimeout(() => el.remove(), 320);
  }, timeout);
}
