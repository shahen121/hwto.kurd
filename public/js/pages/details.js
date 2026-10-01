/**
 * pages/details.js — title detail view.
 *
 * The details cache does NOT contain most items (the API answers with
 * {"error": "..."} over HTTP 200), so every failure falls back to the list
 * item remembered by store.js. The view renders whatever combination exists
 * and says so honestly instead of showing a blank page.
 */

import { api, ApiError } from '../api.js';
import * as ui from '../ui.js';
import { getTvSeriesStructure } from '../config.js';
import { recall, remember } from '../store.js';
import { navigate, previousHash, buildHash } from '../router.js';
import {
  escapeHtml,
  attr,
  lazyImage,
  backdropUrl,
  posterUrl,
  formatDate,
  yearOf,
  formatRating,
  formatCount,
  genreNames,
  languageName,
  countryName,
  mediaLabel,
  mediaPlural
} from '../utils.js';

const isAbort = (err) => Boolean(err && err.name === 'AbortError');

export async function mount(params, view, { signal }) {
  const type = params.type === 'tv' ? 'tv' : 'movie';
  const id = Number(params.id);

  view.innerHTML = `<div class="container page">${ui.skeletonHero()}</div>`;
  ui.hydrate(view);

  if (!Number.isFinite(id) || id <= 0) {
    view.innerHTML = `<div class="container page">${ui.errorState('معرّف غير صالح.', {})}</div>`;
    return;
  }

  let detail = null;
  let detailFailed = false;
  let fallback = recall(type, id);

  try {
    detail = await api.getDetail(type, id, { signal });
  } catch (err) {
    if (isAbort(err)) return;
    detailFailed = true;
    if (!(err instanceof ApiError) || err.retriable) {
      // Network/server problem: if we remember the item, show it, else error out.
      if (!fallback) {
        view.innerHTML = `<div class="container page">${ui.errorState(err.message, { onRetry: true, retryId: 'detail-retry' })}</div>`;
        const retry = view.querySelector('#detail-retry');
        if (retry) retry.addEventListener('click', () => window.dispatchEvent(new CustomEvent('app:reload')));
        return;
      }
    }
  }

  if (!detail && !fallback) {
    view.innerHTML = `<div class="container page">${ui.errorState('هذا العنوان غير متوفر في قاعدة البيانات.', {
      title: 'غير متوفر'
    })}</div>`;
    return;
  }

  const item = merge(type, id, detail, fallback);
  remember(type, item);

  // Related titles — same media type, excluding the current one.
  let related = [];
  try {
    const list = await api.getTrending({ type, signal });
    related = list.items.filter((i) => Number(i.id) !== id).slice(0, 12);
  } catch (err) {
    if (isAbort(err)) return;
  }

  if (signal.aborted) return;

  // Watch button uses the TMDB id directly — vidcore.io accepts it as-is.
  const watchLink = watchHref(type, id, item.title);

  const bg = backdropUrl(item);
  const poster = posterUrl(item);
  const genres = genreNames(item.genreIds);
  const year = yearOf(item.releaseDate);
  const hasVotes = item.voteCount > 0;

  view.innerHTML = `
    <article class="detail ${bg ? 'has-backdrop' : ''}">
      ${bg ? `<div class="detail-backdrop" style="--d-img:url('${attr(bg)}')" aria-hidden="true"></div>` : ''}
      <div class="detail-shade" aria-hidden="true"></div>

      <div class="container detail-inner">
        <nav class="crumbs" aria-label="مسار التنقل">
          <a href="#/">الرئيسية</a>
          <span aria-hidden="true">/</span>
          <a href="${attr(type === 'tv' ? '#/trending/tv' : '#/trending/movie')}">${mediaPlural(type)}</a>
          <span aria-hidden="true">/</span>
          <span class="crumbs-current">${escapeHtml(item.title || 'بدون عنوان')}</span>
        </nav>

        <div class="detail-grid">
          <div class="detail-poster">
            ${lazyImage(poster, item.title || '', { eager: true, ratio: '2 / 3' })}
            <div class="poster-glow" aria-hidden="true"></div>
          </div>

          <div class="detail-main">
            <p class="detail-kicker">${mediaLabel(type)}${year ? ` <span class="dot">•</span> ${escapeHtml(year)}` : ''}</p>
            <h1 class="detail-title">${escapeHtml(item.title || 'بدون عنوان')}</h1>
            ${
              item.originalTitle && item.originalTitle !== item.title
                ? `<p class="detail-original">${escapeHtml(item.originalTitle)}</p>`
                : ''
            }

            <div class="detail-facts">
              ${
                item.voteAverage > 0
                  ? `<span class="fact fact-rating" title="متوسط التقييم">
                      <span class="fact-star" aria-hidden="true">★</span>
                      <strong>${escapeHtml(formatRating(item.voteAverage))}</strong><span class="fact-sub">/ 10</span>
                      ${hasVotes ? `<span class="fact-sub">(${escapeHtml(formatCount(item.voteCount))} تقييم)</span>` : ''}
                    </span>`
                  : ''
              }
              ${item.releaseDate ? `<span class="fact"><strong>${escapeHtml(formatDate(item.releaseDate))}</strong></span>` : ''}
              ${item.language ? `<span class="fact">اللغة: <strong>${escapeHtml(languageName(item.language))}</strong></span>` : ''}
              ${item.country ? `<span class="fact">بلد الإنتاج: <strong>${escapeHtml(countryName(item.country))}</strong></span>` : ''}
              ${genres.length ? `<span class="fact">${genres.map((g) => `<span class="genre-pill">${escapeHtml(g)}</span>`).join('')}</span>` : ''}
            </div>

            <div class="detail-actions">
              <a class="btn btn-primary btn-watch" href="${attr(watchLink)}">
                <span class="btn-play" aria-hidden="true">▶</span> ${type === 'tv' ? 'شاهد الحلقة الأولى' : 'شاهد الآن'}
              </a>
              <button class="btn btn-ghost" type="button" data-back>رجوع</button>
              <a class="btn btn-ghost" href="${attr(type === 'tv' ? '#/trending/tv' : '#/trending/movie')}">تصفح ${mediaPlural(type)}</a>
            </div>

            <section class="overview">
              <h2 class="overview-title">القصة</h2>
              ${
                item.overview
                  ? `<p class="overview-text">${escapeHtml(item.overview)}</p>`
                  : `<p class="overview-text is-muted">لا يوجد وصف محفوظ لهذا العنوان في قاعدة البيانات.</p>`
              }
            </section>

            ${
              detailFailed
                ? `<p class="detail-note">بعض البيانات التفصيلية غير متوفرة حالياً، المعروض مأخوذ من فهرس القوائم.</p>`
                : ''
            }
          </div>
        </div>

        ${type === 'tv' ? renderTvDetailsSeasons(id, item.title) : ''}

        ${
          related.length
            ? `<section class="section detail-related">
                ${ui.sectionHeader('قد يعجبك أيضاً', {
                  href: type === 'tv' ? '#/trending/tv' : '#/trending/movie'
                })}
                ${ui.movieRow(related, {})}
              </section>`
            : ''
        }
      </div>
    </article>`;

  ui.hydrate(view);

  if (item.title) document.title = `${item.title} — hwto.kurd`;

  const backBtn = view.querySelector('[data-back]');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      const prev = previousHash();
      if (prev && prev !== location.hash && history.length > 1) history.back();
      else navigate('#/');
    });
  }

  if (type === 'tv') {
    wireDetailsTvSeasons(view, id, item.title);
  }
}

