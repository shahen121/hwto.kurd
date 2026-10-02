/**
 * pages/watch.js — the player screen: embeds vidcore.io directly using the
 * TMDB id, with full support for TV series seasons/episodes, direct stream
 * copying, and an integrated download/playback options modal.
 */

import * as ui from '../ui.js';
import { navigate, previousHash, buildHash } from '../router.js';
import { escapeHtml, attr, mediaLabel, mediaPlural } from '../utils.js';
import { getTvSeriesStructure, PLAYER_SERVERS } from '../config.js';
import { api } from '../api.js';

let ctx = null;

/** Build player embed URL using the primary VidCore server. */
function playerUrl(params) {
  const media = params.type === 'tv' ? 'tv' : 'movie';
  const id = params.id;
  const s = Number(params.season) || 1;
  const e = Number(params.episode) || 1;
  const server = PLAYER_SERVERS[0];
  return media === 'tv' ? server.tvUrl(id, s, e) : server.movieUrl(id);
}

export async function mount(params, view, { signal }) {
  ctx = { view, params, signal };

  const media = params.type === 'tv' ? 'tv' : 'movie';
  const title = params.title || '';
  const currentSeason = Number(params.season) || 1;
  const currentEpisode = Number(params.episode) || 1;
  const url = playerUrl(params);

  const detailHref = buildHash({ name: 'details', type: media, id: params.id });

  view.innerHTML = `
    <div class="container page watch-page">
      <nav class="crumbs" aria-label="مسار التنقل">
        <a href="#/">الرئيسية</a>
        <span aria-hidden="true">/</span>
        <a href="${attr(media === 'tv' ? '#/trending/tv' : '#/trending/movie')}">${mediaPlural(media)}</a>
        <span aria-hidden="true">/</span>
        ${title ? `<a href="${attr(detailHref)}">${escapeHtml(title)}</a><span aria-hidden="true">/</span>` : ''}
        <span class="crumbs-current">المشاهدة</span>
      </nav>

      <div class="watch-head">
        <div class="watch-head-text">
          <p class="watch-kicker">
            ${mediaLabel(media)} <span class="dot" aria-hidden="true">•</span>
            ${media === 'tv' ? `الموسم ${escapeHtml(String(currentSeason))} — الحلقة ${escapeHtml(String(currentEpisode))}` : 'مشاهدة الفيلم'}
          </p>
          <h1 class="watch-title">${escapeHtml(title || 'المشاهدة')}</h1>
        </div>
        <button class="btn btn-ghost" type="button" data-back>رجوع</button>
      </div>

      <div class="watch-frame">
        <iframe
          src="${attr(url)}"
          title="مشغّل ${attr(title || 'الفيديو')}"
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media; accelerometer; gyroscope; clipboard-write; web-share"
          referrerpolicy="origin-when-cross-origin"></iframe>
      </div>

      <div class="watch-actions">
        <button class="btn btn-primary btn-copy-stream" type="button" id="btn-copy-stream" title="نسخ رابط المشاهدة">
          <span aria-hidden="true">📋</span> نسخ الرابط
        </button>
        <button class="btn btn-ghost" type="button" id="btn-toggle-download-modal">
          <span aria-hidden="true">⬇</span> خيارات التشغيل والتحميل
        </button>
        <button class="btn btn-ghost" type="button" data-back>رجوع</button>
        ${media === 'tv' ? renderEpisodeNav(params.id, currentSeason, currentEpisode) : ''}
      </div>

      <div class="server-strip" id="server-strip" hidden>
        <span class="server-strip-label">سيرفر التشغيل:</span>
        <div class="server-list" id="server-list" role="group" aria-label="سيرفرات التشغيل البديلة"></div>
      </div>

      <div class="download-box" id="download-box" hidden>
        <div class="download-box-inner">
          <div class="download-box-head">
            <h3 class="download-box-title">خيارات التحميل والتشغيل المباشر</h3>
            <button class="btn-close-box" type="button" id="btn-close-download-box" aria-label="إغلاق">✕</button>
          </div>
          
          <div class="download-field-group">
            <label class="download-label" for="stream-url-input">رابط البث المباشر (جاهز لبرامج التحميل):</label>
            <div class="download-input-wrap">
              <input class="download-input" id="stream-url-input" type="text" readonly value="${attr(url)}">
              <button class="btn btn-primary btn-sm" type="button" id="btn-copy-modal-input">نسخ الرابط</button>
            </div>
            <p class="download-hint">انسخ هذا الرابط والصقه في برامج التحميل مثل <strong>Internet Download Manager (IDM)</strong> على الكمبيوتر أو <strong>1DM</strong> على الهاتف لتنزيل الفيديو مباشرة.</p>
          </div>

          <div class="download-methods-grid">
            <div class="download-method-card">
              <h4 class="method-title">⚡ برامج التحميل الخارجية (IDM / 1DM)</h4>
              <p class="method-desc">افتح برنامج التحميل، اختر «إضافة رابط جديد»، والصق الرابط المنسوخ أعلاه وسيبدأ التحميل بأقصى سرعة.</p>
            </div>
            <div class="download-method-card">
              <h4 class="method-title">🎬 التشغيل في VLC Player</h4>
              <p class="method-desc">في برنامج VLC، اختر <strong>وسائط ← افتح دفق شبكة</strong> والصق الرابط للتشغيل المباشر بدون إعلانات وبأعلى جودة.</p>
            </div>
          </div>
        </div>
      </div>

      ${media === 'tv' ? renderTvControls(params.id, title, currentSeason, currentEpisode) : ''}
    </div>`;

  ui.hydrate(view);
  wireBack(view);
  wireDownloadAndCopy(view, url);
  if (media === 'tv') wireTvControls(view, params);
  wireAlternateServers(view, params, media);

  updateDocTitle(title, media, currentSeason, currentEpisode);
}

