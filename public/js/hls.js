/**
 * hls.js loader — native-HLS playback on the watch screen.
 */

let libPromise = null;

/** Inject <script src="/vendor/hls.min.js"> once; resolves with window.Hls. */
export function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (libPromise) return libPromise;

  libPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-hls-lib]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Hls));
      existing.addEventListener('error', () => reject(new Error('hls.js failed to load')));
      return;
    }
    const script = document.createElement('script');
    script.src = '/vendor/hls.min.js';
    script.async = true;
    script.dataset.hlsLib = '1';
    script.addEventListener('load', () => resolve(window.Hls));
    script.addEventListener('error', () => {
      libPromise = null;
      reject(new Error('hls.js failed to load'));
    });
    document.head.appendChild(script);
  });

  return libPromise;
}

const proxyUrl = (url, from) =>
  `/api/fastvid?url=${encodeURIComponent(url)}${from ? `&from=${encodeURIComponent(from)}` : ''}`;

/**
 * دمج وقراءة الـ Loader الافتراضي بأمان ودعم الحرف الصغير والكبير
 */
function makeProxiedLoader(Hls, from) {
  const BaseLoader = (Hls.defaultConfig || Hls.DefaultConfig || {}).loader;
  if (!BaseLoader) return null;

  return class ProxiedLoader extends BaseLoader {
    load(context, config, callbacks) {
      const url = context.url;
      const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(url);
      const isCrossOrigin = isAbsolute && !url.startsWith(window.location.origin);
      if (isCrossOrigin && !window.HWTO_HLS_DIRECT) {
        context.url = proxyUrl(url, from);
        if (context.stats) context.stats.url = context.url;
      }
      super.load(context, config, callbacks);
    }
  };
}

/**
 * تشغيل بث HLS على عنصر الفيديو مباشرة
 */
export async function attachHls(video, m3u8Url, { signal, from } = {}) {
  const Hls = await loadHls();
  if (signal && signal.aborted) return { destroy() {} };

  const source = proxyUrl(m3u8Url, from);

  if (!Hls.isSupported()) {
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = source;
      return {
        destroy() {
          video.removeAttribute('src');
          video.load();
        }
      };
    }
    throw new Error('HLS is not supported in this browser');
  }

  const customLoader = makeProxiedLoader(Hls, from);

  const hlsConfig = {
    enableWorker: false, // إيقاف الـ Worker لمنع مشاكل الـ CSP وبرامج الحماية نهائياً
    lowLatencyMode: false,
    maxBufferLength: 30
  };

  if (customLoader) {
    hlsConfig.loader = customLoader;
  }

  const hls = new Hls(hlsConfig);

  hls.loadSource(source);
  hls.attachMedia(video);

  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    video.play().catch(() => {});
  });

  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (!data || !data.fatal) return;
    console.error('[hls]', data.type, data.details, data.response && data.response.code, data.url || '');
    switch (data.type) {
      case Hls.ErrorTypes.NETWORK_ERROR:
        hls.startLoad();
        break;
      case Hls.ErrorTypes.MEDIA_ERROR:
        hls.recoverMediaError();
        break;
      default:
        hls.destroy();
        break;
    }
  });

  return {
    destroy() {
      try {
        hls.destroy();
      } catch {}
    }
  };
}
