/**
 * pages/home.js — landing view: hero, library stats and the main rails.
 */

import { api } from '../api.js';
import * as ui from '../ui.js';
import { remember, rememberMany } from '../store.js';
import { heroImage } from '../utils.js';

const isAbort = (err) => Boolean(err && err.name === 'AbortError');

export async function mount(_params, view, { signal }) {
  view.innerHTML = ui.skeletonHero() + `<div class="container">${ui.skeletonSections(3)}</div>`;
  ui.hydrate(view);

  let stats = null;
  let trending;
  let upcoming;
  let topRated;
  let site;

  try {
    [stats, trending, upcoming, topRated, site] = await Promise.all([
      api.getStats({ signal }),
      api.getTrending({ signal }),
      api.getUpcoming({ signal }),
      api.getTopRated({ type: 'movie', signal }),
      api.getMyContent({ limit: 20, signal })
    ]);
  } catch (err) {
    if (isAbort(err)) return;
    view.innerHTML = ui.errorState(err && err.message, { onRetry: true, retryId: 'home-retry' });
    const btn = view.querySelector('#home-retry');
    if (btn) btn.addEventListener('click', () => window.dispatchEvent(new CustomEvent('app:reload')));
    return;
  }

  const trendingAll = trending.items;
  rememberMany('movie', trendingAll.filter((i) => i.mediaType === 'movie'));
  rememberMany('tv', trendingAll.filter((i) => i.mediaType === 'tv'));
  rememberMany('movie', upcoming.items);
  rememberMany('movie', topRated.items);
  rememberMany('movie', site.items.filter((i) => i.mediaType === 'movie'));
  rememberMany('tv', site.items.filter((i) => i.mediaType === 'tv'));

  const trendingMovies = trendingAll.filter((i) => i.mediaType === 'movie');
  const trendingTv = trendingAll.filter((i) => i.mediaType === 'tv');
  const heroItem = trendingMovies[0] || trendingTv[0] || trendingAll[0] || upcoming.items[0];

  const siteMovies = site.items.filter((i) => i.mediaType === 'movie');
  const siteTv = site.items.filter((i) => i.mediaType === 'tv');

  const parts = [];

  if (heroItem) {
    // Missing artwork must never replace the kicker with an error message.
    const kicker = heroImage(heroItem)
      ? 'الأكثر رواجاً الآن'
      : 'الأكثر رواجاً الآن — صورة الغلاف غير متوفرة';
    parts.push(ui.hero(heroItem, { kicker }));
  }

  parts.push(ui.statsBar(stats));

  parts.push(`
    <div class="container sections" id="sections">
      ${ui.section('الأكثر رواجاً الآن', trendingAll, {
        href: '#/trending/movie',
        subtitle: 'مزيج من الأفلام والمسلسلات الأعلى تداولاً',
        card: { showRank: true }
      })}
      ${ui.section('قريباً في الصالات', upcoming.items, {
        href: '#/upcoming',
        subtitle: 'أفلام لم تُعرض بعد',
        card: {}
      })}
      ${ui.section('الأعلى تقييماً — أفلام', topRated.items, {
        href: '#/toprated/movie',
        subtitle: 'حسب تقييم الجمهور على TMDB'
      })}
      ${ui.section('مكتبة الموقع — أفلام', siteMovies, { href: '#/site/movie', subtitle: 'محتوى محفوظ في قاعدة بيانات الموقع' })}
      ${ui.section('مكتبة الموقع — مسلسلات', siteTv, { href: '#/site/tv', subtitle: 'محتوى محفوظ في قاعدة بيانات الموقع' })}
      ${ui.section('الأكثر رواجاً — مسلسلات', trendingTv, { href: '#/trending/tv' })}
    </div>`);

  if (!parts.some((p) => p && p.includes('section class="section"'))) {
    parts.push(ui.emptyState('لا يوجد محتوى لعرضه في الوقت الحالي.', { title: 'المكتبة فارغة' }));
  }

  view.innerHTML = parts.join('');
  ui.hydrate(view);

  const scrollBtn = view.querySelector('[data-scroll-to="sections"]');
  if (scrollBtn) {
    scrollBtn.addEventListener('click', () => {
      const target = document.getElementById('sections');
      if (target) target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    });
  }

  animateCounts(view);
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function animateCounts(root) {
  const nodes = root.querySelectorAll('[data-count]');
  if (!nodes.length) return;

  const settle = () => {
    nodes.forEach((n) => {
      const target = Number(n.getAttribute('data-count'));
      if (Number.isFinite(target)) n.textContent = String(target);
    });
  };

  // Honour prefers-reduced-motion: show the final numbers, no animation.
  if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
    settle();
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        const el = entry.target;
        const target = Number(el.getAttribute('data-count'));
        if (!Number.isFinite(target)) continue;
        const started = performance.now();
        const dur = 900;
        const tick = (now) => {
          // The view may have been replaced mid-animation — stop writing.
          if (!el.isConnected) return;
          const t = Math.min(1, (now - started) / dur);
          const eased = 1 - Math.pow(1 - t, 3);
          el.textContent = String(Math.round(target * eased));
          if (t < 1) requestAnimationFrame(tick);
          else el.textContent = String(target);
        };
        requestAnimationFrame(tick);
      }
    },
    { threshold: 0.4 }
  );
  nodes.forEach((n) => io.observe(n));
}