function renderTvDetailsSeasons(id, title) {
  const structure = getTvSeriesStructure(id, 1, 0);
  const seasons = structure.seasons;
  const episodes = structure.episodes;

  return `
    <section class="section detail-seasons-section">
      <div class="section-head">
        <div>
          <h2 class="section-title">المواسم والأجزاء (${seasons.length})</h2>
          <p class="section-sub">اختر الموسم والحلقة لمشاهدة البث مباشرة، أو استخدم الانتقال السريع لأي حلقة</p>
        </div>
      </div>

      <div class="detail-season-tabs tabs" role="tablist">
        ${seasons
          .map(
            (s) => `
          <button class="tab ${s === 1 ? 'is-active' : ''}" type="button" role="tab" data-detail-season="${s}">
            الموسم ${s} (${getTvSeriesStructure(id, s).episodeCount} حلقة)
          </button>`
          )
          .join('')}
      </div>

      <div class="detail-tv-jump-bar">
        <span class="jump-bar-label">انتقال مباشر لحلقة معينة:</span>
        <div class="jump-bar-inputs">
          <label for="detail-jump-s">الموسم</label>
          <input type="number" id="detail-jump-s" min="1" max="99" value="1">
          <label for="detail-jump-e">الحلقة</label>
          <input type="number" id="detail-jump-e" min="1" max="999" value="1">
          <button class="btn btn-primary btn-sm" type="button" id="btn-detail-jump">مشاهدة مباشرة</button>
        </div>
      </div>

      <div class="detail-episodes-grid" id="detail-episodes-grid">
        ${episodes
          .map(
            (ep) => `
          <a class="detail-ep-card" href="${attr(buildHash({ name: 'watch', type: 'tv', id, title, season: '1', episode: String(ep) }))}">
            <span class="detail-ep-badge">حلقة ${ep}</span>
            <span class="detail-ep-play">▶ مشاهدة</span>
          </a>`
          )
          .join('')}
      </div>
    </section>
  `;
}

