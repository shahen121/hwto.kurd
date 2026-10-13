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

        console.log(`[shahid4u-extractor] Fetch status for ${targetUrl}: ${response.status}`);

        if (!response.ok) {
            return res.status(200).json({
                success: false,
                fallback_iframe: targetUrl,
                error: `Origin returned ${response.status}`
            });
        }

        const html = await response.text();

        // 1. فحص نمط التشفير القديم
        const regex = /\|(\d{7,9})\|(\d{10})\|([a-zA-Z0-9_]+)\|([a-zA-Z0-9_\-]+)\|/;
        const match = html.match(regex);

        if (match) {
            const id = match[1];
            const timestamp = match[2];
            const path = match[3];
            const token = match[4];

            const domain = new URL(targetUrl).origin;
            const rawM3u8 = `${domain}/stream/${token}/${path}/${timestamp}/${id}/master.m3u8`;

            return res.status(200).json({
                success: true,
                stream_url: rawM3u8,
                source: "regex_decoder"
            });
        }

        // 2. فحص وجود رابط m3u8 مباشر داخل الصفحة
        const directM3u8 = html.match(/(https?:\/\/[^"']+\.m3u8[^"']*)/i);
        if (directM3u8) {
            return res.status(200).json({
                success: true,
                stream_url: directM3u8[1],
                source: "direct_m3u8"
            });
        }

        console.log("[shahid4u-extractor] Stream pattern not matched. Snippet:", html.slice(0, 300));

        // 3. بديل أمان: إرجاع الرابط كـ iframe بدلاً من 404
        return res.status(200).json({
            success: false,
            fallback_iframe: targetUrl,
            error: "pattern_not_found"
        });

    } catch (error) {
        console.error("[shahid4u-extractor] Error:", error.message);
        res.status(500).json({ error: "حدث خطأ داخلي أثناء الاستخراج" });
    }
}
