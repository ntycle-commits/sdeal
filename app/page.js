import HomeClient from './HomeClient';

// Phải khớp với PAGE_SIZE trong HomeClient.js (số bài hiển thị ban đầu/mỗi lần "load more").
const PAGE_SIZE = 3;

// Lấy sẵn cả PAGE_SIZE bài mới nhất phía server qua endpoint nhẹ ?limit= của Worker (chỉ
// vài KB, không đụng Firestore) — để HomeClient có đủ nội dung ngay từ lần render đầu
// (SSR) thay vì phải đợi Firebase/Firestore chạy xong ở client mới có gì để vẽ (ảnh hưởng
// LCP), và đặc biệt là để KHÔNG có bài nào phải "trôi vào" sau khi trang đã hiện xong —
// nguồn gây CLS (dịch chuyển layout) rõ nhất trước đây.
// revalidate ngắn hơn Cache-Control (max-age=60) của Worker để dữ liệu không bị "chậm" hơn.
async function getInitialPosts() {
  const base = (process.env.POSTS_SYNC_URL || process.env.NEXT_PUBLIC_POSTS_SYNC_URL || '').replace(/\/+$/, '');
  if (!base) return [];
  try {
    const res = await fetch(`${base}/posts/index?limit=${PAGE_SIZE}`, { next: { revalidate: 20 } });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

// Ảnh LCP thật sự hiển thị đầu tiên không phải lúc nào cũng là images[0] — HomeClient
// đảo vị trí ảnh 0 và 1 khi có ≥2 ảnh (xem getDisplayImages trong HomeClient.js), nên phải
// tính đúng ảnh đó ở đây để preconnect đúng domain, không phải domain của ảnh khác.
function getLcpImageOrigin(post) {
  const images = post?.images;
  if (!images || images.length === 0) return null;
  const lcpUrl = images.length >= 2 ? images[1] : images[0];
  try {
    return new URL(lcpUrl).origin;
  } catch (_) {
    return null;
  }
}

export default async function Page() {
  const initialPosts = await getInitialPosts();
  const lcpImageOrigin = getLcpImageOrigin(initialPosts[0]);

  return (
    <>
      {/* Server đã biết trước URL ảnh LCP thật (từ initialPosts[0]) — preconnect ngay domain
          CDN của nó tại đây. React 19 tự hoist <link> lên <head> dù render ở component nào,
          nên trình duyệt bắt tay DNS/TLS với domain ảnh song song với việc parse HTML,
          thay vì phải đợi parse tới thẻ <img> mới biết cần kết nối tới đâu. */}
      {lcpImageOrigin && <link rel="preconnect" href={lcpImageOrigin} />}
      <HomeClient initialPosts={initialPosts} />
    </>
  );
}
