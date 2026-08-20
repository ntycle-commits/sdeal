'use client';

const DEFAULT_AVATAR = '/logo.png';
const SITE_LOGO      = '/logo.png';
const PAGE_SIZE      = 3;
// Realtime listener chỉ theo dõi đúng 1 bài mới nhất (thay vì cả PAGE_SIZE) — giảm hẳn
// số Firestore reads mỗi khi có tab mới mở (initial snapshot) hoặc có bài mới đăng.
// Các vị trí còn lại trong cửa sổ hiển thị (#2, #3...) lấy từ Worker KV (xem mergeWithKvTail).
const REALTIME_TOP_N = 1;

import { useEffect, useState, useRef, useCallback, useLayoutEffect, useMemo } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  collection, query, orderBy, limit,
  getDocsFromServer, onSnapshot, doc, getDoc,
} from 'firebase/firestore';
import { getAuth, onAuthStateChanged } from 'firebase/auth';

const firebaseConfig = {
  apiKey:     process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

function getApp() { return getApps().length ? getApps()[0] : initializeApp(firebaseConfig); }

let _db = null;
// Không bật persistentLocalCache (offline/IndexedDB) — lần ghé đầu IndexedDB rỗng nên
// không được lợi gì, trong khi tính năng này kéo theo rất nhiều code (~600KB chưa nén)
// vào bundle ban đầu. Feed đã có cache riêng qua Worker KV + localStorage rồi.
function getDb() {
  if (_db) return _db;
  _db = getFirestore(getApp());
  return _db;
}
function getAuthInstance() { return getAuth(getApp()); }

// Trì hoãn việc chạy fn tới lúc trình duyệt rảnh (sau khi trang đã load xong) — dùng cho
// các việc không ảnh hưởng tới nội dung hiển thị ngay, để không tranh CPU/băng thông với
// phần render/LCP ban đầu.
function whenIdle(fn) {
  if (typeof window === 'undefined') return;
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(fn, { timeout: 3000 });
  else setTimeout(fn, 1);
}

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
function boldCodes(str) {
  let result = str.replace(/\S+/g, (token) => {
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
  // Token bắt đầu bằng "AFF" viết hoa (VD: AFFBO) → luôn in đậm, kể cả khi ngắn hơn 7 ký
  // tự nên không khớp quy tắc chung ở trên.
  result = result.replace(/\S+/g, (token) => {
    if (/^<b>.*<\/b>$/.test(token)) return token;
    return /^AFF/.test(token) ? `<b>${token}</b>` : token;
  });
  return result;
}

function renderContent(text) {
  if (!text) return '';
  // Emoji trỏ tay (👉) đứng riêng dòng, xuống dòng (kể cả có dòng trống) rồi mới tới link
  // → gộp lại cùng 1 dòng với link, sát nhau không khoảng trắng (VD: 👉https://...).
  const normalized = text
    .replace(/(👉)[ \t]*\n+[ \t]*(?=https?:\/\/)/gu, '$1')
    .replace(/\n{3,}/g, '\n\n').trim();
  const parts      = normalized.split(/(https?:\/\/[^\s]+)/g);
  const html       = parts.map(part =>
    /^https?:\/\//.test(part)
      ? `<a href="${part}" target="_blank" rel="noopener noreferrer" style="color:#0068ff;overflow-wrap:anywhere;word-break:break-word">${part}</a>`
      : boldCodes(part)
  ).join('');
  return html.split('\n').map(line =>
    line.trim() === '' ? '<p style="margin:2px 0"></p>' : `<p style="margin:1px 0">${line}</p>`
  ).join('');
}

function getDisplayImages(images) {
  if (!images || images.length < 2) return images || [];
  return [images[1], images[0], ...images.slice(2)];
}

// Ảnh Shopee hỗ trợ hậu tố "@resize_w{N}_nl.webp" — resize thẳng trên CDN gốc, GIỮ ĐÚNG tỉ lệ
// (không ép vuông), miễn phí và không qua Vercel Image Optimization nên không tốn quota
// transform. Sinh srcSet chuẩn HTML để trình duyệt tự chọn đúng kích thước theo thiết
// bị/DPR — cùng cơ chế next/image nhưng không rủi ro/chi phí quota.
const SHOPEE_RESIZE_WIDTHS = [350, 640, 1080, 1920];
function isShopeeUrl(url) {
  try {
    const { hostname, pathname } = new URL(url);
    return /(^|\.)shopee\.vn$/.test(hostname) && !pathname.includes('_tn') && !pathname.includes('@resize_');
  } catch (_) {
    return false;
  }
}
function shopeeImgProps(url) {
  if (!isShopeeUrl(url)) return { src: url };
  return {
    src: `${url}@resize_w640_nl.webp`,
    srcSet: SHOPEE_RESIZE_WIDTHS.map(w => `${url}@resize_w${w}_nl.webp ${w}w`).join(', '),
  };
}
// Dùng khi mở lightbox KHÔNG qua click trực tiếp lên ảnh feed (bấm dots, nút prev/next) —
// lúc đó không có currentSrc thật để tái dùng, nên lấy bản resize lớn nhất làm ảnh full-size
// thay vì URL gốc chưa resize (ảnh gốc Shopee có thể nặng cả MB, xem ảnh cf.shopee.vn ví dụ
// từng đo ~862KB so với resize_w1920 vẫn đủ nét mà nhẹ hơn nhiều).
function shopeeLightboxSrc(url) {
  return isShopeeUrl(url) ? `${url}@resize_w1920_nl.webp` : url;
}
const LARGE_IMG_SIZES = '(min-width: 681px) 460px, 100vw'; // ảnh chính chiếm gần hết khung 680px
const SMALL_IMG_SIZES = '(min-width: 681px) 340px, 85vw';  // ảnh phụ nhỏ hơn (lưới, carousel)

function PostImageGrid({ images, onClickImage, priority }) {
  const n = images.length;

  // Khai báo hết hook TRƯỚC khi return sớm — n có thể đổi giữa các lần render của cùng 1
  // instance (VD admin sửa bài đổi số ảnh) mà không đổi key, nếu return sớm trước các hook
  // này thì thứ tự hook gọi sẽ lệch giữa các lần render, vi phạm Rules of Hooks thật sự
  // (không chỉ là lint noise) — có thể gây lỗi "Rendered more hooks than during the
  // previous render".
  const [activeIdx, setActiveIdx] = useState(0);
  const [isDesktop, setIsDesktop] = useState(null);
  const [singleImgInfo, setSingleImgInfo] = useState(null);
  const scrollRef = useRef(null);
  const singleImgRef = useRef(null);
  // Giữ hàm xử lý MỚI NHẤT (đọc n hiện tại) trong 1 ref — vì listener 'scrollend' bên dưới
  // chỉ gắn ĐÚNG 1 LẦN (không gỡ/gắn lại), nên phải gọi qua ref để luôn thấy giá trị mới
  // nhất, tránh bị "đóng băng" theo giá trị lúc effect chạy lần đầu.
  const handleSettleRef = useRef(() => {});

  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth > 680);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Dùng sự kiện 'scrollend' GỐC của trình duyệt thay vì tự đoán bằng setTimeout debounce —
  // 'scrollend' chỉ bắn ra khi trình duyệt THẬT SỰ đã dừng hẳn (kể cả sau khi tự snap xong).
  // Effect này phụ thuộc isDesktop vì scrollRef chỉ thật sự trỏ tới phần tử carousel SAU KHI
  // isDesktop xác định là false (nhánh mobile mới mount) — gắn lại đúng lúc đó.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScrollEnd = () => handleSettleRef.current(el);
    el.addEventListener('scrollend', onScrollEnd);
    return () => el.removeEventListener('scrollend', onScrollEnd);
  }, [isDesktop]);

  // Carousel (bài >=2 ảnh) luôn hiện sẵn 3 bộ ảnh nhân bản NGAY TỪ LÚC MOUNT — không đợi
  // lướt qua ảnh #1 mới "kích hoạt" loop như trước (kiểu cũ chỉ vuốt được 1 chiều tới lúc
  // đó). Dịch scrollLeft NGAY tới đầu bộ GIỮA (trước khi trình duyệt kịp sơn khung hình) để
  // vuốt được cả 2 chiều (kể cả lùi từ ảnh #1 về ảnh cuối) ngay từ lần xem đầu tiên.
  // Phụ thuộc cả isDesktop (không chỉ n): lúc mount, isDesktop còn null nên carousel thật
  // CHƯA có trong DOM (đang hiện placeholder trung tính) — scrollRef.current là null, effect
  // thoát sớm. Phải chạy lại đúng lúc isDesktop chuyển thành false (carousel thật vừa mount),
  // nếu không thì scrollLeft không bao giờ được định vị, mất khả năng vuốt lùi từ ảnh #1.
  useLayoutEffect(() => {
    if (n < 2 || !scrollRef.current) return;
    const el = scrollRef.current;
    const shift = el.children[n]?.offsetLeft ?? 0;
    el.style.scrollBehavior = 'auto';
    el.scrollLeft = shift;
    requestAnimationFrame(() => { el.style.scrollBehavior = 'smooth'; });
  }, [n, isDesktop]);

  function handleSingleImgLoad(img) {
    setSingleImgInfo({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, clientWidth: img.clientWidth });
  }

  // Ảnh n===1 được render sẵn trong HTML từ server (SSR) — trình duyệt có thể đã tải xong
  // (nhất là khi có sẵn trong cache) TRƯỚC KHI React kịp hydrate và gắn được onLoad, nghĩa
  // là sự kiện load gốc đã bắn qua từ lâu và onLoad của React sẽ KHÔNG BAO GIỜ được gọi.
  // Bắt kịp trường hợp này bằng cách check img.complete ngay sau mount.
  useEffect(() => {
    if (n === 1 && singleImgRef.current?.complete) handleSingleImgLoad(singleImgRef.current);
  }, [n]);

  if (n === 0) return null;

  const imgProps = (i) => ({
    loading:       priority && i === 0 ? 'eager' : 'lazy',
    fetchPriority: priority && i === 0 ? 'high'  : 'auto',
  });

  if (n === 1) {
    // Style tính khai báo từ state (KHÔNG mutate DOM trực tiếp trong onLoad) — mutate
    // img.style.xxx thẳng trong onLoad không được lưu vào React state, nên bất kỳ
    // re-render nào sau đó (cuộn đổi state, có bài mới qua Firestore realtime...) đều bị
    // React ghi đè lại đúng style JSX gốc, xoá sạch fix vừa áp — lúc đó ảnh bị ép về đúng
    // khung đã khai báo nhưng thiếu objectFit tương ứng, mặc định trình duyệt là 'fill' →
    // ảnh méo hình ngẫu nhiên sau khi đã hiện đúng ban đầu.
    const imgStyle = { width: '100%', height: 'auto', cursor: 'zoom-in', display: 'inline-block' };

    if (!singleImgInfo || isDesktop === null) {
      // Chưa biết tỉ lệ thật (hoặc chưa biết mobile/desktop) — giữ chỗ hình vuông tránh
      // nhảy layout. objectFit:'contain' là lưới an toàn: nếu placeholder này còn hiện ra
      // thì ảnh không bao giờ bị méo.
      imgStyle.aspectRatio = '1 / 1';
      imgStyle.objectFit = 'contain';
    } else if (isDesktop) {
      const ratio = singleImgInfo.naturalWidth / singleImgInfo.naturalHeight;
      if (ratio < 1) {
        // Ảnh dọc: width tự nhiên, căn giữa
        imgStyle.width = 'auto';
        imgStyle.maxWidth = '100%';
        imgStyle.maxHeight = '80vh';
      } else {
        // Ảnh ngang: full width
        imgStyle.maxHeight = '80vh';
      }
    } else {
      // Mobile: ảnh dài vượt khung ngoài (80vh) thì bỏ qua đúng 10% chiều cao thật ở trên
      // cùng (thường là status bar/thanh trình duyệt trong screenshot) rồi mới hiện đủ
      // 80vh từ đó — dịch ảnh lên đúng 10% chiều cao đã render (không dùng % CSS vì
      // margin theo % luôn tính theo WIDTH của khung cha, không phải height). Khung ngoài
      // (overflow:hidden, maxHeight:80vh) mới là nơi thực sự cắt phần dư — không co nhỏ
      // ảnh lại như đặt maxHeight thẳng lên ảnh sẽ làm.
      const renderedHeight = singleImgInfo.clientWidth * (singleImgInfo.naturalHeight / singleImgInfo.naturalWidth);
      const maxHeightPx = window.innerHeight * 0.8;
      if (renderedHeight > maxHeightPx) {
        imgStyle.marginTop = `-${renderedHeight * 0.1}px`;
      }
    }

    return (
      <div className="feed-img-wrap" data-swipe-ignore
        style={{ background: '#f5f5f5', lineHeight: 0, textAlign: 'center', overflow: 'hidden', maxHeight: '80vh' }}>
        <img ref={singleImgRef} {...shopeeImgProps(images[0])} sizes={LARGE_IMG_SIZES} alt="" {...imgProps(0)}
          onClick={e => onClickImage(0, e.currentTarget.currentSrc)}
          className="feed-img"
          onLoad={e => handleSingleImgLoad(e.target)}
          style={imgStyle} />
      </div>
    );
  }

  // Chưa biết mobile hay desktop — 2 bên dùng 2 cây DOM khác hẳn nhau, không phải chỉ khác
  // style, nên không thể "đoán đại" 1 bên rồi sửa sau (vẽ sai cấu trúc rồi thay nguyên cụm
  // DOM khác đè lên rất giật, có thể còn hại cả LCP thật). Hiện placeholder trung tính, đợi
  // biết chắc rồi vẽ ĐÚNG NGAY LUÔN 1 lần duy nhất.
  if (isDesktop === null) {
    // mobile carousel mỗi slide luôn 85% width, paddingBottom 85% của CHÍNH nó → tỉ lệ
    // không đổi theo n; desktop n===2 là 2 ô vuông cạnh nhau (~50% width/ô), n>=3 là 1 ô to
    // (2fr) + 2 ô nhỏ (1fr) xếp chồng bên phải (tổng cao ~2/3 chiều rộng khung).
    const mobileAR  = 1 / (0.85 * 0.85);
    const desktopAR = n === 2 ? 2 : 1.5;
    return <div className="pig-placeholder" style={{ '--pig-ar-mobile': mobileAR, '--pig-ar-desktop': desktopAR }} />;
  }

  // Desktop: grid layout cũ
  if (isDesktop) {
    const onImgLoad = (cropPos = 'center 15%') => (e) => {
      const img = e.target;
      const ratio = img.naturalWidth / img.naturalHeight;
      if (ratio < 0.9) { img.style.objectFit = 'cover'; img.style.objectPosition = cropPos; img.parentElement.style.background = 'transparent'; }
      else { img.style.objectFit = 'contain'; img.style.objectPosition = 'center'; }
    };
    const cell = (src, i, pb = '100%', cropPos) => (
      <div key={i} className="feed-img-wrap" style={{ position: 'relative', paddingBottom: pb, overflow: 'hidden', background: '#f5f5f5' }}>
        <img {...shopeeImgProps(src)} sizes={SMALL_IMG_SIZES} alt="" {...imgProps(i)} onClick={e => onClickImage(i, e.currentTarget.currentSrc)} onLoad={onImgLoad(cropPos)}
          className="feed-img"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center', cursor: 'zoom-in' }} />
      </div>
    );
    // Layout 2 ảnh: ảnh bên phải (thứ 2) khi cần crop (ảnh dọc) thì neo theo "left bottom"
    // (cắt từ dưới lên, từ trái qua) thay vì "center 15%" (neo trên-giữa) như các ảnh khác.
    if (n === 2) return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>{images.map((img, i) => cell(img, i, '100%', i === 1 ? 'left bottom' : undefined))}</div>;
    if (n === 3) return (
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 2 }}>
        <div style={{ gridRow: '1 / 3', overflow: 'hidden', background: '#f5f5f5' }}>
          <img {...shopeeImgProps(images[0])} sizes={LARGE_IMG_SIZES} alt="" {...imgProps(0)} onClick={e => onClickImage(0, e.currentTarget.currentSrc)} onLoad={onImgLoad()}
            style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center', cursor: 'zoom-in', display: 'block' }} />
        </div>
        {[1, 2].map(i => cell(images[i], i))}
      </div>
    );
    if (n === 4) return (
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 2 }}>
        <div style={{ gridRow: '1 / 4', overflow: 'hidden', background: '#f5f5f5' }}>
          <img {...shopeeImgProps(images[0])} sizes={LARGE_IMG_SIZES} alt="" {...imgProps(0)} onClick={e => onClickImage(0, e.currentTarget.currentSrc)} onLoad={onImgLoad()}
            style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center', cursor: 'zoom-in', display: 'block' }} />
        </div>
        {[1, 2, 3].map(i => cell(images[i], i))}
      </div>
    );
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>{[0,1].map(i => cell(images[i], i, '75%'))}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2 }}>
          {[2,3,4].map(i => (
            <div key={i} style={{ position: 'relative', paddingBottom: '75%', overflow: 'hidden' }}>
              <img {...shopeeImgProps(images[i])} sizes={SMALL_IMG_SIZES} alt="" {...imgProps(i)} onClick={e => onClickImage(i, e.currentTarget.currentSrc)} onLoad={onImgLoad()}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center', cursor: 'zoom-in' }} />
              {i === 4 && n > 5 && <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 24, fontWeight: 700 }}>+{n - 5}</div>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Mobile: Threads-style horizontal scroll cho 2+ ảnh, có loop CẢ 2 CHIỀU ngay từ lần xem
  // đầu tiên (không đợi vuốt tới ảnh #2 mới "kích hoạt" như trước). Nhân bản NGUYÊN BỘ ảnh 3
  // lần, luôn bắt đầu ở bộ GIỮA — nhân bản nguyên bộ (không chỉ 1 ảnh clone mỗi đầu) để mọi
  // vị trí luôn có đúng ảnh hé cạnh bên như thật (clone lẻ tẻ sẽ có viền hé khác thật, gây
  // giật khi nhận ra).
  const tripleImages = [...images, ...images, ...images];
  const realIndexOf = p => p % n;

  // Hễ đang ở bộ ĐẦU hoặc bộ CUỐI (đã lướt ra khỏi bộ giữa, bất kể xa gần) thì dịch đúng 1
  // độ rộng "1 bộ n ảnh" để quay lại đúng vị trí tương ứng ở bộ giữa — vì 2 bộ là bản sao y
  // hệt nhau, dịch bằng offset THẬT (không ước lượng bằng phép chia) này luôn chính xác.
  const checkAndSnap = el => {
    const oneSet = el.children[n]?.offsetLeft;
    if (!oneSet) return;
    if (el.scrollLeft < oneSet - 2) {
      el.style.scrollBehavior = 'auto';
      el.scrollLeft += oneSet;
      requestAnimationFrame(() => { el.style.scrollBehavior = 'smooth'; });
    } else if (el.scrollLeft >= oneSet * 2 - 2) {
      el.style.scrollBehavior = 'auto';
      el.scrollLeft -= oneSet;
      requestAnimationFrame(() => { el.style.scrollBehavior = 'smooth'; });
    }
  };

  // Chạy mỗi khi trình duyệt xác nhận đã dừng cuộn HẲN (qua 'scrollend') — luôn kiểm tra có
  // đang lạc sang bộ đầu/cuối không rồi snap về bộ giữa, không còn cần "làm nóng" bằng 1
  // lượt vuốt tới trước nữa.
  handleSettleRef.current = el => checkAndSnap(el);

  const onScroll = (e) => {
    const el = e.currentTarget;
    const stride = el.scrollWidth / tripleImages.length;
    const pos = Math.round(el.scrollLeft / stride);
    setActiveIdx(realIndexOf(pos));
  };

  return (
    <div style={{ position: 'relative' }}>
      {/* Scroll container */}
      <div ref={scrollRef} onScroll={onScroll} data-swipe-ignore
        style={{ display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory',
                 scrollBehavior: 'smooth', WebkitOverflowScrolling: 'touch',
                 // Tắt hẳn scroll-anchoring — nếu không, lúc chèn 2 bộ ảnh vào ĐẦU+CUỐI danh
                 // sách (bật loop), trình duyệt có thể tự bù trừ scrollLeft riêng, cộng dồn
                 // với phần bù thủ công ở useLayoutEffect phía trên → lệch vị trí gấp đôi,
                 // gây giật.
                 overflowAnchor: 'none',
                 msOverflowStyle: 'none', scrollbarWidth: 'none' }}>
        {tripleImages.map((src, p) => {
          const real = realIndexOf(p);
          // Vị trí áp chót của bộ ĐẦU và vị trí đầu tiên của bộ CUỐI là 2 chỗ hé lộ ngay sát
          // 2 biên của bộ giữa — luôn vẽ sẵn (bỏ qua content-visibility) để không "hiện ra"
          // (pop-in) đúng lúc đang cuộn tới, mọi vị trí khác vẫn defer như cũ.
          const isBoundaryPeek = p === n - 1 || p === 2 * n;
          return (
            <div key={p}
              style={{ flexShrink: 0,
                       width: '85%',
                       marginRight: 8,
                       scrollSnapAlign: 'start',
                       position: 'relative',
                       paddingBottom: '85%',
                       background: '#f5f5f5', overflow: 'hidden',
                       borderRadius: 12,
                       contentVisibility: (!isBoundaryPeek && real > 0) ? 'auto' : undefined }}>
              <img {...shopeeImgProps(src)} sizes={SMALL_IMG_SIZES} alt="" {...imgProps(real)}
                onClick={e => onClickImage(real, e.currentTarget.currentSrc)}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
                         objectFit: real === 0 ? 'cover' : 'contain',
                         objectPosition: real === 0 ? 'left bottom' : 'center',
                         cursor: 'zoom-in' }} />
            </div>
          );
        })}
      </div>

      {/* Indicator dots */}
      {n > 1 && (
        <div style={{ position: 'absolute', bottom: 8, left: 0, right: 0,
                      display: 'flex', justifyContent: 'center', gap: 5,
                      pointerEvents: 'none' }}>
          {images.map((_, i) => (
            <div key={i} style={{ width: i === activeIdx ? 16 : 6, height: 6,
                                  borderRadius: 3, transition: 'width 0.2s',
                                  background: i === activeIdx ? '#fff' : 'rgba(255,255,255,0.55)',
                                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
          ))}
        </div>
      )}

      {/* Counter x/n */}
      <div style={{ position: 'absolute', top: 8, right: 10,
                    background: 'rgba(0,0,0,0.45)', color: '#fff',
                    fontSize: 11, fontWeight: 600, borderRadius: 10,
                    padding: '2px 7px', pointerEvents: 'none' }}>
        {activeIdx + 1}/{n}
      </div>
    </div>
  );
}

export default function HomeClient({ initialPosts }) {
  // initialPosts: cả PAGE_SIZE bài mới nhất fetch sẵn phía server (Server Component ở
  // page.js, qua Worker ?limit=PAGE_SIZE) — dùng làm state khởi tạo để nội dung có mặt
  // ngay trong HTML SSR, không phải đợi Firebase/Firestore chạy xong ở client (ảnh hưởng
  // trực tiếp tới LCP). Lấy sẵn ĐỦ cả 3 bài (không chỉ 1) để không có bài nào phải "trôi
  // vào" sau khi trang đã hiện xong — nguồn gây CLS (dịch chuyển layout) rõ nhất trước đây.
  // Firestore realtime bên dưới sẽ sớm xác nhận lại đúng bài #1 (xem isFirstSnapshot).
  const [posts,         setPosts]         = useState(initialPosts || []);
  // Lưới an toàn cuối: khử trùng theo id trước khi render/dùng ở bất kỳ đâu (kể cả
  // postsRef — nguồn cho shownIds/primaryIds ở handleLoadMore, mergeWithKvTail...). Nhiều
  // nguồn (Firestore realtime, "load more", resync) đều tự setPosts dựa trên 1 snapshot
  // cũ — nếu 2 nguồn cùng thêm đúng 1 bài gần như đồng thời (race hiếm gặp), chặn triệt để
  // tại đây thay vì phải chứng minh không race nào có thể xảy ra ở từng nơi gọi setPosts.
  const dedupedPosts = useMemo(() => {
    const seen = new Set();
    return posts.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [posts]);
  const postsRef = useRef([]);
  useEffect(() => { postsRef.current = dedupedPosts; }, [dedupedPosts]);
  const [loading,       setLoading]       = useState(!(initialPosts && initialPosts.length));
  const [loadingMore,   setLoadingMore]   = useState(false);
  const [hasMore,       setHasMore]       = useState(true);
  const kvPoolRef = useRef(null); // cache bài cũ hơn (từ Worker KV) dùng cho "load more"
  const loadingMoreRef = useRef(false); // chặn handleLoadMore chạy trùng lặp
  const [lightbox,      setLightbox]      = useState(null);
  const [lbZoomed,      setLbZoomed]      = useState(false); // đang pinch-zoom trong lightbox
  const [scrolled,      setScrolled]      = useState(false);
  const [highlightId,   setHighlightId]   = useState(null);
  const [copyToast,     setCopyToast]     = useState(false);
  const [isAdmin,       setIsAdmin]       = useState(false);
  const [editingPost,   setEditingPost]   = useState(null); // post đang được admin sửa
  const [editForm,      setEditForm]      = useState({ content: '', link: '' });
  const [savingEdit,    setSavingEdit]    = useState(false);
  const pageRef         = useRef(null);
  const [showSearch,    setShowSearch]    = useState(false);
  const [searchQuery,   setSearchQuery]   = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [hasNewAtTop,   setHasNewAtTop]   = useState(false);
  const [showNewToast,  setShowNewToast]  = useState(false);

  const searchInputRef = useRef(null);
  const postRefs       = useRef({});
  const loadMoreRef    = useRef(null);
  const touchStartRef  = useRef({ x: 0, y: 0 });

  const POSTS_CACHE_KEY = 'posts_kv_cache_v1';
  const POSTS_CACHE_TTL = 3 * 60 * 1000; // 3 phút
  const FEED_CACHE_KEY   = 'feed_posts_cache_v1';
  const FEED_CACHE_TTL   = 15 * 60 * 1000; // 15 phút

  useEffect(() => {
    ['search_posts_cache', 'search_posts_cache_v2', 'search_posts_cache_v3', 'search_posts_cache_v4']
      .forEach(k => localStorage.removeItem(k));
    // Không pre-load cache lên UI để tránh hiện bài cũ trước bài mới
  }, []);

  function normalize(str) {
    return (str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  }

  // Nguồn dữ liệu dùng chung cho search + "load more" feed: đọc từ Worker Cloudflare
  // (cache 2000 bài mới nhất, đồng bộ sẵn từ Firestore mỗi khi có bài mới) thay vì gọi
  // thẳng Firestore — không tốn Firestore reads cho 2 tính năng này nữa.
  async function getPostsCache(forceRefresh = false) {
    if (!forceRefresh) {
      try {
        const cached = localStorage.getItem(POSTS_CACHE_KEY);
        if (cached) {
          const { data, ts } = JSON.parse(cached);
          // Bỏ qua cache nếu dữ liệu cũ lỡ không phải mảng hợp lệ (VD do lỗi tạm thời
          // của Worker trước đây) — coi như cache miss, fetch lại cho chắc.
          if (Array.isArray(data) && Date.now() - ts < POSTS_CACHE_TTL) return data;
        }
      } catch (_) {}
    }
    // Bỏ dấu "/" ở cuối (nếu có) trước khi nối path, tránh lỗi "//posts/index" khi biến
    // môi trường lỡ được điền kèm dấu "/" cuối URL.
    const base = (process.env.NEXT_PUBLIC_POSTS_SYNC_URL || '').replace(/\/+$/, '');
    const res  = await fetch(`${base}/posts/index`);
    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error('Dữ liệu posts cache không hợp lệ: ' + JSON.stringify(data).slice(0, 200));
    }
    try { localStorage.setItem(POSTS_CACHE_KEY, JSON.stringify({ data, ts: Date.now() })); } catch (_) {}
    return data;
  }

  // Bản nhẹ của getPostsCache — chỉ để lấp vài vị trí đầu (#2, #3) cho lần hiện bài ban
  // đầu/resync, KHÔNG cần tải cả 2000 bài (~1MB). Dùng ?limit=n mà Worker hỗ trợ riêng
  // cho việc này (xem mergeWithKvTail).
  async function getPostsTop(n) {
    const base = (process.env.NEXT_PUBLIC_POSTS_SYNC_URL || '').replace(/\/+$/, '');
    const res  = await fetch(`${base}/posts/index?limit=${n}`);
    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error('Dữ liệu posts top không hợp lệ: ' + JSON.stringify(data).slice(0, 200));
    }
    return data;
  }

  // Ghép bài mới nhất (đọc trực tiếp Firestore realtime, luôn đúng ngay lập tức) với các
  // bài kế tiếp lấy từ Worker KV (đủ mới, không tốn thêm Firestore reads) để dựng cửa sổ
  // hiển thị ban đầu/khi resync — thay vì đọc cả PAGE_SIZE bài từ Firestore mỗi lần.
  async function mergeWithKvTail(primaryPosts, size) {
    const needed = Math.max(0, size - primaryPosts.length);
    if (needed === 0) return primaryPosts;

    // Nếu pool đầy đủ đã có sẵn (từ search/"load more" trước đó) thì dùng luôn, khỏi tải
    // lại. Nếu chưa, tải nhẹ đúng số bài cần qua getPostsTop — KHÔNG gán vào kvPoolRef,
    // để handleLoadMore (cuộn xuống thật) vẫn tự tải pool đầy đủ khi cần, như cũ.
    let pool = kvPoolRef.current;
    if (!pool) {
      try {
        pool = await getPostsTop(needed + primaryPosts.length + 2); // dư vài bài để bù trùng với primaryPosts
      } catch (_) {
        pool = [];
      }
    }
    const primaryIds = new Set(primaryPosts.map(p => p.id));
    const tail = pool.filter(p => !primaryIds.has(p.id)).slice(0, needed);
    return [...primaryPosts, ...tail];
  }

  const doSearch = useCallback(async (q) => {
    if (!q.trim() || q.trim().length < 3) { setSearchResults([]); return; }
    setSearchLoading(true);
    const allPosts = await getPostsCache();
    const tokens   = normalize(q).split(/\s+/).filter(Boolean);
    setSearchResults(allPosts.filter(p => {
      const text = normalize(p.content) + ' ' + normalize(p.senderName);
      return tokens.some(t => text.includes(t));
    }));
    setSearchLoading(false);
  }, []);

  // Đồng bộ lại đúng top-PAGE_SIZE mới nhất từ server, thay thế toàn bộ posts. Dùng khi
  // quay lại đầu trang sau khi có bài mới, hoặc khi quay lại tab sau một thời gian dài —
  // tránh cộng dồn/giữ bài cũ gây lệch (gap) với các bài mới thật.
  async function resyncTopWindow() {
    try {
      const db   = getDb();
      const q    = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(REALTIME_TOP_N));
      const snap = await getDocsFromServer(q);
      const top1 = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // "posts" vừa đổi hẳn → pool bài cũ (tính theo posts trước đó) không còn đúng ranh
      // giới nữa, cần tính lại từ đầu.
      kvPoolRef.current = null;
      setPosts(await mergeWithKvTail(top1, PAGE_SIZE));
      setHasMore(true);
    } catch (_) {}
  }

  useEffect(() => {
    if (lightbox) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [lightbox]);

  // Theo dõi trạng thái pinch-zoom trong lightbox (qua Visual Viewport API) — khi đang
  // zoom, tắt logic vuốt chuyển ảnh/đóng và cho phép trình duyệt tự xử lý pan bằng 1
  // ngón tay để lướt xem ảnh đã phóng to, tránh xung đột với gesture vuốt tuỳ biến.
  useEffect(() => {
    if (!lightbox) { setLbZoomed(false); return; }
    const vv = window.visualViewport;
    if (!vv) return;
    const onVVChange = () => setLbZoomed(vv.scale > 1.02);
    vv.addEventListener('resize', onVVChange);
    vv.addEventListener('scroll', onVVChange);
    return () => {
      vv.removeEventListener('resize', onVVChange);
      vv.removeEventListener('scroll', onVVChange);
    };
  }, [lightbox]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Firebase Auth (getAuth + onAuthStateChanged) kéo theo việc tải iframe.js từ authDomain
  // + gọi getProjectConfig để chuẩn bị luồng đăng nhập redirect — chạy với MỌI khách kể cả
  // chưa đăng nhập, tranh băng thông với ảnh/nội dung chính nếu chạy ngay lúc mount.
  // isAdmin chỉ dùng để hiện nút sửa/xoá bài, không cần gấp — trì hoãn tới lúc trang đã
  // load xong + trình duyệt rảnh.
  useEffect(() => {
    let unsub = null;
    let cancelled = false;
    const initAuth = () => {
      if (cancelled) return;
      unsub = onAuthStateChanged(getAuthInstance(), async user => {
        if (!user) { setIsAdmin(false); sessionStorage.removeItem('isAdmin'); return; }
        const cached = sessionStorage.getItem('isAdmin');
        if (cached !== null) { setIsAdmin(cached === '1'); return; }
        const snap  = await getDoc(doc(getDb(), 'users', user.uid));
        const admin = snap.data()?.role === 'admin';
        sessionStorage.setItem('isAdmin', admin ? '1' : '0');
        setIsAdmin(admin);
      });
    };
    let onLoad;
    if (document.readyState === 'complete') {
      whenIdle(initAuth);
    } else {
      onLoad = () => whenIdle(initAuth);
      window.addEventListener('load', onLoad, { once: true });
    }
    return () => {
      cancelled = true;
      if (onLoad) window.removeEventListener('load', onLoad);
      if (unsub) unsub();
    };
  }, []);

  const deepPostId = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('p') : null;

  useEffect(() => {
    if (!deepPostId) return;
    setHighlightId(deepPostId);
    getDoc(doc(getDb(), 'posts', deepPostId)).then(snap => {
      if (snap.exists()) { setPosts([{ id: snap.id, ...snap.data() }]); setHasMore(false); }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (deepPostId) return;
    const db    = getDb();
    const q     = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(REALTIME_TOP_N));
    let isFirstSnapshot = true;

    const saveFeedCache = (fresh) => {
      try {
        const slim = fresh.map(p => ({
          id: p.id, content: p.content || '', senderName: p.senderName || '',
          senderAvatar: p.senderAvatar || '', images: p.images || [],
          link: p.link || '',
          createdAt: p.createdAt?.seconds ? { seconds: p.createdAt.seconds } : null,
        }));
        localStorage.setItem(FEED_CACHE_KEY, JSON.stringify({ data: slim, ts: Date.now() }));
      } catch (_) {}
    };

    const unsub = onSnapshot(q, async snap => {
      const fresh = snap.docs.map(d => ({ id: d.id, ...d.data() })); // luôn ≤ REALTIME_TOP_N bài

      // Chưa có snapshot THẬT từ server (trước đó chỉ là cache offline cục bộ) →
      // luôn thay thế toàn bộ, tránh hiện bài cache cũ rồi lệch khi server phản hồi
      // ngay sau đó.
      if (isFirstSnapshot) {
        if (!snap.metadata.fromCache) isFirstSnapshot = false;
        const prev = postsRef.current;

        if (prev.length > 0 && prev[0]?.id === fresh[0]?.id) {
          // Bài #1 đã có sẵn từ SSR (initialPosts) vẫn đúng là bài mới nhất — chỉ cập nhật
          // nội dung bài đó tại chỗ (Firestore là nguồn xác thực hơn Worker cache), KHÔNG
          // đụng tới #2, #3 đã hiển thị sẵn. Tránh co mảng về 1 bài rồi merge/phình lại —
          // chính là nguồn CLS (dịch chuyển layout) trước đây.
          const updated = prev.map((p, i) => (i === 0 ? fresh[0] : p));
          setPosts(updated);
          setLoading(false);
          saveFeedCache(updated);
          return;
        }

        if (prev.length === 0) {
          // Không có dữ liệu SSR sẵn (VD Worker lỗi lúc build/revalidate) — hiện tạm bài #1
          // ngay, rồi merge thêm #2, #3 ngay sau. Không có gì để tránh "trôi vào" ở đây vì
          // trước đó chưa hiện được gì cả.
          setPosts(fresh);
          setLoading(false);
          const merged = await mergeWithKvTail(fresh, PAGE_SIZE);
          setPosts(merged);
          saveFeedCache(merged);
          return;
        }

        // Đã có SSR data, nhưng bài mới nhất thật (Firestore) khác bài SSR biết tới — có
        // bài mới đăng lên đúng lúc. Tính đủ cửa sổ mới TRƯỚC rồi mới setPosts đúng 1 lần,
        // tránh co về 1 bài rồi phình lại gây dịch chuyển layout.
        setLoading(false);
        const merged = await mergeWithKvTail(fresh, PAGE_SIZE);
        setPosts(merged);
        saveFeedCache(merged);
        return;
      }

      const prev    = postsRef.current;
      const prevMap = new Map(prev.map(p => [p.id, p]));
      const hasNew  = fresh.some(p => !prevMap.has(p.id));

      if (!hasNew) {
        // Không có bài mới nào cả — chỉ có thể là bài đầu (duy nhất theo dõi realtime)
        // bị sửa nội dung. Bài #2, #3 trở đi lấy từ KV nên không tự cập nhật realtime.
        const updated = prev.map(p => fresh.find(f => f.id === p.id) || p);
        setPosts(updated);
        saveFeedCache(updated);
      } else if (window.scrollY > 200) {
        // Đang xem sâu hơn đầu trang → không làm gián đoạn, chỉ báo có bài mới.
        // Khi họ cuộn lại đầu trang, effect resync bên dưới sẽ đồng bộ lại đúng top mới nhất.
        setHasNewAtTop(true);
        setShowNewToast(true);
        setTimeout(() => setShowNewToast(false), 5000);
      } else {
        // Đang ở đầu trang → luôn đồng bộ đúng top mới nhất, KHÔNG cộng dồn/giữ lại
        // bài cũ đã bị đẩy khỏi vị trí đầu (tránh lặp lại bug cộng dồn đã gặp trước đây).
        kvPoolRef.current = null; // top đổi hẳn → pool cho phần đuôi cần tính lại
        const merged = await mergeWithKvTail(fresh, PAGE_SIZE);
        setPosts(merged);
        setHasMore(true);
        saveFeedCache(merged);
      }

      setLoading(false);
    }, (error) => {
      console.error('[feed] onSnapshot lỗi:', error);
      setLoading(false);
    });
    return unsub;
  }, [deepPostId]);

  // Sau khi tab bị ẩn (chuyển tab/app khác, màn hình khoá...) một lúc rồi quay lại,
  // có thể đã có rất nhiều bài mới đăng lên trong lúc đó. Nếu người dùng vẫn đang ở
  // gần đầu trang (chưa cuộn xuống xem bài cũ), đồng bộ lại đúng top-3 mới nhất từ
  // server — cho cảm giác giống F5 mà không cần reload.
  useEffect(() => {
    if (deepPostId) return;
    let hiddenAt = null;
    const HIDDEN_THRESHOLD = 30 * 1000; // 30 giây

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      if (document.visibilityState !== 'visible' || hiddenAt === null) return;
      const hiddenFor = Date.now() - hiddenAt;
      hiddenAt = null;
      if (hiddenFor < HIDDEN_THRESHOLD || window.scrollY > 200) return;
      resyncTopWindow();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [deepPostId]);

  // Đã báo có bài mới (hasNewAtTop) trong lúc đang cuộn sâu — khi quay lại đầu trang,
  // đồng bộ lại đúng top mới nhất từ server (không tự chèn dữ liệu cũ đã biết trước đó).
  useEffect(() => {
    if (scrolled === false && hasNewAtTop) {
      setHasNewAtTop(false);
      setShowNewToast(false);
      resyncTopWindow();
    }
  }, [scrolled, hasNewAtTop]);

  const handleNewToastClick = () => {
    setShowNewToast(false);
    setHasNewAtTop(false);
    resyncTopWindow();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // "Load more" giờ lấy từ Worker KV (2000 bài mới nhất, đồng bộ sẵn từ Firestore) thay
  // vì gọi Firestore mỗi lần cuộn — vẫn giữ nguyên PAGE_SIZE=3 bài/lần như cũ. Chỉ fetch
  // KV 1 lần/phiên (cache trong kvPoolRef), các lần "load more" sau chỉ lọc/cắt mảng có sẵn.
  async function handleLoadMore() {
    // Guard bằng ref (đồng bộ ngay lập tức), không dùng state loadingMore — 2 observer
    // (bài áp chót + sentinel dự phòng) có thể cùng bắn trong CÙNG 1 tick khi cuộn nhanh,
    // lúc đó setLoadingMore(true) chưa kịp commit nên cả 2 đều đọc thấy loadingMore=false,
    // lọt qua guard và append trùng 1 lô bài (duplicate key).
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      if (!kvPoolRef.current) kvPoolRef.current = await getPostsCache();
      const shownIds  = new Set(postsRef.current.map(p => p.id));
      const remaining = kvPoolRef.current.filter(p => !shownIds.has(p.id));
      const next      = remaining.slice(0, PAGE_SIZE);
      // Lọc lại lần nữa theo "prev" MỚI NHẤT tại lúc setState thật sự áp dụng (không phải
      // shownIds đã snapshot ở trên) — nếu trong lúc await getPostsCache() ở trên, Firestore
      // realtime cũng vừa setPosts thêm đúng bài nào đó trong "next", đây là lưới chặn cuối
      // để không thêm trùng (duplicate key).
      if (next.length > 0) setPosts(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        const toAdd = next.filter(p => !existingIds.has(p.id));
        return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
      });
      setHasMore(remaining.length > next.length);
    } catch (e) {
      console.error('[feed] load more lỗi:', e);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }

  // Sửa/xoá bài đi qua API route riêng (không gọi thẳng Firestore từ client) vì cần
  // đồng bộ lại Worker KV bằng secret phía server — client không được giữ secret đó.
  async function saveEditPost() {
    if (!editingPost) return;
    setSavingEdit(true);
    try {
      const token = await getAuthInstance().currentUser?.getIdToken();
      const res  = await fetch('/api/posts/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, id: editingPost.id, content: editForm.content, link: editForm.link }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Lỗi không xác định');
      setPosts(prev => prev.map(p => p.id === editingPost.id
        ? { ...p, content: editForm.content, link: editForm.link } : p));
      setEditingPost(null);
    } catch (e) {
      alert('Lỗi khi lưu: ' + e.message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function deletePost(postId) {
    if (!confirm('Xoá bài này?')) return;
    try {
      const token = await getAuthInstance().currentUser?.getIdToken();
      const res  = await fetch('/api/posts/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, id: postId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Lỗi không xác định');
      setPosts(prev => prev.filter(p => p.id !== postId));
    } catch (e) {
      alert('Lỗi khi xoá: ' + e.message);
    }
  }

  // Kích hoạt load thêm SỚM — ngay khi bài áp cuối (bài số 2 trong lô 3 bài hiện tại)
  // lướt vào màn hình, không đợi tới bài cuối cùng — để tới lúc user cuộn tới bài cuối
  // thì lô mới đã tải xong/đang tải, trải nghiệm cuộn liền mạch không bị đứng lại.
  useEffect(() => {
    if (!hasMore || loadingMore || dedupedPosts.length < 2) return;
    const triggerPost = dedupedPosts[dedupedPosts.length - 2];
    const el = postRefs.current[triggerPost?.id];
    if (!el) return;

    const observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) handleLoadMore(); },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [dedupedPosts, hasMore, loadingMore]);

  // Lưới an toàn: nếu vì lý do gì đó (cuộn rất nhanh, bỏ lỡ khung hình...) mà observer ở
  // bài áp cuối không kịp kích hoạt, sentinel ở cuối cùng vẫn đảm bảo load thêm khi user
  // thực sự cuộn tới hết danh sách hiện có.
  useEffect(() => {
    if (!loadMoreRef.current) return;
    const observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting && hasMore && !loadingMore) handleLoadMore(); },
      { threshold: 0.1 }
    );
    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadingMore]);

  function formatTime(ts) {
    if (!ts) return '';
    const d    = ts.toDate ? ts.toDate()
                : (ts._seconds || ts.seconds) ? new Date((ts._seconds || ts.seconds) * 1000)
                : new Date(ts);
    const now  = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60)    return 'Vừa xong';
    if (diff < 3600)  return `${Math.floor(diff / 60)} phút trước`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
    return d.toLocaleDateString('vi-VN');
  }

  return (
    <>
    <div ref={pageRef} style={{ maxWidth: 680, margin: '0 auto', padding: '0 0 40px',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  background: '#f0f2f5', minHeight: '100vh' }}>

      {/* Lightbox */}
      {lightbox && (() => {
        const { images, index, buyUrl, clickedIndex, clickedSrc } = lightbox;
        // Ảnh vừa bấm trong feed đã tải sẵn (currentSrc trình duyệt thật sự chọn từ srcSet)
        // — dùng lại đúng URL đó cho ảnh đang mở, khỏi tải lại gây nháy. Các ảnh khác (bấm
        // dots/prev/next sang) không có currentSrc thật nên dùng bản resize lớn full-size.
        const lightboxSrc = index === clickedIndex && clickedSrc ? clickedSrc : shopeeLightboxSrc(images[index]);
        const isDesktopView = typeof window !== 'undefined' && window.innerWidth > 680;

        // Desktop, nhiều ảnh: hiện cả list cuộn dọc thay vì bấm ‹› từng ảnh 1. Mỗi ảnh nằm
        // trong 1 "slot" cao CỐ ĐỊNH (80% viewport, không phụ thuộc kích thước ảnh thật) —
        // nhờ vậy vị trí cuộn tới ảnh vừa bấm tính được NGAY LẬP TỨC lúc gắn DOM (el.scrollTop
        // = ...), độc lập hoàn toàn với việc ảnh đã tải xong hay chưa. Nếu để chiều cao phụ
        // thuộc ảnh thật (vd scrollIntoView sau khi ảnh tải), layout sẽ phình ra dần khi từng
        // ảnh tải xong (đặc biệt ảnh đứng TRƯỚC ảnh vừa bấm) và đẩy lệch vị trí đã cuộn — gây
        // nháy/lệch ảnh. Không dùng scrollIntoView vì nó phụ thuộc thời điểm ảnh tải xong.
        if (isDesktopView && images.length > 1) {
          const SLOT_RATIO = 0.8;
          const setScroll = el => {
            if (!el || el.dataset.scrolled === 'true') return;
            el.dataset.scrolled = 'true';
            const slotH = el.clientHeight * SLOT_RATIO;
            el.scrollTop = clickedIndex * slotH - (el.clientHeight - slotH) / 2;
          };
          return (
            <div onClick={() => setLightbox(null)} ref={setScroll}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 1000,
                       overflowY: 'auto', scrollSnapType: 'y mandatory' }}>
              <button onClick={e => { e.stopPropagation(); setLightbox(null); }}
                style={{ position: 'fixed', top: 16, right: 16, background: 'rgba(90,90,90,0.55)',
                         border: 'none', color: '#fff', borderRadius: '50%',
                         width: 36, height: 36, fontSize: 18, cursor: 'pointer', zIndex: 1001 }}>✕</button>
              {images.map((src, i) => (
                <div key={i} style={{ height: `${SLOT_RATIO * 100}vh`, scrollSnapAlign: 'center',
                               display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img src={i === clickedIndex && clickedSrc ? clickedSrc : shopeeLightboxSrc(src)} alt=""
                    onClick={e => e.stopPropagation()}
                    style={{ maxWidth: '92%', maxHeight: 'calc(100% - 32px)', objectFit: 'contain',
                             borderRadius: 8, userSelect: 'none', display: 'block' }} />
                </div>
              ))}
              {buyUrl && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '0 16px 32px' }}>
                  <a href={buyUrl} target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{ background: '#EE4D2D', color: '#fff', fontSize: 15, fontWeight: 700,
                             textDecoration: 'none', textAlign: 'center', padding: '12px 64px',
                             borderRadius: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                             WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="#FFC107" stroke="white" strokeWidth="1" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279-7.416-4.021-7.417 4.021 1.481-8.279-6.064-5.828 8.332-1.151z"/>
                    </svg>
                    Xem đánh giá
                  </a>
                </div>
              )}
            </div>
          );
        }

        const prev = () => setLightbox({ images, index: (index - 1 + images.length) % images.length, buyUrl, clickedIndex, clickedSrc });
        const next = () => setLightbox({ images, index: (index + 1) % images.length, buyUrl, clickedIndex, clickedSrc });
        const onTouchStart = e => {
          touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        };
        const onTouchEnd   = e => {
          if (lbZoomed) return; // đang zoom → để trình duyệt tự pan, không vuốt chuyển/đóng
          const diffX = touchStartRef.current.x - e.changedTouches[0].clientX;
          const diffY = touchStartRef.current.y - e.changedTouches[0].clientY;
          if (Math.abs(diffY) > Math.abs(diffX) && diffY > 50) { setLightbox(null); return; }
          if (Math.abs(diffX) > 50) diffX > 0 ? next() : prev();
        };
        // Bấm (không vuốt) vào 20% trái/phải màn hình thì chuyển ảnh luôn, không bắt buộc
        // bấm trúng nút ‹›/tiny — vùng giữa (60% còn lại) vẫn đóng lightbox như cũ. Không
        // xung đột với vuốt (onTouchEnd) vì thao tác vuốt thật có di chuyển đáng kể không
        // bắn ra sự kiện click.
        const onZoneClick = e => {
          if (images.length <= 1) { setLightbox(null); return; }
          const w = window.innerWidth;
          if (e.clientX < w * 0.2) prev();
          else if (e.clientX > w * 0.8) next();
          else setLightbox(null);
        };
        return (
          <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd} onClick={onZoneClick}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 1000,
                     display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                     touchAction: lbZoomed ? 'pan-x pan-y pinch-zoom' : 'pinch-zoom' }}>
            {images.length > 1 && (
              <button onClick={e => { e.stopPropagation(); prev(); }}
                style={{ position: 'fixed', left: 8, top: '50%', transform: 'translateY(-50%)',
                         background: 'rgba(90,90,90,0.55)', border: 'none', color: '#fff',
                         borderRadius: '50%', width: 44, height: 44, fontSize: 22, cursor: 'pointer', zIndex: 1001,
                         WebkitTapHighlightColor: 'transparent', outline: 'none' }}>‹</button>
            )}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img src={lightboxSrc} alt=""
                style={{ maxWidth: '100vw', maxHeight: '90vh', objectFit: 'contain',
                         borderRadius: 8, userSelect: 'none', display: 'block' }} />
            </div>
            {images.length > 1 && (
              <button onClick={e => { e.stopPropagation(); next(); }}
                style={{ position: 'fixed', right: 8, top: '50%', transform: 'translateY(-50%)',
                         background: 'rgba(90,90,90,0.55)', border: 'none', color: '#fff',
                         borderRadius: '50%', width: 44, height: 44, fontSize: 22, cursor: 'pointer', zIndex: 1001,
                         WebkitTapHighlightColor: 'transparent', outline: 'none' }}>›</button>
            )}
            {images.length > 1 && (
              <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                {images.map((_, i) => (
                  <div key={i} onClick={() => setLightbox({ images, index: i, buyUrl, clickedIndex, clickedSrc })}
                    style={{ width: 8, height: 8, borderRadius: '50%',
                             background: i === index ? '#fff' : 'rgba(255,255,255,0.4)', cursor: 'pointer' }} />
                ))}
              </div>
            )}
            <button onClick={() => setLightbox(null)}
              style={{ position: 'absolute', top: 48, right: 16, background: 'rgba(90,90,90,0.55)',
                       border: 'none', color: '#fff', borderRadius: '50%',
                       width: 36, height: 36, fontSize: 18, cursor: 'pointer' }}>✕</button>
            {buyUrl && (
              <a href={buyUrl} target="_blank" rel="noopener noreferrer"
                onClick={e => e.stopPropagation()} className="lb-review"
                style={{ marginTop: 12, background: '#EE4D2D', color: '#fff', fontSize: 15, fontWeight: 700,
                         textDecoration: 'none', textAlign: 'center', padding: '12px 64px',
                         borderRadius: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                         WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#FFC107" stroke="white" strokeWidth="1" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279-7.416-4.021-7.417 4.021 1.481-8.279-6.064-5.828 8.332-1.151z"/>
                </svg>
                Xem đánh giá
              </a>
            )}
          </div>
        );
      })()}

      {/* Header chính — luôn hiện trên cả mobile lẫn desktop */}
      <div className="main-header"
        style={{ background: '#fff', borderBottom: '1px solid #e0e0e0',
                    position: 'sticky', top: 0, zIndex: 10,
                    padding: scrolled ? '3px 16px' : '14px 16px',
                    transition: 'padding 0.25s ease',
                    display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src={SITE_LOGO} alt="logo" fetchPriority="high" width={32} height={32}
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          style={{ width: 32, height: 32, objectFit: 'contain', flexShrink: 0, cursor: 'pointer',
                   WebkitTapHighlightColor: 'transparent', outline: 'none' }} />
        <div style={{ minWidth: 0, flex: 1, cursor: 'pointer', userSelect: 'none',
                      WebkitTapHighlightColor: 'transparent', outline: 'none' }}
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <div style={{ fontSize: 20, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        letterSpacing: '-0.01em', lineHeight: 1.15 }}>
            <span style={{ fontWeight: 800, letterSpacing: '-0.02em',
                           background: 'linear-gradient(120deg, #EE4D2D 0%, #FF8A50 100%)',
                           WebkitBackgroundClip: 'text', backgroundClip: 'text',
                           WebkitTextFillColor: 'transparent', color: '#EE4D2D' }}>Sdeal</span>
            <span style={{ fontWeight: 700, fontSize: '0.6em', color: '#767b80', background: '#eef0f2',
                           padding: '0px 3px 0px', borderRadius: 5, marginLeft: 0,
                           letterSpacing: 0, position: 'relative', top: -1, display: 'inline-block' }}>.vn</span>
          </div>
          <div className="header-sub" style={{ fontSize: 11, color: '#65676b' }}>Shopee Deal - Cập nhật deal Shopee nhanh nhất</div>
        </div>
        <button className="desktop-search-box"
          onClick={() => { setShowSearch(true); setTimeout(() => searchInputRef.current?.focus(), 100); }}
          style={{ display: 'none', alignItems: 'center', gap: 8, background: '#f0f2f5',
                   border: 'none', borderRadius: 20, padding: '9px 16px', minWidth: 220,
                   cursor: 'pointer', color: '#8a8d91', fontSize: 14, flexShrink: 0,
                   WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8a8d91"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="10" cy="10" r="7"/><line x1="21" y1="21" x2="16" y2="16"/>
          </svg>
          <span>Tìm deals...</span>
        </button>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button className="mobile-search-btn"
            onClick={() => { setShowSearch(true); setTimeout(() => searchInputRef.current?.focus(), 100); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', width: 36, height: 36,
                     display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                     WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0068ff"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="10" cy="10" r="8"/><line x1="23" y1="23" x2="16" y2="16"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Feed */}
      <div style={{ padding: '3px 3px', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {loading && Array.from({ length: 3 }).map((_, i) => (
          <div key={i} style={{ background: '#fff', borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#e0e0e0', animation: 'pulse 1.5s infinite' }} />
              <div style={{ flex: 1 }}>
                <div style={{ height: 12, background: '#e0e0e0', borderRadius: 6, width: '40%', marginBottom: 6 }} />
                <div style={{ height: 10, background: '#e0e0e0', borderRadius: 6, width: '25%' }} />
              </div>
            </div>
            <div style={{ height: 14, background: '#e0e0e0', borderRadius: 6, marginBottom: 8 }} />
            <div style={{ height: 14, background: '#e0e0e0', borderRadius: 6, width: '80%' }} />
          </div>
        ))}

        {!loading && dedupedPosts.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#65676b' }}>Chưa có bài đăng nào</div>
        )}

        {dedupedPosts.map((post, postIndex) => (
          <div key={post.id} ref={el => { postRefs.current[post.id] = el; }}
            style={{ background: '#fff', borderRadius: 12, overflow: 'hidden',
                     boxShadow: highlightId === post.id
                       ? '0 0 0 3px #0068ff' : '0 1px 3px rgba(0,0,0,0.08)',
                     transition: 'box-shadow 0.4s' }}>
            <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <img src={post.senderAvatar || DEFAULT_AVATAR} alt=""
                style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }}
                onError={e => { e.target.onerror = null; e.target.src = DEFAULT_AVATAR; }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#1c1e21' }}>{post.senderName}</div>
                <div style={{ fontSize: 12, color: '#65676b' }} suppressHydrationWarning>{formatTime(post.createdAt)}</div>
              </div>
              {isAdmin && (
                <button onClick={() => { setEditingPost(post); setEditForm({ content: post.content || '', link: post.link || '' }); }}
                  title="Sửa bài"
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                           padding: '4px 6px', color: '#0068ff', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/>
                  </svg>
                </button>
              )}
              {isAdmin && (
                <button onClick={() => deletePost(post.id)}
                  title="Xoá bài"
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                           padding: '4px 6px', color: '#e53935', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                    <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              )}
              <button onClick={() => {
                const url = `${window.location.origin}/p/${post.id}`;
                navigator.clipboard?.writeText(url).then(() => {
                  setCopyToast(true); setTimeout(() => setCopyToast(false), 2000);
                });
              }} title="Chia sẻ"
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                         padding: '4px 6px', color: '#65676b', flexShrink: 0,
                         display: 'flex', alignItems: 'center' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                </svg>
              </button>
            </div>

            {post.content && (
              <div className="post-content"
                style={{ padding: '0 16px 8px', fontSize: 16, color: '#1c1e21', lineHeight: 1.4 }}
                dangerouslySetInnerHTML={{ __html: renderContent(post.content) }} />
            )}

            {post.link && (
              <div style={{ margin: '0 16px 8px', background: '#f0f2f5', borderRadius: 8,
                            overflow: 'hidden', border: '1px solid #e0e0e0' }}>
                <a href={post.link} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'block', padding: '10px 14px', fontSize: 15, color: '#0068ff',
                           fontWeight: 600, textDecoration: 'none', wordBreak: 'break-all' }}>
                  🔗 {post.link}
                </a>
              </div>
            )}

            {post.images?.length > 0 && (
              <PostImageGrid
                images={getDisplayImages(post.images)}
                priority={postIndex === 0}
                onClickImage={(i, currentSrc) => setLightbox({
                  images: getDisplayImages(post.images), index: i, clickedIndex: i, clickedSrc: currentSrc,
                  buyUrl: post.link || (post.content?.match(/https?:\/\/[^\s]+/) || [])[0] || null
                })}
              />
            )}
          </div>
        ))}

        {!loading && hasMore && (
          <div ref={loadMoreRef} style={{ textAlign: 'center', padding: '16px', color: '#999', fontSize: 14 }}>
            {loadingMore ? '⏳ Đang tải thêm...' : ''}
          </div>
        )}
      </div>

      {/* Search overlay */}
      {showSearch && (
        <div style={{ position: 'fixed', inset: 0, background: '#f0f2f5', zIndex: 200,
                      display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ width: '100%', background: '#fff', borderBottom: '1px solid #e0e0e0' }}>
            <div style={{ maxWidth: 680, margin: '0 auto', padding: '10px 12px',
                          display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', background: '#f0f2f5',
                            borderRadius: 20, padding: '8px 14px', gap: 8 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#65676b"
                  strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input ref={searchInputRef} value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); doSearch(e.target.value); }}
                  placeholder="Tìm kiếm bài viết..."
                  style={{ flex: 1, border: 'none', background: 'transparent',
                           fontSize: 15, outline: 'none', color: '#1c1e21' }} />
                {searchQuery && (
                  <button onClick={() => { setSearchQuery(''); setSearchResults([]); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer',
                             color: '#65676b', padding: 0, fontSize: 16 }}>✕</button>
                )}
              </div>
              <button onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                         color: '#0068ff', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' }}>Huỷ</button>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', width: '100%' }}>
            <div style={{ maxWidth: 680, margin: '0 auto', padding: '12px 8px' }}>
              {searchLoading && <div style={{ textAlign: 'center', padding: 40, color: '#65676b' }}>🔍 Đang tìm...</div>}
              {!searchLoading && searchQuery.trim().length > 0 && searchQuery.trim().length < 3 && (
                <div style={{ textAlign: 'center', padding: 40, color: '#65676b' }}>Từ khoá quá ngắn...</div>
              )}
              {!searchLoading && searchQuery.trim().length >= 3 && searchResults.length === 0 && (
                <div style={{ textAlign: 'center', padding: 40, color: '#65676b' }}>Không tìm thấy bài viết nào</div>
              )}
              {!searchLoading && searchResults.length > 0 && (
                <div style={{ fontSize: 13, color: '#65676b', padding: '0 4px 4px' }}>
                  Tìm thấy {searchResults.length} Deals mới nhất
                </div>
              )}
              {!searchLoading && !searchQuery && (
                <div style={{ textAlign: 'center', padding: 40, color: '#65676b' }}>Nhập từ khoá để tìm kiếm</div>
              )}
              {searchResults.map(post => {
                const buyUrl = post.link || (post.content?.match(/https?:\/\/[^\s]+/) || [])[0] || null;
                return (
                  <div key={post.id} style={{ background: '#fff', borderRadius: 12, overflow: 'hidden',
                                             boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: 12 }}>
                    <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <img src={post.senderAvatar || DEFAULT_AVATAR} alt=""
                        onError={e => { e.target.src = DEFAULT_AVATAR; }}
                        style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#1c1e21' }}>{post.senderName}</div>
                        <div style={{ fontSize: 12, color: '#65676b' }} suppressHydrationWarning>{formatTime(post.createdAt)}</div>
                      </div>
                      <button onClick={() => {
                        const url = `${window.location.origin}/p/${post.id}`;
                        navigator.clipboard?.writeText(url).then(() => {
                          setCopyToast(true); setTimeout(() => setCopyToast(false), 2000);
                        });
                      }} title="Chia sẻ"
                        style={{ background: 'none', border: 'none', cursor: 'pointer',
                                 padding: '4px 6px', color: '#65676b', flexShrink: 0,
                                 display: 'flex', alignItems: 'center' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                        </svg>
                      </button>
                    </div>
                    {post.content && (
                      <div className="post-content"
                        style={{ padding: '0 16px 8px', fontSize: 16, color: '#1c1e21', lineHeight: 1.4 }}
                        dangerouslySetInnerHTML={{ __html: renderContent(post.content) }} />
                    )}
                    {post.link && (
                      <div style={{ margin: '0 16px 8px', background: '#f0f2f5', borderRadius: 8,
                                    overflow: 'hidden', border: '1px solid #e0e0e0' }}>
                        <a href={post.link} target="_blank" rel="noopener noreferrer"
                          style={{ display: 'block', padding: '10px 14px', fontSize: 15, color: '#0068ff',
                                   fontWeight: 600, textDecoration: 'none', wordBreak: 'break-all' }}>
                          🔗 {post.link}
                        </a>
                      </div>
                    )}
                    {post.images?.length > 0 && (
                      <PostImageGrid images={getDisplayImages(post.images)} priority={false}
                        onClickImage={(i, currentSrc) => setLightbox({ images: getDisplayImages(post.images), index: i, clickedIndex: i, clickedSrc: currentSrc, buyUrl })} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {copyToast && (
        <div style={{ position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)',
                      background: 'rgba(0,0,0,0.8)', color: '#fff', borderRadius: 20,
                      padding: '10px 20px', fontSize: 14, fontWeight: 600,
                      zIndex: 2000, whiteSpace: 'nowrap' }}>
          ✅ Đã copy link bài viết
        </div>
      )}

      {editingPost && (
        <div onClick={() => !savingEdit && setEditingPost(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2100,
                   display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 16, padding: 20, maxWidth: 420, width: '100%',
                     boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 14 }}>✏️ Sửa bài viết</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 6 }}>Nội dung</div>
            <textarea value={editForm.content}
              onChange={e => setEditForm(f => ({ ...f, content: e.target.value }))}
              rows={6}
              style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #e0e0e0', borderRadius: 8,
                       padding: 10, fontSize: 14, fontFamily: 'inherit', resize: 'vertical', marginBottom: 12 }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 6 }}>Link sản phẩm</div>
            <input value={editForm.link}
              onChange={e => setEditForm(f => ({ ...f, link: e.target.value }))}
              style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #e0e0e0', borderRadius: 8,
                       padding: 10, fontSize: 14, marginBottom: 16 }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setEditingPost(null)} disabled={savingEdit}
                style={{ flex: 1, background: '#f0f2f5', color: '#333', border: 'none', borderRadius: 10,
                         padding: '10px 0', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Huỷ</button>
              <button onClick={saveEditPost} disabled={savingEdit}
                style={{ flex: 1, background: '#0068ff', color: '#fff', border: 'none', borderRadius: 10,
                         padding: '10px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                         opacity: savingEdit ? 0.7 : 1 }}>{savingEdit ? 'Đang lưu...' : 'Lưu'}</button>
            </div>
          </div>
        </div>
      )}

      {showNewToast && (
        <div onClick={handleNewToastClick}
             style={{ position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)',
                      background: '#0068ff', color: '#fff', borderRadius: 24,
                      padding: '10px 24px', fontSize: 14, fontWeight: 700,
                      zIndex: 2000, cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,104,255,0.4)',
                      display: 'flex', alignItems: 'center', gap: 8, animation: 'slideUp 0.3s ease-out' }}>
          ✨ Có deal mới
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15"/>
          </svg>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes slideUp { from { transform: translate(-50%, 100%); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        .post-content { line-height: 1.4; }
        .post-content p { margin: 1px 0; }
        @media(min-width:681px){
          .feed-img { transition: transform 0.25s ease; }
          .feed-img:hover { transform: scale(1.04); }
          .feed-img-wrap { overflow: hidden; }
        }
        @media(min-width:681px){ .lb-review { display: none !important; } }
        @media(min-width:681px){ .desktop-search-box { display: flex !important; } .mobile-search-btn { display: none !important; } }
      `}</style>
    </div>
    </>
  );
}
