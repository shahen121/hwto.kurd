const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function testGate() {
  // تشفير الرابط لضمان قبوله داخل ترويسات HTTP
  const rawWatchUrl = 'https://sshaahid4u.net/watch/فيلم-the-great-flood-2025-مترجم';
  const watchUrl = encodeURI(rawWatchUrl);

  console.log('1. جلب صفحة المشاهدة واستخراج الجلسة...');

  const pageRes = await fetch(watchUrl, {
    headers: {
      'User-Agent': BROWSER_UA,
      'Referer': 'https://shaheid4u.name/'
    }
  });

  const cookies = pageRes.headers.getSetCookie ? pageRes.headers.getSetCookie() : [pageRes.headers.get('set-cookie')];
  const cookieHeader = cookies.filter(Boolean).map(c => c.split(';')[0]).join('; ');
  console.log('الكوكيز المستخرجة:', cookieHeader ? 'تم بنجاح' : 'لم يتم العثور عليها');

  const html = await pageRes.text();
  const m = /(?:let|const|var)\s+servers\s*=\s*(\[[\s\S]*?\])\s*;?/.exec(html);
  if (!m) return console.log('لم يتم العثور على مصفوفة السيرفرات');

  let servers = JSON.parse(m[1].replace(/,\s*([\]}])/g, '$1').replace(/'/g, '"'));
  const firstServer = servers[0];
  console.log('السيرفر الأول:', firstServer);

  const gateUrl = new URL(firstServer.url, 'https://sshaahid4u.net').href;
  console.log('2. فحص رابط البوابة مع الكوكي:', gateUrl);

  const gateRes = await fetch(gateUrl, {
    headers: {
      'User-Agent': BROWSER_UA,
      'Referer': watchUrl,
      'Cookie': cookieHeader
    },
    redirect: 'manual'
  });

  console.log('كود الاستجابة:', gateRes.status);
  console.log('رابط التحويل (Location):', gateRes.headers.get('location'));

  if (gateRes.status === 200) {
    const body = await gateRes.text();
    const iframeSrc = body.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    console.log('رابط التضمين الحقيقي داخل الصفحة:', iframeSrc ? iframeSrc[1] : 'غير موجود');
  }
}

testGate();