function wireDetailsTvSeasons(root, id, title) {
  const tabs = root.querySelectorAll('[data-detail-season]');
  const grid = root.querySelector('#detail-episodes-grid');
  if (!grid) return;

  let activeSeason = 1;

  const renderGrid = () => {
    const sStructure = getTvSeriesStructure(id, activeSeason);
    const episodes = sStructure.episodes;
    grid.innerHTML = episodes
      .map(
        (ep) => `
      <a class="detail-ep-card" href="${attr(buildHash({ name: 'watch', type: 'tv', id, title, season: String(activeSeason), episode: String(ep) }))}">
        <span class="detail-ep-badge">حلقة ${ep}</span>
        <span class="detail-ep-play">▶ مشاهدة</span>
      </a>`
      )
      .join('');
  };

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const s = Number(tab.getAttribute('data-detail-season')) || 1;
      activeSeason = s;
      tabs.forEach((t) => t.classList.toggle('is-active', t === tab));
      renderGrid();

      const jumpS = root.querySelector('#detail-jump-s');
      if (jumpS) jumpS.value = String(activeSeason);
    });
  });

  const btnJump = root.querySelector('#btn-detail-jump');
  if (btnJump) {
    btnJump.addEventListener('click', () => {
      const sInput = root.querySelector('#detail-jump-s');
      const epInput = root.querySelector('#detail-jump-e');
      const s = Math.max(1, Number(sInput ? sInput.value : 1) || 1);
      const ep = Math.max(1, Number(epInput ? epInput.value : 1) || 1);
      navigate(buildHash({ name: 'watch', type: 'tv', id, title, season: String(s), episode: String(ep) }));
    });
  }
}

/** Build a hash link to the watch page using the TMDB id. */
function watchHref(type, tmdbId, title) {
  return buildHash({ name: 'watch', type, id: tmdbId, title: title || '', season: type === 'tv' ? '1' : '', episode: type === 'tv' ? '1' : '' });
}

function merge(type, id, detail, fallback) {
  const base = fallback || {};
  const d = detail || {};
  return {
    id,
    mediaType: type,
    title: d.title || base.title || '',
    originalTitle: d.originalTitle || '',
    overview: d.overview || base.overview || '',
    posterPath: d.posterPath || base.posterPath || '',
    backdropPath: d.backdropPath || base.backdropPath || '',
    dbPhoto: base.dbPhoto || '',
    releaseDate: d.releaseDate || base.releaseDate || '',
    voteAverage: Number(d.voteAverage) || Number(base.voteAverage) || 0,
    voteCount: Number(d.voteCount) || 0,
    language: d.language || '',
    country: Array.isArray(d.country) ? d.country[0] || '' : d.country || '',
    genreIds: Array.isArray(d.genreIds) && d.genreIds.length ? d.genreIds : []
  };
}
