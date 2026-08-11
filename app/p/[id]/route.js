import { NextResponse } from 'next/server';

export async function GET(request, { params }) {
  const { id } = await params;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const origin = new URL(request.url).origin;

  let title = 'Sdeal.vn';
  let description = 'App săn deal ngon và mua sắm hoàn tiền Shopee dành cho mọi người';
  let image = `${origin}/headerbanner.png`;
  let content = '';
  let senderName = '';
  let senderAvatar = '';
  let images = [];
  let link = '';

  try {
    const docUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/posts/${id}`;
    const res = await fetch(docUrl, { cache: 'no-store' });
    if (res.status === 404 || res.status === 403) {
      return new NextResponse(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Deal đã hết hạn</title></head><body style="font-family:system-ui;background:#f0f2f5;min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0;padding:20px;box-sizing:border-box"><div style="background:#fff;border-radius:16px;padding:40px 32px;text-align:center;max-width:400px;width:100%;box-shadow:0 2px 12px rgba(0,0,0,0.08)"><div style="font-size:64px;margin-bottom:20px">⏰</div><h2 style="font-size:22px;font-weight:700;color:#1c1e21;margin:0 0 12px">Deal đã hết hạn bạn nhé!</h2><p style="font-size:16px;color:#65676b;margin:0">Chuyển về trang chủ sau <span id="t" style="font-weight:700;color:#EE4D2D">5</span> giây để săn deal mới.</p></div><script>var s=5;var i=setInterval(function(){s--;document.getElementById('t').textContent=s;if(s<=0){clearInterval(i);window.location.href='/';}},1000);</script></body></html>`, {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }
    if (res.ok) {
      const data = await res.json();
      const f = data.fields || {};

      content = f.content?.stringValue || '';
      senderName = f.senderName?.stringValue || '';
      senderAvatar = f.senderAvatar?.stringValue || '';
      images = f.images?.arrayValue?.values?.map(v => v.stringValue) || [];
      link = f.link?.stringValue || '';

      if (senderName) title = `${senderName} – Sdeal.vn`;
      if (content) description = content.split('\n').filter(l => l.trim()).slice(0, 2).join(' ').slice(0, 200);

      if (images.length > 0) {
        image = images[0];
      } else if (link) {
        try {
          const pageRes = await fetch(link, {
            headers: { 'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' },
            signal: AbortSignal.timeout(3000),
          });
          // Meta OG luôn nằm gần đầu <head> — chỉ quét 50KB đầu, tránh regex chạy trên
          // toàn bộ HTML (có thể vài trăm KB-vài MB với trang SPA), vừa tốn CPU vừa
          // không cần thiết.
          const html = (await pageRes.text()).slice(0, 50_000);
          const m = html.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                 || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i);
          if (m) image = m[1];
        } catch (_) {}
      }
    }
  } catch (_) {}

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const pageUrl = `${origin}/p/${id}`;

  // Mã giảm giá: cụm ký tự chữ/số dài ≥7 (đếm cả số xen giữa, VD: UNICT4T, ELENAFFT8)
  // và có ít nhất 3 chữ cái viết hoa → in đậm cả cụm. Không yêu cầu chữ hoa phải liền nhau
  // tuyệt đối, chỉ cần đủ tổng độ dài và đủ tín hiệu "trông giống mã" (≥3 chữ hoa).
  // Riêng mã đứng ngay sau chữ "mã" (có hoặc không kèm dấu ":" / ".") thì luôn in đậm
  // dù ngắn hơn (VD: mã AFF225, mã: AFFERW, mã. AFFERW) — nhưng bắt buộc có ít nhất
  // 3 chữ cái viết hoa VÀ cụm phải có ít nhất 5 ký tự chữ/số trở lên, để không dính vào
  // số thuần như "mã 30" hay từ tiếng Việt viết hoa như "mã NGON", "mã SIÊU".
  // Cả 2 trường hợp đều bắt buộc token là 1 cụm liền không có khoảng trắng (kết thúc ở
  // khoảng trắng), và riêng "mã" phải có khoảng trắng ngay sau để tránh dính "mãi", "mãnh"...
  // Cụm có lẫn cả chữ hoa và chữ thường (VD: IPhone14Pro) thì bỏ qua, không bold.
  const boldCodes = (s) => {
    let result = s.replace(/\S+/g, (token) => {
      const upperCount = (token.match(/[A-Z]/g) || []).length;
      const lowerCount = (token.match(/[a-z]/g) || []).length;
      const alnumCount = (token.match(/[A-Za-z0-9]/g) || []).length;
      return (alnumCount >= 7 && upperCount >= 3 && lowerCount === 0) ? `<b>${token}</b>` : token;
    });
    result = result.replace(/(mã[:.]?\s+)(\S+)/giu, (m, prefix, code) => {
      if (/^<b>.*<\/b>$/.test(code)) return m;
      const upperCount = (code.match(/[A-Z]/g) || []).length;
      const lowerCount = (code.match(/[a-z]/g) || []).length;
      const alnumCount = (code.match(/[A-Za-z0-9]/g) || []).length;
      return (upperCount >= 3 && alnumCount >= 5 && lowerCount === 0) ? `${prefix}<b>${code}</b>` : m;
    });
    return result;
  };

  // Render content với auto-link URL
  function renderContent(text) {
    if (!text) return '';
    // Emoji trỏ tay (👉) đứng riêng dòng rồi mới tới link -> gộp cùng dòng, sát nhau.
    const normalized = text
      .replace(/(👉)[ \t]*\n+[ \t]*(?=https?:\/\/)/gu, '$1')
      .replace(/\n{3,}/g, '\n\n').trim();
    const parts = normalized.split(/(https?:\/\/[^\s]+)/g);
    const html = parts.map(part =>
      /^https?:\/\//.test(part)
        ? `<a href="${part.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer" style="color:#0068ff;overflow-wrap:anywhere;word-break:break-word">${esc(part)}</a>`
        : boldCodes(esc(part))
    ).join('');
    return html.split('\n').map(line =>
      line.trim() === '' ? '<p style="margin:2px 0"></p>' : `<p style="margin:1px 0">${line}</p>`
    ).join('');
  }
  const contentHtml = renderContent(content);

  // URL đầu tiên để gán vào nút Mua ngay
  const firstUrl = link || (content.match(/https?:\/\/[^\s]+/) || [])[0] || null;

  // Images grid
  const cols = images.length === 1 ? '1fr' : images.length === 2 ? '1fr 1fr' : '1fr 1fr 1fr';
  const imagesHtml = images.length > 0
    ? `<div style="display:grid;grid-template-columns:${cols};gap:2px;margin-top:8px">
        ${images.slice(0, 9).map((img, i) => `
          <div style="overflow:hidden">
            <img src="${esc(img)}" onclick="openLb(${i})" style="width:100%;display:block;cursor:zoom-in" />
            ${i===8 && images.length>9 ? `<div style="position:absolute;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;font-weight:700">+${images.length-9}</div>` : ''}
          </div>`).join('')}
       </div>`
    : '';

  const linkHtml = link
    ? `<div style="margin:8px 16px;background:#f0f2f5;border-radius:8px;border:1px solid #e0e0e0">
        <a href="${link.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer" style="display:block;padding:10px 14px;font-size:14px;color:#0068ff;font-weight:600;text-decoration:none;word-break:break-all">🔗 ${esc(link)}</a>
       </div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta property="og:title" content="${esc(title)}"/>
  <meta property="og:description" content="${esc(description)}"/>
  <meta property="og:image" content="${esc(image)}"/>
  <meta property="og:url" content="${esc(pageUrl)}"/>
  <meta property="og:type" content="article"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <title>${esc(title)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#f0f2f5;font-family:system-ui,-apple-system,sans-serif}
    .wrap{max-width:680px;margin:0 auto;padding:12px 8px}
    .card{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)}
    .header{padding:14px 16px 10px;display:flex;align-items:center;gap:10px}
    .avatar{width:40px;height:40px;border-radius:50%;object-fit:cover}
    .name{font-weight:700;font-size:14px;color:#1c1e21;flex:1}
    #btn-delete{display:none;background:none;border:none;cursor:pointer;padding:4px 6px;color:#e53935;flex-shrink:0}
    .content{padding:0 16px 8px;font-size:16px;color:#1c1e21;line-height:1.5}
    .content p{margin:1px 0}
    .btns{position:sticky;bottom:0;display:flex;z-index:100;box-shadow:0 -2px 8px rgba(0,0,0,0.12)}
    .btns a{flex:1;text-align:center;padding:14px 12px;font-weight:700;font-size:15px;text-decoration:none}
    .back{background:#0068ff;color:#fff}
    .buy{background:#EE4D2D;color:#fff}
    .img-thumb{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top;cursor:zoom-in}
    #lightbox{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:1000;align-items:center;justify-content:center}
    #lightbox.open{display:flex}
    #lightbox img{max-width:90vw;max-height:90vh;object-fit:contain;border-radius:8px;user-select:none}
    .lb-btn{position:absolute;background:rgba(255,255,255,0.2);border:none;color:#fff;border-radius:50%;cursor:pointer;font-size:22px;width:44px;height:44px}
    #lb-close{top:48px;right:16px;width:36px;height:36px;font-size:18px}
    #lb-prev{left:12px}
    #lb-next{right:12px}
    #lb-dots{position:absolute;bottom:20px;display:flex;gap:6px}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="header">
        <img class="avatar" src="${esc(senderAvatar || `${origin}/logo.png`)}" onerror="this.src='${origin}/logo.png'" />
        <div class="name">${esc(senderName || 'Sdeal.vn')}</div>
        <button id="btn-delete" title="Xoá bài" onclick="deletePost()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>
      <div class="content">${contentHtml}</div>
      ${linkHtml}
      ${imagesHtml}
    </div>
    <div class="btns">
      <a class="back" href="${origin}">Xem thêm Deals</a>
      ${firstUrl ? `<a class="buy" href="${firstUrl.replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer">Săn ngay</a>` : ''}
    </div>
  </div>

  <div id="lightbox" onclick="if(event.target===this)closeLb()">
    <img id="lb-img" src="" />
    <button class="lb-btn" id="lb-close" onclick="closeLb()">✕</button>
    ${images.length > 1 ? `
    <button class="lb-btn" id="lb-prev" onclick="moveLb(-1)">‹</button>
    <button class="lb-btn" id="lb-next" onclick="moveLb(1)">›</button>
    <div id="lb-dots">${images.map((_, i) => `<div class="lb-dot" data-i="${i}" onclick="openLb(${i})" style="width:8px;height:8px;border-radius:50%;cursor:pointer;background:rgba(255,255,255,0.4)"></div>`).join('')}</div>
    ` : ''}
  </div>

  <script>
    var imgs = ${JSON.stringify(images)};
    var cur = 0;
    function openLb(i) {
      cur = i;
      document.getElementById('lb-img').src = imgs[i];
      document.getElementById('lightbox').classList.add('open');
      updateDots();
    }
    function closeLb() { document.getElementById('lightbox').classList.remove('open'); }
    function moveLb(d) { openLb((cur + d + imgs.length) % imgs.length); }
    function updateDots() {
      document.querySelectorAll('.lb-dot').forEach(function(el) {
        el.style.background = parseInt(el.dataset.i) === cur ? '#fff' : 'rgba(255,255,255,0.4)';
      });
    }
    // Swipe
    var tx = 0;
    document.getElementById('lightbox').addEventListener('touchstart', function(e){ tx = e.touches[0].clientX; });
    document.getElementById('lightbox').addEventListener('touchend', function(e){
      var d = tx - e.changedTouches[0].clientX;
      if(Math.abs(d) > 50) moveLb(d > 0 ? 1 : -1);
    });
  </script>

  <script type="module">
    import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
    import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
    import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

    const app = getApps().length ? getApps()[0] : initializeApp({
      apiKey: '${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}',
      authDomain: '${process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN}',
      projectId: '${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}',
    });
    const auth = getAuth(app);
    const db = getFirestore(app);
    onAuthStateChanged(auth, async user => {
      if (!user) return;
      const snap = await getDoc(doc(db, 'users', user.uid));
      const isAdmin = snap.data()?.role === 'admin';
      if (!isAdmin) return;
      document.getElementById('btn-delete').style.display = 'block';
    });

    window.deletePost = async function() {
      if (!confirm('Xoá bài này?')) return;
      try {
        const token = await auth.currentUser?.getIdToken();
        const res  = await fetch('/api/posts/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, id: '${id}' }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Lỗi không xác định');
        window.location.href = '/';
      } catch (e) {
        alert('Lỗi khi xoá: ' + e.message);
      }
    };
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
