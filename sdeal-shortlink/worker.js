/**
 * Cloudflare Worker — Shortlink handler cho sdeal.vn
 * - Check KV cache trước
 * - Miss: đọc Firestore REST → fetch OG → cache KV 24h
 * - Bypass hoàn toàn Vercel cho shortlink 10 ký tự
 */

const SHORTLINK_TTL = 60 * 60 * 24 * 60; // 60 ngày (giây)
const CODE_RE = /^[A-Za-z0-9]{10}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const code = url.pathname.slice(1).split('/')[0]; // lấy segment đầu

    // Không phải shortlink → forward sang Vercel như bình thường
    if (!CODE_RE.test(code)) {
      return fetch(request);
    }

    // ── 1. Check KV cache ──────────────────────────────────
    try {
      const cached = await env.SHORTLINKS_CACHE.get(code, { type: 'json' });
      if (cached?.targetUrl) {
        // Tăng clicks bất đồng bộ (không chờ)
        incrementClicks(code, env).catch(() => {});
        return buildHtml(cached.targetUrl, cached.ogTitle, cached.ogDesc, cached.ogImage);
      }
    } catch (_) {}

    // ── 2. Cache miss: đọc Firestore REST ─────────────────
    const projectId = env.FIREBASE_PROJECT_ID;
    if (!projectId) return Response.redirect('https://sdeal.vn/', 302);

    const docUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/shortlinks/${code}`;

    let targetUrl;
    try {
      const res = await fetch(docUrl, { cf: { cacheEverything: false } });
      if (!res.ok) return Response.redirect('https://sdeal.vn/', 302);
      const data = await res.json();
      targetUrl = data?.fields?.url?.stringValue;
    } catch (_) {
      return Response.redirect('https://sdeal.vn/', 302);
    }

    if (!targetUrl) return Response.redirect('https://sdeal.vn/', 302);

    // ── 3. Fetch OG tags từ trang đích ────────────────────
    let ogTitle = 'Sdeal.vn – Hoàn tiền Shopee';
    let ogDesc  = 'Mua sắm qua link Sandeal để nhận hoàn tiền từ Shopee. Đăng ký miễn phí!';
    let ogImage = '';

    try {
      const pageRes = await fetch(targetUrl, {
        headers: { 'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' },
        signal: AbortSignal.timeout(3000),
      });
      // Meta OG luôn nằm gần đầu <head> — chỉ quét 50KB đầu, tránh regex chạy trên
      // toàn bộ HTML (có thể vài trăm KB-vài MB với trang SPA) vượt giới hạn CPU
      // 10ms/request của Workers free plan.
      const html = (await pageRes.text()).slice(0, 50_000);
      const getMeta = (prop) => {
        const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
               || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'));
        return m ? m[1] : '';
      };
      ogTitle = getMeta('og:title') || getMeta('twitter:title') || ogTitle;
      ogDesc  = getMeta('og:description') || getMeta('twitter:description') || ogDesc;
      ogImage = getMeta('og:image') || getMeta('twitter:image') || ogImage;
    } catch (_) {}

    // ── 4. Lưu vào KV (TTL 24h) ───────────────────────────
    try {
      await env.SHORTLINKS_CACHE.put(code, JSON.stringify({ targetUrl, ogTitle, ogDesc, ogImage }), {
        expirationTtl: SHORTLINK_TTL,
      });
    } catch (_) {}

    // ── 5. Tăng clicks ────────────────────────────────────
    incrementClicks(code, env).catch(() => {});

    return buildHtml(targetUrl, ogTitle, ogDesc, ogImage);
  },
};

// ── Helpers ───────────────────────────────────────────────

function buildHtml(targetUrl, ogTitle, ogDesc, ogImage) {
  const esc = (s) => (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8"/>
  <meta property="og:title" content="${esc(ogTitle)}"/>
  <meta property="og:description" content="${esc(ogDesc)}"/>
  ${ogImage ? `<meta property="og:image" content="${esc(ogImage)}"/>` : ''}
  <meta property="og:url" content="${esc(targetUrl)}"/>
  <meta property="og:type" content="website"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <title>${esc(ogTitle)}</title>
  <meta http-equiv="refresh" content="0;url=${esc(targetUrl)}"/>
  <script>window.location.replace("${esc(targetUrl)}");</script>
</head>
<body></body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      'X-Cache': 'HIT',
    },
  });
}

async function incrementClicks(code, env) {
  const projectId = env.FIREBASE_PROJECT_ID;
  const commitUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`;
  await fetch(commitUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      writes: [{
        transform: {
          document: `projects/${projectId}/databases/(default)/documents/shortlinks/${code}`,
          fieldTransforms: [{ fieldPath: 'clicks', increment: { integerValue: '1' } }],
        },
      }],
    }),
  });
}
