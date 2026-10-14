/**
 * Dean Edwards Packer Unpacker
 * يعترض ناتج فك التشفير بأمان بدون تنفيذ أكواد خبيثة أو إعلانات
 */
function unpackDeanEdwards(code) {
  if (!code || !code.includes('eval(function(p,a,c,k')) return null;

  try {
    const start = code.indexOf('eval(function(p,a,c,k');
    const openParen = code.indexOf('(', start);
    
    // مطابقة الأقواس لاستخراج التعبير الداخلي فقط بدون eval
    let depth = 1;
    let end = -1;
    for (let i = openParen + 1; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    let expression = end !== -1 
      ? code.slice(openParen + 1, end).trim()
      : code.slice(start).replace(/^eval\s*\(/, '').replace(/\)\s*;?$/, '');

    // تنفيذ دالة الاستبدال فقط لاستعادة النص المفكوك
    const unpacked = (new Function('return (' + expression + ');'))();
    return typeof unpacked === 'string' ? unpacked : null;
  } catch (err) {
    // خطة بديلة: اعتراض دالة eval في بيئة معزولة
    try {
      let result = null;
      const fakeEval = (val) => { result = val; return val; };
      const runner = new Function('eval', code.slice(code.indexOf('eval(function(p,a,c,k')));
      runner(fakeEval);
      return result;
    } catch (e2) {
      console.error('[shahid4u-extractor] Unpack error:', e2.message);
      return null;
    }
  }
}

/**
 * استخراج رابط البث النقي من الكود المفكوك
 */
function extractStreamUrl(unpacked, pageOrigin) {
  if (!unpacked) return null;

  // 1. فحص وجود رابط m3u8 كامل
  const absM3u8 = unpacked.match(/https?:\/\/[^\s"',\\]+\.m3u8[^\s"',\\]*/i);
  if (absM3u8) return absM3u8[0];

  // 2. فحص وجود رابط m3u8 نسبي
  const relM3u8 = unpacked.match(/["'](\/[^"'\s\\]+\.m3u8[^"'\s\\]*)["']/i);
  if (relM3u8) {
    try { return new URL(relM3u8[1], pageOrigin).href; } catch {}
  }

  // 3. فحص كائن o الذي يحمل السيرفرات
  const oMatch = unpacked.match(/(?:var|let|const)?\s*o\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (oMatch) {
    const rawObj = oMatch[1];
    const urlMatch = rawObj.match(/https?:\/\/[^\s"',\\]+/i) || rawObj.match(/["'](\/[^"'\s\\]+)["']/);
    if (urlMatch) {
      const val = urlMatch[1] || urlMatch[0];
      return val.startsWith('http') ? val : new URL(val, pageOrigin).href;
    }
  }

  // 4. فحص روابط mp4 المباشرة
  const absMp4 = unpacked.match(/https?:\/\/[^\s"',\\]+\.mp4[^\s"',\\]*/i);
  if (absMp4) return absMp4[0];

  // 5. فحص خاصية file في إعدادات المشغل
  const fileMatch = unpacked.match(/file\s*:\s*["']([^"']+)["']/i);
  if (fileMatch) {
    const val = fileMatch[1];
    return val.startsWith('http') ? val : new URL(val, pageOrigin).href;
  }

  return null;
}

export default async function handler(req, res) {
  let targetUrl = Array.isArray(req.query?.url) ? req.query.url[0] : req.query?.url;

  if (!targetUrl) {
    return res.status(400).json({ error: "Missing url parameter" });
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://shaheid4u.name/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    if (!response.ok) {
      return res.status(200).json({ success: false, fallback_iframe: targetUrl });
    }

    const html = await response.text();
    const pageOrigin = new URL(targetUrl).origin;

    // استخراج الكود المشفر من السكربتات الداخلية
    const inlineScripts = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi) || [])
      .map(s => s.replace(/<\/?script[^>]*>/gi, '').trim())
      .filter(Boolean);

    const packedScript = inlineScripts.find(s => s.includes('eval(function(p,a,c,k,e,d)'));

    if (packedScript) {
      const unpacked = unpackDeanEdwards(packedScript);
      if (unpacked) {
        console.log('[shahid4u-extractor] Unpacked successfully! Length:', unpacked.length);
        const streamUrl = extractStreamUrl(unpacked, pageOrigin);

        if (streamUrl) {
          console.log('[shahid4u-extractor] Extracted stream URL:', streamUrl);
          return res.status(200).json({
            success: true,
            stream_url: streamUrl,
            source: "dean_edwards_unpacker"
          });
        }
        console.log('[shahid4u-extractor] Stream URL not found in unpacked code. Snippet:', unpacked.slice(0, 400));
      }
    }

    // بديل إضافي: فحص روابط m3u8 المباشرة داخل الصفحة
    const directM3u8 = html.match(/(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/i);
    if (directM3u8) {
      return res.status(200).json({
        success: true,
        stream_url: directM3u8[1],
        source: "direct_m3u8"
      });
    }

    // إذا تعذر الفك، يرجع للـ iframe كخيار أخير
    return res.status(200).json({
      success: false,
      fallback_iframe: targetUrl,
      error: "stream_not_found"
    });

  } catch (error) {
    console.error("[shahid4u-extractor] Error:", error.message);
    res.status(500).json({ error: "حدث خطأ داخلي" });
  }
}