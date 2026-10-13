const video = document.getElementById('player');
const statusEl = document.getElementById('status');
const srcInput = document.getElementById('src');
const playBtn = document.getElementById('play');
let hls = null;

const proxy = (streamUrl, refererUrl) => {
  const ref = refererUrl || streamUrl;
  return '/api/fastvid?url=' + encodeURIComponent(streamUrl) + '&from=' + encodeURIComponent(ref);
};

function playStream(m3u8Url, embedPageUrl) {
  if (hls) { hls.destroy(); hls = null; }
  statusEl.textContent = 'جارٍ تحميل الفيديو عبر البروكسي…';

  const proxied = proxy(m3u8Url, embedPageUrl);

  if (window.Hls && Hls.isSupported()) {
    hls = new Hls();
    hls.loadSource(proxied);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      statusEl.textContent = 'تم تحميل البث بنجاح — الفيديو يعمل الآن!';
      video.play().catch(() => {});
    });

    hls.on(Hls.Events.ERROR, (_event, data) => {
      statusEl.textContent = 'خطأ HLS: ' + data.type + ' / ' + data.details;
      if (data.fatal) {
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else hls.destroy();
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = proxied;
    statusEl.textContent = 'تشغيل أصلي (Safari/iOS).';
  } else {
    statusEl.textContent = 'هذا المتصفح لا يدعم HLS.';
  }
}

async function handleStart() {
  const rawUrl = srcInput.value.trim();
  if (!rawUrl) return;

  if (rawUrl.includes('.m3u8')) {
    playStream(rawUrl, rawUrl);
    return;
  }

  statusEl.textContent = 'جارٍ استخراج رابط البث المباشر…';
  playBtn.disabled = true;

  try {
    const res = await fetch('/api/shahid4u-extractor?url=' + encodeURIComponent(rawUrl));
    const data = await res.json();

    if (data.success && data.stream_url) {
      statusEl.textContent = 'تم الاستخراج، جاري بدء التشغيل…';
      playStream(data.stream_url, rawUrl);
    } else {
      statusEl.textContent = 'فشل الاستخراج: ' + (data.error || 'خطأ غير معروف');
    }
  } catch (err) {
    statusEl.textContent = 'تعذر الاتصال بالمستخرج: ' + err.message;
  } finally {
    playBtn.disabled = false;
  }
}

playBtn.addEventListener('click', handleStart);
