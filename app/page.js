'use client';

const DEFAULT_AVATAR = '/logo.png';
const SITE_LOGO      = '/logo.png';
const PAGE_SIZE      = 3;
// Realtime listener chỉ theo dõi đúng 1 bài mới nhất (thay vì cả PAGE_SIZE) — giảm hẳn
// số Firestore reads mỗi khi có tab mới mở (initial snapshot) hoặc có bài mới đăng.
// Các vị trí còn lại trong cửa sổ hiển thị (#2, #3...) lấy từ Worker KV (xem mergeWithKvTail).
const REALTIME_TOP_N = 1;

import { useEffect, useState, useRef, useCallback } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentSingleTabManager,
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
function getDb() {
  if (_db) return _db;
  const app = getApp();
  try {
    _db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
    });
  } catch {
    _db = getFirestore(app); // fallback nếu đã init
  }
  return _db;
}
function getAuthInstance() { return getAuth(getApp()); }

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

function PostImageGrid({ images, onClickImage, priority }) {
  const n = images.length;
  if (n === 0) return null;

  const [activeIdx, setActiveIdx] = useState(0);
  const [isDesktop, setIsDesktop] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth > 680);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const imgProps = (i) => ({
    loading:       priority && i === 0 ? 'eager' : 'lazy',
    fetchPriority: priority && i === 0 ? 'high'  : 'auto',
  });

  if (n === 1) {
    return (
      <div className="feed-img-wrap" data-swipe-ignore style={{ background: '#f5f5f5', lineHeight: 0, textAlign: 'center' }}>
        <img src={images[0]} alt="" {...imgProps(0)} onClick={() => onClickImage(0)}
          className="feed-img"
          onLoad={(e) => {
            const img = e.target;
            const isDesktop = window.innerWidth > 680;
            if (!isDesktop) return;
            const ratio = img.naturalWidth / img.naturalHeight;
            if (ratio < 1) {
              // Ảnh dọc: width tự nhiên, căn giữa
              img.style.width = 'auto';
              img.style.maxWidth = '100%';
              img.style.maxHeight = '80vh';
            } else {
              // Ảnh ngang: full width
              img.style.width = '100%';
              img.style.maxHeight = '80vh';
            }
          }}
          style={{ width: '100%', height: 'auto', maxHeight: '80vh',
                   cursor: 'zoom-in', display: 'inline-block' }} />
      </div>
    );
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
        <img src={src} alt="" {...imgProps(i)} onClick={() => onClickImage(i)} onLoad={onImgLoad(cropPos)}
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
          <img src={images[0]} alt="" {...imgProps(0)} onClick={() => onClickImage(0)} onLoad={onImgLoad()}
            style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center', cursor: 'zoom-in', display: 'block' }} />
        </div>
        {[1, 2].map(i => cell(images[i], i))}
      </div>
    );
    if (n === 4) return (
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 2 }}>
        <div style={{ gridRow: '1 / 4', overflow: 'hidden', background: '#f5f5f5' }}>
          <img src={images[0]} alt="" {...imgProps(0)} onClick={() => onClickImage(0)} onLoad={onImgLoad()}
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
              <img src={images[i]} alt="" {...imgProps(i)} onClick={() => onClickImage(i)} onLoad={onImgLoad()}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'center', cursor: 'zoom-in' }} />
              {i === 4 && n > 5 && <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 24, fontWeight: 700 }}>+{n - 5}</div>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Mobile: Threads-style horizontal scroll cho 2+ ảnh
  const onScroll = (e) => {
    const el = e.currentTarget;
    const idx = Math.round(el.scrollLeft / el.offsetWidth);
    setActiveIdx(idx);
  };

  return (
    <div style={{ position: 'relative' }}>
      {/* Scroll container */}
      <div ref={scrollRef} onScroll={onScroll} data-swipe-ignore
        style={{ display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory',
                 scrollBehavior: 'smooth', WebkitOverflowScrolling: 'touch',
                 msOverflowStyle: 'none', scrollbarWidth: 'none' }}>
        {images.map((src, i) => {
          const isLast = i === images.length - 1;
          return (
            <div key={i}
              style={{ flexShrink: 0,
                       width: '85%',
                       marginRight: 8,
                       scrollSnapAlign: isLast ? 'end' : 'start',
                       position: 'relative',
                       paddingBottom: '85%',
                       background: '#f5f5f5', overflow: 'hidden',
                       borderRadius: 12 }}>
              <img src={src} alt="" {...imgProps(i)}
                onClick={() => onClickImage(i)}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
                         objectFit: i === 0 ? 'cover' : 'contain',
                         objectPosition: i === 0 ? 'left bottom' : 'center',
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

export default function NewsPage() {
  const [posts,         setPosts]         = useState([]);
  const postsRef = useRef([]);
  useEffect(() => { postsRef.current = posts; }, [posts]);
  const [loading,       setLoading]       = useState(true);
  const [loadingMore,   setLoadingMore]   = useState(false);
  const [hasMore,       setHasMore]       = useState(true);
  const kvPoolRef = useRef(null); // cache bài cũ hơn (từ Worker KV) dùng cho "load more"
  const [lightbox,      setLightbox]      = useState(null);
  const [lbZoomed,      setLbZoomed]      = useState(false); // đang pinch-zoom trong lightbox
  const [scrolled,      setScrolled]      = useState(false);
  const [highlightId,   setHighlightId]   = useState(null);
  const [copyToast,     setCopyToast]     = useState(false);
  const [isAdmin,       setIsAdmin]       = useState(false);
  const [editingPost,   setEditingPost]   = useState(null); // post đang được admin sửa
  const [editForm,      setEditForm]      = useState({ content: '', link: '' });
  const [savingEdit,    setSavingEdit]    = useState(false);
  const swipeStartRef   = useRef(null);
  const swipeXRef       = useRef(0);
  const isSwipingRef    = useRef(false);
  const pageRef         = useRef(null);
  const swipeHintRef    = useRef(null);
  const [showSearch,    setShowSearch]    = useState(false);
  const [searchQuery,   setSearchQuery]   = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [hasNewAtTop,   setHasNewAtTop]   = useState(false);
  const [showNewToast,  setShowNewToast]  = useState(false);
  const [showContact,   setShowContact]   = useState(false);
  const [installEvt,      setInstallEvt]      = useState(null);
  const [showInstallBtn,  setShowInstallBtn]  = useState(false);
  const [installPlatform, setInstallPlatform] = useState(null); // 'android' | 'ios'
  const [showIosGuide,    setShowIosGuide]    = useState(false);

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

  // Ghép bài mới nhất (đọc trực tiếp Firestore realtime, luôn đúng ngay lập tức) với các
  // bài kế tiếp lấy từ Worker KV (đủ mới, không tốn thêm Firestore reads) để dựng cửa sổ
  // hiển thị ban đầu/khi resync — thay vì đọc cả PAGE_SIZE bài từ Firestore mỗi lần.
  async function mergeWithKvTail(primaryPosts, size) {
    try {
      if (!kvPoolRef.current) kvPoolRef.current = await getPostsCache();
    } catch (_) {
      kvPoolRef.current = kvPoolRef.current || [];
    }
    const primaryIds = new Set(primaryPosts.map(p => p.id));
    const tail = kvPoolRef.current.filter(p => !primaryIds.has(p.id)).slice(0, Math.max(0, size - primaryPosts.length));
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

  // Đăng ký service worker — Chrome CHỈ coi trang là "installable" (điều kiện bắt buộc
  // để beforeinstallprompt tự bắn ra) khi có service worker với fetch handler. Thiếu nó,
  // nút "Tải App" trên Android sẽ luôn rơi vào nhánh hướng dẫn tay dù trình duyệt hỗ trợ.
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  // Nút "Tải App" — Android/Chrome dùng beforeinstallprompt để hiện popup cài đặt gốc
  // của trình duyệt (chỉ bắn ra khi trình duyệt tự xét đủ điều kiện + có thể cần user
  // tương tác với site trước, không phải lúc nào cũng có ngay). iOS Safari KHÔNG có API
  // nào để tự bấm cài (giới hạn của Apple). Với 2 trường hợp trên chưa có prompt thật,
  // vẫn hiện nút và mở hướng dẫn tự thao tác, để nút không bao giờ "biến mất" khó hiểu.
  useEffect(() => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
    if (isStandalone) return; // đã cài rồi, không hiện nút nữa

    setShowInstallBtn(true);
    setInstallPlatform(isIOS ? 'ios' : 'other');

    const onBeforeInstall = (e) => {
      e.preventDefault();
      setInstallEvt(e);
      setInstallPlatform('android');
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  const handleInstallClick = async () => {
    if (installEvt) {
      installEvt.prompt();
      await installEvt.userChoice;
      setInstallEvt(null);
      setInstallPlatform('other');
      return;
    }
    setShowIosGuide(true); // chưa có prompt thật (iOS hoặc trình duyệt chưa bắn event) → hướng dẫn tự thao tác
  };

  useEffect(() => {
    const auth = getAuthInstance();
    return onAuthStateChanged(auth, async user => {
      if (!user) { setIsAdmin(false); sessionStorage.removeItem('isAdmin'); return; }
      const cached = sessionStorage.getItem('isAdmin');
      if (cached !== null) { setIsAdmin(cached === '1'); return; }
      const snap  = await getDoc(doc(getDb(), 'users', user.uid));
      const admin = snap.data()?.role === 'admin';
      sessionStorage.setItem('isAdmin', admin ? '1' : '0');
      setIsAdmin(admin);
    });
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
        const merged = await mergeWithKvTail(fresh, PAGE_SIZE);
        setPosts(merged);
        setLoading(false);
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
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      if (!kvPoolRef.current) kvPoolRef.current = await getPostsCache();
      const shownIds  = new Set(postsRef.current.map(p => p.id));
      const remaining = kvPoolRef.current.filter(p => !shownIds.has(p.id));
      const next      = remaining.slice(0, PAGE_SIZE);
      if (next.length > 0) setPosts(prev => [...prev, ...next]);
      setHasMore(remaining.length > next.length);
    } catch (e) {
      console.error('[feed] load more lỗi:', e);
    } finally {
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
    if (!hasMore || loadingMore || posts.length < 2) return;
    const triggerPost = posts[posts.length - 2];
    const el = postRefs.current[triggerPost?.id];
    if (!el) return;

    const observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) handleLoadMore(); },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [posts, hasMore, loadingMore]);

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

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  useEffect(() => {
    setIsLoggedIn(localStorage.getItem('isLoggedIn') === 'true');
  }, []);
  const swipeTarget = isLoggedIn ? '/login#mine' : '/login';

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const applyTransform = (dx) => {
      const w = window.innerWidth;
      // Panel trượt vào từ bên phải (pageRef không transform để tránh lỗi fixed positioning)
      if (swipeHintRef.current) {
        const pct = Math.max(0, 100 - (dx / w) * 100);
        swipeHintRef.current.style.transform = `translateX(${pct}%)`;
        swipeHintRef.current.style.display = dx > 5 ? 'flex' : 'none';
        const threshold = w * 0.5;
        const label = swipeHintRef.current.querySelector('.swipe-label');
        if (label) label.textContent = dx >= threshold ? '✓ Thả để mở' : isLoggedIn ? 'Đơn của tôi' : 'Đăng nhập';
        // Shadow bên trái của panel để tạo chiều sâu
        swipeHintRef.current.style.boxShadow = `-4px 0 16px rgba(0,0,0,${Math.min(0.2, dx / w * 0.3)})`;
      }
    };

    const onStart = (e) => {
      if (window.innerWidth > 680) return;
      // Bỏ qua nếu touch bắt đầu trên ảnh hoặc carousel
      const target = e.target;
      if (target.tagName === 'IMG' || target.closest('[data-swipe-ignore]')) return;
      swipeStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      isSwipingRef.current = false;
      swipeXRef.current = 0;
      if (swipeHintRef.current) swipeHintRef.current.style.transition = 'none';
    };

    const onMove = (e) => {
      if (!swipeStartRef.current || window.innerWidth > 680) return;
      const dx = swipeStartRef.current.x - e.touches[0].clientX;
      const dy = Math.abs(swipeStartRef.current.y - e.touches[0].clientY);
      if (dx < 10) return;
      if (dy > dx * 0.8) { swipeStartRef.current = null; return; }
      isSwipingRef.current = true;
      e.preventDefault(); // ngăn scroll dọc khi đang swipe ngang
      swipeXRef.current = Math.min(dx, window.innerWidth);
      applyTransform(swipeXRef.current);
    };

    const onEnd = () => {
      if (!isSwipingRef.current) {
        swipeStartRef.current = null;
        applyTransform(0);
        return;
      }
      const threshold = window.innerWidth * 0.5;
      if (swipeHintRef.current) swipeHintRef.current.style.transition = 'transform 0.25s ease';
      if (swipeXRef.current >= threshold) {
        applyTransform(window.innerWidth);
        setTimeout(() => { window.location.href = swipeTarget; }, 220);
      } else {
        applyTransform(0);
        setTimeout(() => {
          if (swipeHintRef.current) swipeHintRef.current.style.display = 'none';
        }, 260);
      }
      isSwipingRef.current = false;
      swipeStartRef.current = null;
      swipeXRef.current = 0;
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };
  }, [swipeTarget]);

  return (
    <>
    {/* Swipe page preview — nằm NGOÀI pageRef để tránh bị ảnh hưởng bởi transform */}
    <div ref={swipeHintRef} style={{
        display: 'none', position: 'fixed', right: 0, top: 0, bottom: 0,
        zIndex: 998, width: '100%', pointerEvents: 'none',
        background: '#f0f2f5', transform: 'translateX(100%)',
        flexDirection: 'column', overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        {isLoggedIn ? (
          /* ── Preview: Đơn của tôi ── */
          <>
            {/* Header */}
            <div style={{ background: '#EE4D2D', padding: '12px 16px',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>🛍️ Sandeal</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', background: 'rgba(255,255,255,0.15)',
                            borderRadius: 20, padding: '3px 10px' }}>Tài khoản</div>
            </div>
            {/* Wallet card */}
            <div style={{ margin: 12, background: 'linear-gradient(135deg,#EE4D2D,#ff7043)',
                          borderRadius: 16, padding: '16px', color: '#fff', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <span style={{ fontSize: 20 }}>👋</span>
                <span style={{ fontSize: 16, fontWeight: 700 }}>Xin chào!</span>
              </div>
              <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4 }}>Số dư hoàn tiền</div>
              <div style={{ fontSize: 28, fontWeight: 800 }}>0 ₫</div>
            </div>
            {/* Danh sách đơn giả */}
            {[1,2].map(i => (
              <div key={i} style={{ margin: '0 12px 8px', background: '#fff', borderRadius: 12, padding: 12,
                                    display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
                <div style={{ width: 44, height: 44, borderRadius: 8, background: '#f5f5f5',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>📦</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ height: 12, background: '#f0f0f0', borderRadius: 6, marginBottom: 6, width: '70%' }} />
                  <div style={{ height: 10, background: '#f0f0f0', borderRadius: 6, width: '45%' }} />
                </div>
                <div style={{ width: 60, height: 22, background: '#fff3f0', borderRadius: 6,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 10, color: '#EE4D2D', fontWeight: 700, flexShrink: 0 }}>Đang xử lý</div>
              </div>
            ))}
            {/* Bottom nav */}
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 60,
                          background: '#fff', borderTop: '1px solid #eee',
                          display: 'flex', alignItems: 'stretch' }}>
              {[
                { icon: '🔍', label: 'Tìm đơn', active: false },
                { icon: '📦', label: 'Đơn của tôi', active: true },
                { icon: '🎁', label: 'Bonus', active: false },
                { icon: '⚡', label: 'Chuyển đổi', active: false },
              ].map(({ icon, label, active }) => (
                <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column',
                                          alignItems: 'center', justifyContent: 'center', gap: 2,
                                          color: active ? '#EE4D2D' : '#999',
                                          borderTop: active ? '2px solid #EE4D2D' : '2px solid transparent' }}>
                  <span style={{ fontSize: 18 }}>{icon}</span>
                  <span style={{ fontSize: 9, fontWeight: active ? 700 : 400 }}>{label}</span>
                </div>
              ))}
            </div>
            {/* Swipe label */}
            <div className="swipe-label" style={{ position: 'absolute', top: '50%', left: 0, right: 0,
                          textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#EE4D2D',
                          background: 'rgba(255,255,255,0.9)', padding: '6px 0', transform: 'translateY(-50%)' }}>
              Đơn của tôi
            </div>
          </>
        ) : (
          /* ── Preview: Đăng nhập ── */
          <>
            <div style={{ flexShrink: 0 }}>
              <img src="/headerbanner.png" alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
            </div>
            <div style={{ margin: 12, background: '#fff', borderRadius: 16, padding: 16, flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #eee', marginBottom: 14 }}>
                {['Đăng nhập', 'Đăng ký'].map((t, i) => (
                  <div key={t} style={{ flex: 1, textAlign: 'center', paddingBottom: 10, fontSize: 14, fontWeight: 700,
                                        color: i === 0 ? '#EE4D2D' : '#999',
                                        borderBottom: i === 0 ? '2px solid #EE4D2D' : 'none',
                                        marginBottom: -2 }}>{t}</div>
                ))}
              </div>
              {/* Input giả */}
              {['Email', 'Mật khẩu'].map(p => (
                <div key={p} style={{ height: 42, background: '#f5f5f5', borderRadius: 8,
                                      marginBottom: 8, paddingLeft: 12,
                                      display: 'flex', alignItems: 'center',
                                      fontSize: 13, color: '#bbb' }}>{p}</div>
              ))}
              <div style={{ height: 42, background: '#EE4D2D', borderRadius: 8, marginBottom: 12,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#fff', fontWeight: 700, fontSize: 14 }}>Đăng nhập</div>
              <div style={{ height: 42, background: '#0068ff', borderRadius: 8,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#fff', fontWeight: 600, fontSize: 13, gap: 8 }}>
                <span>Đăng nhập bằng Zalo</span>
              </div>
            </div>
            {/* Swipe label */}
            <div className="swipe-label" style={{ textAlign: 'center', fontSize: 13, fontWeight: 700,
                          color: '#EE4D2D', padding: '6px 0' }}>Đăng nhập</div>
          </>
        )}
      </div>

    <div ref={pageRef} style={{ maxWidth: 680, margin: '0 auto', padding: '0 0 40px',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  background: '#f0f2f5', minHeight: '100vh' }}>

      {/* Lightbox */}
      {lightbox && (() => {
        const { images, index, buyUrl } = lightbox;
        const prev = () => setLightbox({ images, index: (index - 1 + images.length) % images.length, buyUrl });
        const next = () => setLightbox({ images, index: (index + 1) % images.length, buyUrl });
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
        return (
          <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd} onClick={() => setLightbox(null)}
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
            <div onClick={e => e.stopPropagation()}
              style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img src={images[index]} alt=""
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
                  <div key={i} onClick={() => setLightbox({ images, index: i, buyUrl })}
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
                onClick={e => e.stopPropagation()} className="lb-buy"
                style={{ marginTop: 12, background: '#EE4D2D', color: '#fff', fontSize: 15, fontWeight: 700,
                         textDecoration: 'none', textAlign: 'center', padding: '12px 64px',
                         borderRadius: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                         WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
                <svg width="20" height="20" viewBox="0 0 16 16" fill="white" xmlns="http://www.w3.org/2000/svg">
                  <path fillRule="evenodd" d="M10.5 3.5a2.5 2.5 0 0 0-5 0V4h5zm1 0V4H15v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V4h3.5v-.5a3.5 3.5 0 1 1 7 0m-.646 5.354a.5.5 0 0 0-.708-.708L7.5 10.793 6.354 9.646a.5.5 0 1 0-.708.708l1.5 1.5a.5.5 0 0 0 .708 0z"/>
                </svg>
                Săn ngay
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
          <div style={{ fontWeight: 700, fontSize: 14, color: '#1c1e21', whiteSpace: 'nowrap',
                        overflow: 'hidden', textOverflow: 'ellipsis' }}>Sdeal.vn</div>
          <div className="header-sub" style={{ fontSize: 11, color: '#65676b' }}>Shopee Deal</div>
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
          <a href="https://www.facebook.com/TODO_FANPAGE_MOI" target="_blank"
            rel="noopener noreferrer" title="Fanpage Facebook"
            style={{ position: 'relative', width: 36, height: 36, textDecoration: 'none', display: 'flex',
                     alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                     WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            <span style={{ position: 'absolute', top: 3, right: 3, width: 9, height: 9,
                           background: '#ff3b30', borderRadius: '50%' }}></span>
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="#1877f2">
              <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
            </svg>
          </a>
          <a href="/login" title="Đăng nhập"
            style={{ width: 36, height: 36, textDecoration: 'none', display: 'flex',
                     alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                     WebkitTapHighlightColor: 'transparent', outline: 'none' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="#EE4D2D"
                 stroke="none">
              <circle cx="12" cy="8" r="4"/>
              <path d="M12 14c-4.42 0-8 1.79-8 4v2h16v-2c0-2.21-3.58-4-8-4z"/>
            </svg>
          </a>
        </div>
      </div>

      {/* Floating Contact Button */}
      <div className="gift-fab" style={{ position: 'fixed', bottom: 24, zIndex: 1000,
                    visibility: lightbox ? 'hidden' : 'visible',
                    opacity: lightbox ? 0 : 1, transition: 'opacity 0.2s',
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
        {/* Các nút liên hệ — hiện khi mở */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end',
                      overflow: 'hidden', maxHeight: showContact ? 170 : 0,
                      opacity: showContact ? 1 : 0,
                      transition: 'max-height 0.28s ease, opacity 0.22s ease',
                      pointerEvents: showContact ? 'auto' : 'none' }}>
          {showInstallBtn && (
            <button onClick={() => { setShowContact(false); handleInstallClick(); }}
              className="contact-link"
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#EE4D2D', color: '#fff',
                       borderRadius: 24, padding: '8px 16px', fontSize: 13, fontWeight: 700,
                       border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>
              </svg>
              Tải App
            </button>
          )}
          <a href="https://zalo.me/g/TODO_NHOM_ZALO_MOI" target="_blank" rel="noopener noreferrer"
            className="contact-link" onClick={() => setShowContact(false)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#0068ff', color: '#fff',
                     borderRadius: 24, padding: '8px 16px', fontSize: 13, fontWeight: 700,
                     textDecoration: 'none', whiteSpace: 'nowrap' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
            </svg>
            Nhóm Zalo
          </a>
          <a href="https://m.me/TODO_FANPAGE_MOI" target="_blank" rel="noopener noreferrer"
            className="contact-link" onClick={() => setShowContact(false)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#0084ff', color: '#fff',
                     borderRadius: 24, padding: '8px 16px', fontSize: 13, fontWeight: 700,
                     textDecoration: 'none', whiteSpace: 'nowrap' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
              <path d="M12 0C5.373 0 0 4.974 0 11.111c0 3.498 1.744 6.614 4.469 8.652V24l4.088-2.242c1.092.3 2.246.464 3.443.464 6.627 0 12-4.974 12-11.111S18.627 0 12 0zm1.191 14.963l-3.055-3.26-5.963 3.26L10.732 8l3.131 3.26L19.752 8l-6.561 6.963z"/>
            </svg>
            Messenger
          </a>
        </div>
        {/* Nút chính */}
        <button onClick={() => setShowContact(v => !v)}
          className="gift-btn"
          style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
                   background: '#0084ff', color: '#fff', border: 'none', outline: 'none',
                   borderRadius: '50%', width: 48, height: 48,
                   cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,132,255,0.45)',
                   WebkitTapHighlightColor: 'transparent',
                   animation: showContact ? 'none' : undefined }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
            <path d="M12 0C5.373 0 0 4.974 0 11.111c0 3.498 1.744 6.614 4.469 8.652V24l4.088-2.242c1.092.3 2.246.464 3.443.464 6.627 0 12-4.974 12-11.111S18.627 0 12 0zm1.191 14.963l-3.055-3.26-5.963 3.26L10.732 8l3.131 3.26L19.752 8l-6.561 6.963z"/>
          </svg>
        </button>
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

        {!loading && posts.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#65676b' }}>Chưa có bài đăng nào</div>
        )}

        {posts.map((post, postIndex) => (
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
                <div style={{ fontSize: 12, color: '#65676b' }}>{formatTime(post.createdAt)}</div>
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
                priority={postIndex < PAGE_SIZE}
                onClickImage={i => setLightbox({
                  images: getDisplayImages(post.images), index: i,
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
                        <div style={{ fontSize: 12, color: '#65676b' }}>{formatTime(post.createdAt)}</div>
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
                        onClickImage={i => setLightbox({ images: getDisplayImages(post.images), index: i, buyUrl })} />
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

      {/* Hướng dẫn cài App cho iOS — Safari không có API tự bấm cài, chỉ có thể hướng dẫn */}
      {showIosGuide && (
        <div onClick={() => setShowIosGuide(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2100,
                   display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 16, padding: 24, maxWidth: 340, width: '100%',
                     boxShadow: '0 10px 40px rgba(0,0,0,0.2)', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>📲</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>Thêm Sandeal vào màn hình chính</div>
            {installPlatform === 'ios' ? (
              <div style={{ fontSize: 14, color: '#444', lineHeight: 1.8, textAlign: 'left', marginBottom: 16 }}>
                1. Bấm nút <b>Chia sẻ</b> ⬆️ ở thanh dưới Safari<br/>
                2. Chọn <b>"Thêm vào MH chính"</b> (Add to Home Screen) ➕<br/>
                3. Bấm <b>Thêm</b> ở góc trên bên phải
              </div>
            ) : (
              <div style={{ fontSize: 14, color: '#444', lineHeight: 1.8, textAlign: 'left', marginBottom: 16 }}>
                1. Bấm menu <b>⋮</b> (hoặc biểu tượng Chia sẻ) trên trình duyệt<br/>
                2. Chọn <b>"Cài đặt ứng dụng"</b> hoặc <b>"Thêm vào màn hình chính"</b><br/>
                3. Xác nhận Cài đặt / Thêm
              </div>
            )}
            <button onClick={() => setShowIosGuide(false)}
              style={{ background: '#EE4D2D', color: '#fff', border: 'none', borderRadius: 10,
                       padding: '10px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer', width: '100%' }}>
              Đã hiểu
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes slideUp { from { transform: translate(-50%, 100%); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        @keyframes gift-ping { 0% { transform: scale(1); opacity: 0.6; } 100% { transform: scale(2); opacity: 0; } }
        @keyframes gift-bounce { 0%,100% { transform: translateY(0) rotate(0deg); } 20% { transform: translateY(-5px) rotate(-6deg); } 40% { transform: translateY(-2px) rotate(4deg); } 60% { transform: translateY(-4px) rotate(-3deg); } 80% { transform: translateY(-1px) rotate(2deg); } }
        .gift-btn { animation: gift-bounce 4s ease-in-out infinite; }
        .gift-btn::before { content:''; position:absolute; inset:0; border-radius:50%; background:#0084ff; animation: gift-ping 3s ease-out infinite; }
        .gift-fab { right: 16px; }
        @media(min-width: 720px) { .gift-fab { right: calc(50% - 360px - 64px); } }
        .contact-link { -webkit-tap-highlight-color: transparent !important; outline: none !important; }
        .contact-link:focus, .contact-link:active, .contact-link:focus-visible { outline: none !important; box-shadow: none !important; background-color: inherit !important; }
        .post-content { line-height: 1.4; }
        .post-content p { margin: 1px 0; }
        @media(min-width:681px){
          .feed-img { transition: transform 0.25s ease; }
          .feed-img:hover { transform: scale(1.04); }
          .feed-img-wrap { overflow: hidden; }
        }
        @media(min-width:681px){ .lb-buy { display: none !important; } }
        @media(min-width:681px){ .desktop-search-box { display: flex !important; } .mobile-search-btn { display: none !important; } }
      `}</style>
    </div>
    </>
  );
}
