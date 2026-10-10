/**
 * router.js — tiny hash router. Every route is parsed into a plain object so
 * pages never touch the location string themselves.
 *
 *   #/                     -> { name: 'home' }
 *   #/trending/movie       -> { name: 'list', section: 'trending', type: 'movie' }
 *   #/upcoming             -> { name: 'list', section: 'upcoming', type: 'movie' }
 *   #/toprated/tv          -> { name: 'list', section: 'toprated', type: 'tv' }
 *   #/site[/movie|/tv]     -> { name: 'list', section: 'site', type: ''|movie|tv }
 *   #/category/anime       -> { name: 'list', section: 'category', category: 'anime' }
 *                             slugs: anime | series | movies | asian | turkish
 *   #/search?q=batman      -> { name: 'search', q: 'batman', type: ''|movie|tv }
 *   #/movie/278            -> { name: 'details', type: 'movie', id: 278 }
 *   #/tv/1396              -> { name: 'details', type: 'tv', id: 1396 }
 *   #/watch/movie/278?title=..  -> { name: 'watch', type: 'movie', id: 278, title }
 *   #/watch/tv/1396?title=..&season=1&episode=1  -> TV with season/episode
 *
 * `watch.id` is the TMDB id — the same id used by the API. vidcore.io uses
 * this id directly: https://vidcore.io/movie/{id} or /tv/{id}/{season}/{ep}.
 */

import { CATEGORY_SLUGS } from './config.js';

const ROUTES = [
  { re: /^\/?$/, make: () => ({ name: 'home' }) },
  { re: /^\/trending\/(movie|tv)\/?$/, make: (m) => ({ name: 'list', section: 'trending', type: m[1] }) },
  { re: /^\/upcoming\/?$/, make: () => ({ name: 'list', section: 'upcoming', type: 'movie' }) },
  { re: /^\/toprated\/(movie|tv)\/?$/, make: (m) => ({ name: 'list', section: 'toprated', type: m[1] }) },
  { re: /^\/site(?:\/(movie|tv))?\/?$/, make: (m) => ({ name: 'list', section: 'site', type: m[1] || '' }) },
  {
    re: /^\/category\/(anime|series|movies|asian|turkish)\/?$/,
    make: (m) => ({ name: 'list', section: 'category', category: m[1], type: '' })
  },
  { re: /^\/search\/?$/, make: () => ({ name: 'search', q: '', type: '', page: 1 }) },
  { re: /^\/watch\/tv\/(\d+)\/(\d+)\/(\d+)\/?$/, make: (m) => ({ name: 'watch', type: 'tv', id: Number(m[1]), season: m[2], episode: m[3] }) },
  { re: /^\/watch\/(movie|tv)\/(\d+)\/?$/, make: (m) => ({ name: 'watch', type: m[1], id: Number(m[2]) }) },
  { re: /^\/(movie|tv)\/(\d+)\/?$/, make: (m) => ({ name: 'details', type: m[1], id: Number(m[2]) }) }
];

export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  const qIndex = raw.indexOf('?');
  const path = qIndex === -1 ? raw : raw.slice(0, qIndex);
  const query = new URLSearchParams(qIndex === -1 ? '' : raw.slice(qIndex + 1));

  for (const route of ROUTES) {
    const m = path.match(route.re);
    if (!m) continue;
    const params = route.make(m);
    if (params.name === 'search') {
      params.q = query.get('q') || '';
      params.type = ['movie', 'tv'].includes(query.get('type')) ? query.get('type') : '';
      params.page = Math.max(1, Number(query.get('page')) || 1);
    }
    if (params.name === 'watch') {
      params.title = query.get('title') || params.title || '';
      params.season = query.get('season') || params.season || '';
      params.episode = query.get('episode') || params.episode || '';
    }
    return params;
  }
  return { name: 'notfound', path };
}

export function buildHash(params) {
  if (!params || params.name === 'home') return '#/';
  switch (params.name) {
    case 'list': {
      if (params.section === 'upcoming') return '#/upcoming';
      if (params.section === 'trending') return `#/trending/${params.type || 'movie'}`;
      if (params.section === 'toprated') return `#/toprated/${params.type || 'movie'}`;
      if (params.section === 'site') return params.type ? `#/site/${params.type}` : '#/site';
      if (params.section === 'category') {
        return `#/category/${CATEGORY_SLUGS.includes(params.category) ? params.category : CATEGORY_SLUGS[0]}`;
      }
      return '#/';
    }
    case 'search': {
      const q = new URLSearchParams();
      if (params.q) q.set('q', params.q);
      if (params.type) q.set('type', params.type);
      if (params.page && params.page > 1) q.set('page', params.page);
      const s = q.toString();
      return s ? `#/search?${s}` : '#/search';
    }
    case 'details':
      return `#/${params.type === 'tv' ? 'tv' : 'movie'}/${params.id}`;
    case 'watch': {
      const q = new URLSearchParams();
      if (params.title) q.set('title', params.title);
      if (params.season) q.set('season', params.season);
      if (params.episode) q.set('episode', params.episode);
      const s = q.toString();
      const media = params.type === 'tv' ? 'tv' : 'movie';
      return `#/watch/${media}/${params.id}${s ? `?${s}` : ''}`;
    }
    default:
      return '#/';
  }
}

export function navigate(params, { replace = false } = {}) {
  const next = typeof params === 'string' ? params : buildHash(params);
  if (location.hash === next) {
    // Same route — force a re-render by dispatching manually.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    return;
  }
  if (replace) {
    const url = `${location.pathname}${location.search}${next}`;
    history.replaceState(null, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = next;
  }
}

let previous = '';

/**
 * The hash we were on before the current one — '' when the app was opened
 * directly on this URL (deep link), so callers like the detail page's back
 * button can fall back to the home instead of leaving the site.
 */
export function previousHash() {
  return previous;
}

export function startRouter(onChange) {
  let last = '';

  const handle = () => {
    const hash = location.hash;
    // Anchors that are not routes (the skip link points at #app-view) must
    // never replace the current view — the browser still moves focus itself.
    if (hash && !hash.startsWith('#/')) return;
    previous = last;
    last = hash || '#/';
    onChange(parseHash(hash));
  };

  window.addEventListener('hashchange', handle);
  if (!location.hash || !location.hash.startsWith('#/')) {
    history.replaceState(null, '', `${location.pathname}${location.search}#/`);
  }
  handle();
  return () => window.removeEventListener('hashchange', handle);
}