async function wireAlternateServers(root, params, media) {
  const strip = root.querySelector('#server-strip');
  const list = root.querySelector('#server-list');
  if (!strip || !list) return;
  if (media !== 'movie') {
    strip.hidden = true;
    return;
  }

  try {
    const data = await api.getServers({ title: params.title || '', tmdbid: params.id });
    const servers = (data && data.servers) || [];
    if (!servers.length) return;

    strip.hidden = false;
    list.innerHTML = servers
      .map(
        (srv) =>
          `<button type="button" class="server-pill" data-url="${attr(srv.url)}">${escapeHtml(srv.label)}</button>`
      )
      .join('');

    list.addEventListener('click', (e) => {
      const pill = e.target.closest('.server-pill');
      if (!pill) return;
      const url = pill.getAttribute('data-url');
      if (!url) return;
      list.querySelectorAll('.server-pill').forEach((p) => p.classList.toggle('is-active', p === pill));
      const iframe = root.querySelector('.watch-frame iframe');
      if (iframe) iframe.src = url;
      const streamInput = root.querySelector('#stream-url-input');
      if (streamInput) streamInput.value = url;
    });
  } catch {
    // Servers are optional — the primary VidCore player stays active.
  }
}

function wireDownloadAndCopy(root, initialUrl) {
  const copyUrl = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      ui.showToast('تم نسخ رابط البث المباشر بنجاح! جاهز للصق في IDM / 1DM / VLC');
    } catch {
      const input = root.querySelector('#stream-url-input');
      if (input) {
        input.select();
        document.execCommand('copy');
        ui.showToast('تم نسخ رابط البث المباشر بنجاح!');
      }
    }
  };

  const btnCopy = root.querySelector('#btn-copy-stream');
  if (btnCopy) {
    btnCopy.addEventListener('click', () => {
      const input = root.querySelector('#stream-url-input');
      copyUrl(input ? input.value : playerUrl(ctx?.params || {}));
    });
  }

  const btnModalCopy = root.querySelector('#btn-copy-modal-input');
  if (btnModalCopy) {
    btnModalCopy.addEventListener('click', () => {
      const input = root.querySelector('#stream-url-input');
      copyUrl(input ? input.value : playerUrl(ctx?.params || {}));
    });
  }

  const modal = root.querySelector('#download-box');
  const btnToggle = root.querySelector('#btn-toggle-download-modal');
  const btnClose = root.querySelector('#btn-close-download-box');

  if (btnToggle && modal) {
    btnToggle.addEventListener('click', () => {
      const isHidden = modal.hidden;
      modal.hidden = !isHidden;
      if (!modal.hidden) {
        modal.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  if (btnClose && modal) {
    btnClose.addEventListener('click', () => {
      modal.hidden = true;
    });
  }
}

function renderEpisodeNav(id, season, episode) {
  const hasPrev = episode > 1 || season > 1;
  return `
    <div class="watch-ep-nav">
      ${hasPrev ? `<button class="btn btn-outline btn-ep-nav" type="button" data-nav-dir="prev">◀ الحلقة السابقة</button>` : ''}
      <span class="badge-current-ep">الموسم ${escapeHtml(String(season))} — الحلقة ${escapeHtml(String(episode))}</span>
      <button class="btn btn-outline btn-ep-nav" type="button" data-nav-dir="next">الحلقة التالية ▶</button>
    </div>
  `;
}

function renderTvControls(id, title, activeSeason, activeEpisode) {
  const structure = getTvSeriesStructure(id, activeSeason);
  const seasons = structure.seasons;
  const episodes = structure.episodes;

  return `
    <section class="watch-tv-controls" aria-label="اختيار الموسم والحلقة">
      <div class="watch-section-header">
        <h2 class="watch-section-heading">المواسم والأجزاء (${seasons.length})</h2>
      </div>

      <div class="watch-seasons-bar" role="tablist" aria-label="المواسم">
        ${seasons
          .map(
            (s) => `
            <button
              class="tab-season ${s === activeSeason ? 'is-active' : ''}"
              type="button"
              role="tab"
              aria-selected="${s === activeSeason ? 'true' : 'false'}"
              data-season-tab="${s}">
              الموسم ${s}
            </button>`
          )
          .join('')}
      </div>

      <div class="watch-quick-jump">
        <span class="quick-jump-label">انتقال مباشر:</span>
        <div class="quick-jump-fields">
          <label for="jump-season">الموسم</label>
          <input type="number" id="jump-season" min="1" max="99" value="${activeSeason}">
          <label for="jump-episode">الحلقة</label>
          <input type="number" id="jump-episode" min="1" max="999" value="${activeEpisode}">
          <button class="btn btn-primary btn-sm" type="button" id="btn-quick-jump">تشغيل</button>
        </div>
      </div>

      <div class="watch-episodes-container">
        <h3 class="watch-episodes-title">حلقات الموسم <span id="active-season-label">${escapeHtml(String(activeSeason))}</span> (<span id="active-season-count">${episodes.length}</span> حلقة):</h3>
        <div class="watch-episodes-grid" id="watch-episodes-grid">
          ${episodes
            .map(
              (ep) => `
              <button
                class="btn-watch-ep ${ep === activeEpisode ? 'is-active' : ''}"
                type="button"
                data-ep="${ep}">
                <span class="ep-num">${ep}</span>
                <span class="ep-text">الحلقة ${ep}</span>
              </button>`
            )
            .join('')}
        </div>
      </div>
    </section>
  `;
}

function wireTvControls(root, params) {
  let activeSeason = Number(params.season) || 1;
  let activeEpisode = Number(params.episode) || 1;

  const renderEpisodesForSeason = (season) => {
    const sStructure = getTvSeriesStructure(params.id, season);
    const grid = root.querySelector('#watch-episodes-grid');
    const label = root.querySelector('#active-season-label');
    const count = root.querySelector('#active-season-count');
    if (label) label.textContent = String(season);
    if (count) count.textContent = String(sStructure.episodes.length);
    if (grid) {
      grid.innerHTML = sStructure.episodes
        .map(
          (ep) => `
          <button
            class="btn-watch-ep ${ep === activeEpisode ? 'is-active' : ''}"
            type="button"
            data-ep="${ep}">
            <span class="ep-num">${ep}</span>
            <span class="ep-text">الحلقة ${ep}</span>
          </button>`
        )
        .join('');
      grid.querySelectorAll('[data-ep]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const ep = Number(btn.getAttribute('data-ep'));
          if (!ep) return;
          switchEpisode(activeSeason, ep);
        });
      });
    }
  };

  // Season Tab switching
  root.querySelectorAll('[data-season-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const s = Number(tab.getAttribute('data-season-tab'));
      if (!s || s === activeSeason) return;
      activeSeason = s;

      root.querySelectorAll('[data-season-tab]').forEach((t) => {
        const isCur = Number(t.getAttribute('data-season-tab')) === s;
        t.classList.toggle('is-active', isCur);
        t.setAttribute('aria-selected', isCur ? 'true' : 'false');
      });

      renderEpisodesForSeason(activeSeason);
      switchEpisode(activeSeason, 1);
    });
  });

  // Initial Episode click
  root.querySelectorAll('#watch-episodes-grid [data-ep]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ep = Number(btn.getAttribute('data-ep'));
      if (!ep) return;
      switchEpisode(activeSeason, ep);
    });
  });

  // Next / Prev Episode buttons
  root.querySelectorAll('[data-nav-dir]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dir = btn.getAttribute('data-nav-dir');
      const struct = getTvSeriesStructure(params.id, activeSeason);
      if (dir === 'next') {
        if (activeEpisode < struct.episodeCount) {
          switchEpisode(activeSeason, activeEpisode + 1);
        } else {
          // Advance to next season
          activeSeason += 1;
          renderEpisodesForSeason(activeSeason);
          switchEpisode(activeSeason, 1);
        }
      } else if (dir === 'prev') {
        if (activeEpisode > 1) {
          switchEpisode(activeSeason, activeEpisode - 1);
        } else if (activeSeason > 1) {
          activeSeason -= 1;
          const prevStruct = getTvSeriesStructure(params.id, activeSeason);
          renderEpisodesForSeason(activeSeason);
          switchEpisode(activeSeason, prevStruct.episodeCount);
        }
      }
    });
  });

  // Quick Jump
  const btnJump = root.querySelector('#btn-quick-jump');
  if (btnJump) {
    btnJump.addEventListener('click', () => {
      const sInput = root.querySelector('#jump-season');
      const epInput = root.querySelector('#jump-episode');
      const s = Math.max(1, Number(sInput ? sInput.value : 1) || 1);
      const ep = Math.max(1, Number(epInput ? epInput.value : 1) || 1);
      activeSeason = s;

      renderEpisodesForSeason(activeSeason);
      switchEpisode(s, ep);
    });
  }

  function switchEpisode(season, episode) {
    activeSeason = season;
    activeEpisode = episode;
    params.season = String(season);
    params.episode = String(episode);
    if (ctx && ctx.params) {
      ctx.params.season = String(season);
      ctx.params.episode = String(episode);
    }

    const nextUrl = playerUrl({ type: 'tv', id: params.id, season, episode });
    const iframe = root.querySelector('.watch-frame iframe');
    if (iframe) iframe.src = nextUrl;

    const streamInput = root.querySelector('#stream-url-input');
    if (streamInput) streamInput.value = nextUrl;

    // Update kicker and document title
    const kicker = root.querySelector('.watch-kicker');
    if (kicker) {
      kicker.innerHTML = `مسلسل <span class="dot" aria-hidden="true">•</span> الموسم ${season} — الحلقة ${episode}`;
    }
    updateDocTitle(params.title, 'tv', season, episode);

    // Update active state in grid
    root.querySelectorAll('#watch-episodes-grid [data-ep]').forEach((b) => {
      b.classList.toggle('is-active', Number(b.getAttribute('data-ep')) === episode);
    });

    // Update badge in nav
    const epBadge = root.querySelector('.badge-current-ep');
    if (epBadge) {
      epBadge.textContent = `الموسم ${season} — الحلقة ${episode}`;
    }

    // Update jump inputs
    const sInput = root.querySelector('#jump-season');
    const epInput = root.querySelector('#jump-episode');
    if (sInput) sInput.value = season;
    if (epInput) epInput.value = episode;

    // Update route query without reloading
    navigate(
      {
        name: 'watch',
        type: 'tv',
        id: params.id,
        title: params.title,
        season: String(season),
        episode: String(episode)
      },
      { replace: true }
    );
  }
}

