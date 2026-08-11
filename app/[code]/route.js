import { NextResponse } from 'next/server';

export async function GET(request, { params }) {
  // Đợi params trong Next.js 15+
  const { code } = await params;

  // Shortlink của bạn đang set là 10 ký tự ngẫu nhiên
  // Kiểm tra độ dài để tránh bắt nhầm các route khác hoặc file tĩnh không tồn tại
  if (!code || code.length !== 10) {
    // Nếu không phải dạng shortlink, chuyển hướng về trang chủ
    return NextResponse.redirect(new URL('/', request.url));
  }

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    return NextResponse.json({ error: "Thiếu cấu hình Firebase Project ID" }, { status: 500 });
  }

  // 1. Fetch url đích từ Firestore thông qua REST API (Rất nhẹ và siêu tốc độ)
  const docUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/shortlinks/${code}`;
  
  try {
    const res = await fetch(docUrl, { cache: 'no-store' });
    
    if (!res.ok) {
      // Nếu link không tồn tại (lỗi 404 từ Firestore), chuyển về trang chủ
      return NextResponse.redirect(new URL('/', request.url));
    }
    
    const data = await res.json();
    const targetUrl = data?.fields?.url?.stringValue;

    if (targetUrl) {
      // 2. Gửi request tăng lượt click (clicks) lên 1
      const commitUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`;

      fetch(commitUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          writes: [{
            transform: {
              document: `projects/${projectId}/databases/(default)/documents/shortlinks/${code}`,
              fieldTransforms: [{ fieldPath: "clicks", increment: { integerValue: "1" } }]
            }
          }]
        })
      }).catch(err => console.error("Lỗi cập nhật clicks:", err));

      // 3. Fetch OG tags từ trang đích để proxy lại cho Zalo/Telegram
      let ogTitle = 'Sdeal.vn – Hoàn tiền Shopee';
      let ogDesc = 'Mua sắm qua link Sandeal để nhận hoàn tiền từ Shopee. Đăng ký miễn phí!';
      let ogImage = '';

      try {
        const pageRes = await fetch(targetUrl, {
          headers: { 'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' },
          signal: AbortSignal.timeout(3000),
        });
        const html = await pageRes.text();
        const getMeta = (prop) => {
          const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
                 || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'));
          return m ? m[1] : '';
        };
        ogTitle = getMeta('og:title') || getMeta('twitter:title') || ogTitle;
        ogDesc  = getMeta('og:description') || getMeta('twitter:description') || ogDesc;
        ogImage = getMeta('og:image') || getMeta('twitter:image') || ogImage;
      } catch (_) { /* fallback to defaults */ }

      const escaped = targetUrl.replace(/"/g, '&quot;');
      const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8"/>
  <meta property="og:title" content="${ogTitle.replace(/"/g, '&quot;')}"/>
  <meta property="og:description" content="${ogDesc.replace(/"/g, '&quot;')}"/>
  ${ogImage ? `<meta property="og:image" content="${ogImage.replace(/"/g, '&quot;')}"/>` : ''}
  <meta property="og:url" content="${escaped}"/>
  <meta property="og:type" content="website"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <title>${ogTitle.replace(/</g, '&lt;')}</title>
  <meta http-equiv="refresh" content="0;url=${escaped}"/>
  <script>window.location.replace("${escaped}");</script>
</head>
<body></body>
</html>`;

      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=60',
        },
      });
    }
  } catch (error) {
    console.error("Lỗi API Shortlink:", error);
  }

  // Fallback về trang chủ nếu xảy ra lỗi không xác định
  return NextResponse.redirect(new URL('/', request.url));
}