function updateDocTitle(title, media, season, episode) {
  if (!title) return;
  if (media === 'tv') {
    document.title = `${title} (م ${season} ح ${episode}) — مشاهدة — hwto.kurd`;
  } else {
    document.title = `${title} — مشاهدة — hwto.kurd`;
  }
}

/**
 * Same page, new season/episode in the query — swap the player in place
 * instead of re-mounting, but fully re-mount if the title or media type changed.
 */
export function onRoute(params) {
  if (!ctx) return;
  const prev = ctx.params;
  const titleChanged = prev.id !== params.id || prev.type !== params.type;
  if (titleChanged) {
    mount(params, ctx.view, { signal: ctx.signal });
    return;
  }

  const seasonChanged = String(prev.season || '') !== String(params.season || '');
  const epChanged = String(prev.episode || '') !== String(params.episode || '');

  ctx.params = params;

  if (seasonChanged || epChanged) {
    const nextUrl = playerUrl(params);
    const iframe = ctx.view.querySelector('.watch-frame iframe');
    if (iframe && iframe.getAttribute('src') !== nextUrl) iframe.src = nextUrl;

    const streamInput = ctx.view.querySelector('#stream-url-input');
    if (streamInput) streamInput.value = nextUrl;

    const media = params.type === 'tv' ? 'tv' : 'movie';
    const s = Number(params.season) || 1;
    const ep = Number(params.episode) || 1;
    updateDocTitle(params.title, media, s, ep);

    if (media === 'tv') {
      const kicker = ctx.view.querySelector('.watch-kicker');
      if (kicker) {
        kicker.innerHTML = `مسلسل <span class="dot" aria-hidden="true">•</span> الموسم ${s} — الحلقة ${ep}`;
      }

      const epBadge = ctx.view.querySelector('.badge-current-ep');
      if (epBadge) {
        epBadge.textContent = `الموسم ${s} — الحلقة ${ep}`;
      }

      const sInput = ctx.view.querySelector('#jump-season');
      const epInput = ctx.view.querySelector('#jump-episode');
      if (sInput) sInput.value = String(s);
      if (epInput) epInput.value = String(ep);

      ctx.view.querySelectorAll('[data-season-tab]').forEach((t) => {
        const isCur = Number(t.getAttribute('data-season-tab')) === s;
        t.classList.toggle('is-active', isCur);
        t.setAttribute('aria-selected', isCur ? 'true' : 'false');
      });

      const sStructure = getTvSeriesStructure(params.id, s);
      const label = ctx.view.querySelector('#active-season-label');
      const count = ctx.view.querySelector('#active-season-count');
      if (label) label.textContent = String(s);
      if (count) count.textContent = String(sStructure.episodes.length);

      const grid = ctx.view.querySelector('#watch-episodes-grid');
      if (grid) {
        grid.innerHTML = sStructure.episodes
          .map(
            (episodeNum) => `
            <button
              class="btn-watch-ep ${episodeNum === ep ? 'is-active' : ''}"
              type="button"
              data-ep="${episodeNum}">
              <span class="ep-num">${episodeNum}</span>
              <span class="ep-text">الحلقة ${episodeNum}</span>
            </button>`
          )
          .join('');
        grid.querySelectorAll('[data-ep]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const chosenEp = Number(btn.getAttribute('data-ep'));
            if (!chosenEp) return;
            navigate(
              buildHash({
                name: 'watch',
                type: 'tv',
                id: params.id,
                title: params.title,
                season: String(s),
                episode: String(chosenEp)
              }),
              { replace: true }
            );
          });
        });
      }
    }
  }
}

/** Only go back inside this app — a deep link has no previous entry. */
function wireBack(root) {
  const buttons = root.matches && root.matches('[data-back]') ? [root] : [...root.querySelectorAll('[data-back]')];
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const prev = previousHash();
      if (prev && prev !== location.hash && history.length > 1) history.back();
      else navigate('#/');
    });
  });
}
