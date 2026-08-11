"use client";


export default function Page() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: `window.ENV={apiKey:${JSON.stringify(process.env.NEXT_PUBLIC_FIREBASE_API_KEY)},authDomain:${JSON.stringify(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN)},projectId:${JSON.stringify(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID)},storageBucket:${JSON.stringify(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)},messagingSenderId:${JSON.stringify(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID)},appId:${JSON.stringify(process.env.NEXT_PUBLIC_FIREBASE_APP_ID)}};` }} />
      <script type="module" src="/user.js?v=1.42"></script>
      <div suppressHydrationWarning dangerouslySetInnerHTML={{
        __html: `


  <!-- OPTIMIZATION: Instant Load via LocalStorage -->
  <script>
    try {
      if (localStorage.getItem('isLoggedIn') === 'true') {
        document.documentElement.classList.add('is-logged-in');
      } else {
        document.documentElement.classList.add('not-logged-in');
      }
    } catch(e) {}

    window.pasteOrderId = async function() {
      const el = document.getElementById('orderId');
      el.focus();
      let pasted = false;
      try {
        pasted = document.execCommand('paste');
      } catch(e) {}

      if (!pasted && navigator.clipboard && navigator.clipboard.readText) {
        try {
          const t = await navigator.clipboard.readText();
          if (t) {
            el.value = el.value ? el.value + ' ' + t : t;
            pasted = true;
          }
        } catch(e) {
          console.error('Clipboard API failed:', e);
        }
      }

      if (!pasted) {
        if (/Zalo/i.test(navigator.userAgent)) {
          alert('Zalo chặn tự động dán. Ô nhập đã được chọn sẵn, bạn hãy CHẠM GIỮ vào ô nhập và chọn DÁN (Paste) nhé!');
        } else {
          alert('Trình duyệt chưa cấp quyền dán tự động. Ô nhập đã được chọn, hãy ấn Ctrl+V (trên máy tính) hoặc Chạm Giữ -> Dán (trên điện thoại) nhé!');
        }
      }
    };
  </script>
  <style>
    html.is-logged-in #auth-screen { display: none !important; }
    html.is-logged-in #app-screen { display: block !important; }
    html.not-logged-in #auth-screen { display: flex !important; }
    html.not-logged-in #app-screen { display: none !important; }
    #auth-screen, #app-screen { display: none; } /* Default hide both to prevent flashes */
    #typewriter-logo::after {
      content: '|';
      animation: blink 0.7s step-end infinite;
    }
    #typewriter-logo.done::after { content: ''; }
    @keyframes blink { 50% { opacity: 0; } }
    #typewriter-logo.done {
      background: linear-gradient(90deg, #fff 0%, #fff 35%, #ffeb99 50%, #fff 65%, #fff 100%);
      background-size: 300% auto;
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      animation: shimmer 5s linear infinite;
    }
    @keyframes shimmer {
      0%   { background-position: 200% center; }
      100% { background-position: -200% center; }
    }
    @keyframes wave {
      0%   { transform: rotate(0deg); }
      15%  { transform: rotate(18deg); }
      30%  { transform: rotate(-8deg); }
      45%  { transform: rotate(18deg); }
      60%  { transform: rotate(-4deg); }
      75%  { transform: rotate(12deg); }
      100% { transform: rotate(0deg); }
    }
  </style>


  <script src="/fbdetect.js" defer></script>

  <!-- AUTH -->
  <div id="auth-screen">
    <div class="auth-container">
      <div class="auth-banner">
        <img src="/headerbanner.png" alt="Sdeal.vn - Săn deal Shopee hoàn tiền">
      </div>
      <div class="auth-card">
        <div class="auth-tabs">
          <button class="auth-tab active" onclick="switchTab('login')">Đăng nhập</button>
          <button class="auth-tab" onclick="switchTab('register')">Đăng ký</button>
        </div>
        <div class="auth-body">
          <div id="tab-login">
            <!-- Email/Pass gọn -->
            <div class="fg" style="margin-bottom:8px"><input type="email" id="login-email" placeholder="Email" onkeydown="if(event.key==='Enter')doLogin()" /></div>
            <div class="fg" style="margin-bottom:6px"><input type="password" id="login-pass" placeholder="Mật khẩu" onkeydown="if(event.key==='Enter')doLogin()" /></div>
            <div style="text-align:right;margin-bottom:10px"><a href="#" onclick="showForgotPassword()" style="font-size:12px;color:var(--blue);text-decoration:none">Quên mật khẩu?</a></div>
            <button class="btn-main" onclick="doLogin()" style="margin-bottom:14px">Đăng nhập</button>
            <div class="auth-divider" style="margin:0 0 14px"><span>HOẶC</span></div>
            <div id="login-msg" class="amsg" style="margin-bottom:10px"></div>
            <!-- Zalo -->
            <button onclick="doLoginZalo('login-msg')" style="width:100%;display:flex;align-items:center;justify-content:center;gap:10px;background:#0068ff;border:none;border-radius:10px;padding:12px;cursor:pointer;font-family:inherit;margin-bottom:10px">
              <svg width="20" height="20" viewBox="0 0 460.1 436.3" fill="none"><path d="M230.1 0C103 0 0 92.5 0 206.5C0 268 30.6 323.4 82 359.8C80.2 373.1 72.8 406.8 61.3 430.7C60.2 433 62 435.6 64.5 435.1C91.5 430 139.6 414.5 168.3 395.4C188 401 208.6 404 230.1 404C357.2 404 460.1 311.5 460.1 197.5C460.1 83.5 357.2 0 230.1 0Z" fill="white"/></svg>
              <span style="color:#fff;font-size:14px;font-weight:600">Đăng nhập bằng Zalo</span>
            </button>
            <!-- Google -->
            <button onclick="doLoginGoogle('login-msg')" style="width:100%;display:flex;align-items:center;justify-content:center;gap:10px;background:#fff;border:1.5px solid #e0e0e0;border-radius:10px;padding:11px;cursor:pointer;font-family:inherit">
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/><path fill="none" d="M0 0h48v48H0z"/></svg>
              <span style="font-size:14px;font-weight:600;color:#333">Đăng nhập bằng Google</span>
            </button>
          </div>
          <div id="tab-register" style="display:none">
            <div id="reg-msg" class="amsg" style="margin-bottom:10px"></div>
            <!-- Zalo -->
            <button onclick="doLoginZalo('reg-msg')" style="width:100%;display:flex;align-items:center;justify-content:center;gap:10px;background:#0068ff;border:none;border-radius:10px;padding:13px;cursor:pointer;font-family:inherit;margin-bottom:10px">
              <svg width="20" height="20" viewBox="0 0 460.1 436.3" fill="none"><path d="M230.1 0C103 0 0 92.5 0 206.5C0 268 30.6 323.4 82 359.8C80.2 373.1 72.8 406.8 61.3 430.7C60.2 433 62 435.6 64.5 435.1C91.5 430 139.6 414.5 168.3 395.4C188 401 208.6 404 230.1 404C357.2 404 460.1 311.5 460.1 197.5C460.1 83.5 357.2 0 230.1 0Z" fill="white"/></svg>
              <span style="color:#fff;font-size:14px;font-weight:600">Đăng ký bằng Zalo</span>
            </button>
            <div class="auth-divider" style="margin:0 0 10px"><span>HOẶC</span></div>
            <!-- Google -->
            <button onclick="doLoginGoogle('reg-msg')" style="width:100%;display:flex;align-items:center;justify-content:center;gap:10px;background:#fff;border:1.5px solid #e0e0e0;border-radius:10px;padding:12px;cursor:pointer;font-family:inherit">
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/><path fill="none" d="M0 0h48v48H0z"/></svg>
              <span style="font-size:14px;font-weight:600;color:#333">Đăng ký bằng Google</span>
            </button>
          </div>
          <div id="tab-forgot" style="display:none">
            <div
              style="margin-bottom: 16px; font-size: 13px; color: var(--text-light); text-align: center; line-height: 1.5;">
              Nhập email của bạn để nhận liên kết đặt lại mật khẩu từ hệ thống.
            </div>
            <div class="fg"><label>Email</label><input type="email" id="forgot-email" placeholder="email@example.com" />
            </div>
            <button class="btn-main" onclick="doForgotPassword()">Gửi Email Khôi Phục</button>
            <div style="text-align: center; margin-top: 14px;"><a href="#" onclick="switchTab('login')"
                style="font-size: 13px; color: var(--text-light); text-decoration: none; font-weight: 600;">&larr; Quay
                lại Đăng nhập</a></div>
            <div id="forgot-msg" class="amsg"></div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- APP -->
  <div id="app-screen">
    <div class="header">
      <a href="/" class="header-logo" style="text-decoration:none;color:inherit">🛍️ <span id="typewriter-logo"></span></a>
      <div class="header-right" style="position:relative">
        <span class="uname" id="header-uname" onclick="toggleLogoutMenu()" style="cursor:pointer;user-select:none"></span>
        <div id="logout-menu" style="display:none;position:absolute;top:calc(100% + 6px);right:0;background:#fff;border:1px solid #eee;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,0.12);z-index:50;min-width:130px;overflow:hidden">
          <button onclick="doLogout()" style="width:100%;padding:10px 16px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;color:#e53935;display:flex;align-items:center;gap:8px;font-family:inherit">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
            Đăng xuất
          </button>
        </div>
      </div>
    </div>

    <div class="tab-nav">
      <button class="active" id="nav-search" onclick="showMainTab('search')">🔍 Tìm đơn hàng</button>
      <button id="nav-mine" onclick="showMainTab('mine')">📦 Đơn của tôi <span id="mine-badge"></span></button>
      <button id="nav-bonus" onclick="showMainTab('bonus')" style="position:relative">🎁 Bonus<span id="nav-bonus-badge" class="bonus-active-badge" style="display:none;position:absolute;top:4px;right:-2px;width:10px;height:10px;border-radius:50%"></span></button>
      <button id="nav-convert" onclick="showMainTab('convert')">⚡ Chuyển đổi</button>
    </div>

    <!-- Bottom Nav (mobile only) -->
    <nav class="bottom-nav">
      <button id="bnav-search" class="active" onclick="showMainTab('search')">
        <span class="bnav-icon">
          <svg style="transform: translate(1px, 1px) scale(1.05);" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </span>
        <span class="bnav-label">Tìm đơn</span>
      </button>

      <button id="bnav-mine" onclick="showMainTab('mine')">
        <span class="bnav-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
        </span>
        <span class="bnav-label">Đơn của tôi</span>
      </button>

      <button id="bnav-bonus" onclick="showMainTab('bonus')">
        <span class="bnav-icon" style="position:relative">
          <svg class="bonus-svg-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <!-- Sparkles (hidden by default, animated in CSS) -->
            <path class="sparkle sp-1" d="M 5 1 L 5.5 3.5 L 8 4 L 5.5 4.5 L 5 7 L 4.5 4.5 L 2 4 L 4.5 3.5 Z" fill="#ffb300" stroke="none" opacity="0" />
            <path class="sparkle sp-2" d="M 21 6 L 21.5 7.5 L 23 8 L 21.5 8.5 L 21 10 L 20.5 8.5 L 19 8 L 20.5 7.5 Z" fill="#ffb300" stroke="none" opacity="0" />
            <path class="sparkle sp-3" d="M 4 17 L 4.5 18.5 L 6 19 L 4.5 19.5 L 4 21 L 3.5 19.5 L 2 19 L 3.5 18.5 Z" fill="#ffb300" stroke="none" opacity="0" />
            
            <!-- Gift Box -->
            <g class="gift-box-shape" transform="translate(1.2, 2.4) scale(0.9)">
              <polyline points="20 12 20 22 4 22 4 12"/>
              <rect x="2" y="7" width="20" height="5"/>
              <line x1="12" y1="22" x2="12" y2="7"/>
              <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/>
              <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>
            </g>
          </svg>
          <span id="nav-bonus-badge-b" class="bonus-active-badge" style="display:none;position:absolute;top:-4px;right:-4px;width:12px;height:12px;border-radius:50%"></span>
        </span>
        <span class="bnav-label">Bonus</span>
      </button>

      <button id="bnav-convert" onclick="showMainTab('convert')">
        <span class="bnav-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
            <polyline points="13 2 13 9 20 9"/>
            <line x1="9" y1="15" x2="15" y2="15"/><line x1="9" y1="12" x2="12" y2="12"/>
          </svg>
        </span>
        <span class="bnav-label">Chuyển đổi</span>
      </button>
    </nav>

    <div class="container">
      <!-- SEARCH TAB -->
      <div id="main-search">
        <a href="https://zalo.me/g/TODO_NHOM_ZALO_MOI" target="_blank" rel="noopener noreferrer" style="display:block;margin:0 -6px 12px -6px;border-radius:12px;overflow:hidden">
          <img src="/truycapzalo.png" alt="Tham gia nhóm Zalo" style="width:100%;height:auto;display:block" />
        </a>
        <div class="card">
          <div class="card-title">🔍 Tìm kiếm đơn hàng</div>
          <div class="guide-links">
            <a href="https://s.shopee.vn/4fswFcE0Mc" target="_blank">🎟️ Mã giảm giá Shopee</a>
            <a href="https://shorten.asia/mTn3wHfD" target="_blank">☕ Mã Highland Coffee</a>
          </div>
          <div style="position: relative; width: 100%;">
            <textarea id="orderId" rows="4"
              placeholder="Nhập ID đơn hàng, cách nhau bằng dấu phẩy hoặc xuống dòng&#10;VD: 250601E7EMYD4X, 250602ABCDE12F"></textarea>
            <button type="button"
              id="btn-paste-mobile"
              onclick="window.pasteOrderId()"
              class="btn-paste-mobile"
              title="Dán từ bộ nhớ tạm">
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-clipboard"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path></svg>
            </button>
            <script>
              (function() {
                var btn = document.getElementById('btn-paste-mobile');
                if (btn && (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function' || /Zalo/i.test(navigator.userAgent))) {
                  btn.style.display = 'none';
                }
              })();
            </script>
          </div>
          <button class="btn-search" id="btn-search" onclick="doSearch()">🔍 Tìm đơn hàng</button>
        </div>
        <div id="search-result"></div>
      </div>

      <!-- MY ORDERS TAB -->
      <div id="main-mine" style="display:none">
        <div class="wallet-card">
          <div class="wallet-content">
            <div class="wallet-greeting" style="display: flex; align-items: center; margin-bottom: 16px;">
              <span style="font-size: 22px; margin-right: 6px; flex-shrink: 0; display: inline-block; animation: wave 2s ease-in-out 1s 3; transform-origin: 70% 80%;">👋</span>
              <h3 style="margin: 0; font-size: 20px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;">Xin chào, <span id="welcome-name"></span>!</h3>
            </div>

            <div class="wallet-top-section" style="display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; margin-bottom: 24px; gap: 16px;">

              <!-- LEFT INFO (Anchored extreme left) -->
              <div class="wallet-left-info" style="display: flex; flex-direction: column; justify-content: center; align-items: flex-start; text-align: left;">
                <p class="wallet-label" style="margin-bottom: 2px; font-size: 13px; font-weight: 500; opacity: 0.9;">Số dư khả dụng</p>
                <div class="wallet-balance-container" style="display: flex; align-items: baseline; gap: 4px;">
                  <div class="wallet-balance" id="sum-avail" style="margin-bottom: 0; font-size: 40px; line-height: 1;">0</div>
                  <span style="font-size: 18px; text-decoration: underline; font-weight: 600; opacity: 0.9;">đ</span>
                </div>
              </div>

              <!-- CENTER DIVIDER (Dead center) -->
              <div class="wallet-divider" style="width: 1px; height: 50px; background: rgba(255,255,255,0.3);"></div>

              <!-- RIGHT IMAGE (Responsive alignment) -->
              <div class="wallet-right-image">
                <svg width="85" height="85" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <linearGradient id="wallet-back" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="rgba(255, 255, 255, 0.5)" />
                      <stop offset="100%" stop-color="rgba(255, 255, 255, 0.15)" />
                    </linearGradient>
                    <linearGradient id="wallet-front" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="rgba(255, 255, 255, 0.8)" />
                      <stop offset="100%" stop-color="rgba(255, 255, 255, 0.3)" />
                    </linearGradient>
                    <linearGradient id="wallet-dark" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="rgba(0, 0, 0, 0.15)" />
                      <stop offset="100%" stop-color="rgba(0, 0, 0, 0.02)" />
                    </linearGradient>
                    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                      <feDropShadow dx="0" dy="6" stdDeviation="5" flood-color="#000" flood-opacity="0.15"/>
                    </filter>
                  </defs>

                  <!-- Back panel (inside of wallet showing slightly) -->
                  <path d="M10,32 L84,32 C87.3,32 90,34.7 90,38 L90,68 C90,71.3 87.3,74 84,74 L10,74 C6.7,74 4,71.3 4,68 L4,38 C4,34.7 6.7,32 10,32 Z" fill="url(#wallet-back)" filter="url(#shadow)" stroke="rgba(255,255,255,0.3)" stroke-width="1.5"/>

                  <!-- Cash sticking out subtly from the top edge -->
                  <rect x="18" y="25" width="58" height="15" rx="3" fill="#ffffff" opacity="0.95" stroke="rgba(255,255,255,0.8)" stroke-width="1.5" filter="url(#shadow)"/>
                  <line x1="25" y1="30" x2="45" y2="30" stroke="rgba(238, 77, 45, 0.4)" stroke-width="2.5" stroke-linecap="round"/>

                  <!-- Front main panel (Men's Bi-fold) -->
                  <path d="M8,38 L86,38 C88.2,38 90,39.8 90,42 L90,72 C90,74.2 88.2,76 86,76 L8,76 C5.8,76 4,74.2 4,72 L4,42 C4,39.8 5.8,38 8,38 Z" fill="url(#wallet-front)" filter="url(#shadow)" stroke="rgba(255,255,255,0.6)" stroke-width="2"/>

                  <!-- Vertical fold line typical of bi-fold wallets (centered) -->
                  <line x1="47" y1="38" x2="47" y2="76" stroke="rgba(0,0,0,0.1)" stroke-width="5"/>
                  <line x1="47" y1="38" x2="47" y2="76" stroke="rgba(255,255,255,0.4)" stroke-width="1.5" stroke-dasharray="3,3"/>

                  <!-- Subtle inner shadow/gradient for right side depth -->
                  <path d="M47,38 L86,38 C88.2,38 90,39.8 90,42 L90,72 C90,74.2 88.2,76 86,76 L47,76 Z" fill="url(#wallet-dark)"/>

                  <!-- Classic Leather Stitching around the edges -->
                  <path d="M10,43 L84,43 L84,71 L10,71 Z" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1" stroke-dasharray="3,3" opacity="0.9"/>

                  <!-- Small embossed logo/badge in the corner -->
                  <rect x="74" y="62" width="8" height="6" rx="2" fill="rgba(255,255,255,0.9)" filter="url(#shadow)"/>
                  <circle cx="78" cy="65" r="1.5" fill="rgba(238, 77, 45, 0.8)"/>

                  <!-- Sparkles -->
                  <path d="M10,12 L12,17 L17,19 L12,21 L10,26 L8,21 L3,19 L8,17 Z" fill="#ffffff" opacity="0.9"/>
                  <path d="M85,15 L86,18 L89,19 L86,20 L85,23 L84,20 L81,19 L84,18 Z" fill="#ffffff" opacity="0.7"/>
                </svg>
              </div>
            </div>
            <div class="wallet-stats-row">
              <div class="stat-item">
                <div class="stat-label">Số đơn</div>
                <div class="stat-value" id="sum-count">0</div>
              </div>
              <div class="stat-item">
                <div class="stat-label">Tổng giá trị</div>
                <div class="stat-value" id="sum-value">0</div>
              </div>
              <div class="stat-item">
                <div class="stat-label">Chiết khấu</div>
                <div class="stat-value" id="sum-disc">0</div>
              </div>
            </div>

            <button class="btn-withdraw-full" onclick="createPaymentRequest()">💳 Yêu Cầu Thanh Toán</button>
          </div>
        </div>
        <div class="card" style="padding:0">
          <div style="padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; background: #fafafa; border-radius: var(--radius) var(--radius) 0 0;">
            <div style="font-size: 15px; font-weight: 700; color: var(--blue); white-space: nowrap;">Danh sách đơn hàng</div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 13px; font-weight: 600; color: var(--text-light);">Lọc:</span>
              <select id="order-filter" onchange="window.renderMyOrders()" style="padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; outline: none; font-family: inherit; font-size: 13px; color: var(--text); background: white;">
                <option value="all">Tất cả đơn</option>
                <option value="paid">Đơn đã thanh toán</option>
                <option value="unpaid" selected>Đơn khác (chưa thanh toán)</option>
              </select>
            </div>
          </div>
          <div id="mine-list" style="background: white; padding: 8px 6px; border-radius: 0 0 var(--radius) var(--radius);">
            <div class="spinner-wrap">
              <div class="spinner"></div>Đang tải...
            </div>
          </div>
        </div>
      </div>

      <!-- BONUS TAB -->
      <div id="main-bonus" style="display:none">
        <div id="ref-section" style="padding:0"></div>
        <div id="main-bonus-content" style="padding:12px 0"></div>
      </div>

      <!-- CONVERT TAB -->
      <div id="main-convert" style="display:none;padding:12px">
        <div class="card">
          <h3 style="margin:0 0 14px;font-size:16px;font-weight:700">⚡ Chuyển đổi Link Affiliate</h3>
          <div style="display:flex;gap:8px;margin-bottom:12px">
            <div style="flex:1">
              <div style="font-size:12px;color:#888;margin-bottom:4px;font-weight:600">Affiliate ID</div>
              <input id="convert-aff-id" type="text" placeholder="VD: 17384040037"
                style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e0e0e0;border-radius:8px;font-size:14px;outline:none"
                oninput="window.saveConvertSettings()" />
            </div>
            <div style="flex:1">
              <div style="font-size:12px;color:#888;margin-bottom:4px;font-weight:600">Sub ID</div>
              <input id="convert-sub-id" type="text" placeholder="VD: sandeal"
                style="width:100%;box-sizing:border-box;padding:8px 10px;border:1.5px solid #e0e0e0;border-radius:8px;font-size:14px;outline:none"
                oninput="window.saveConvertSettings()" />
            </div>
          </div>
          <div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:12px;color:#7a5c00">
            ℹ️ Chỉ hỗ trợ link <b>Shopee</b> và <b>Sandeal</b>. Link từ nguồn khác sẽ bị bỏ qua.
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
            <div style="font-size:12px;color:#888;font-weight:600">Dán text chứa link Shopee hoặc Sandeal</div>
            <button id="convert-clear-btn" onclick="document.getElementById('convert-input').value='';var b=this;b.style.color='#ccc';b.style.fontWeight='400';"
              style="background:none;border:none;font-size:12px;color:#ccc;cursor:pointer;padding:0;font-weight:400;transition:color .15s">🗑 Xoá</button>
          </div>
          <textarea id="convert-input" rows="7" placeholder="Dán text bài viết có link Shopee hoặc Sandeal vào đây..."
            oninput="var b=document.getElementById('convert-clear-btn');if(b){b.style.color=this.value?'#EE4D2D':'#ccc';b.style.fontWeight=this.value?'700':'400';}"
            style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #e0e0e0;border-radius:8px;font-size:14px;resize:vertical;outline:none;font-family:inherit"></textarea>
          <button id="btn-convert" onclick="window.doConvert()"
            style="width:100%;margin-top:10px;padding:12px;background:#EE4D2D;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer">
            ⚡ Chuyển đổi
          </button>
          <div id="convert-status" style="margin-top:8px;font-size:13px;color:#888;text-align:center;min-height:20px"></div>
          <div id="convert-output-wrap" style="display:none;margin-top:12px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
              <div style="font-size:12px;color:#888;font-weight:600">Kết quả</div>
              <button onclick="window.copyConvertOutput()"
                style="background:#4CAF50;color:#fff;border:none;border-radius:6px;padding:4px 12px;font-size:12px;font-weight:600;cursor:pointer">📋 Copy</button>
            </div>
            <div id="convert-output"
              style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #e0e0e0;border-radius:8px;font-size:14px;background:#f9f9f9;font-family:inherit;white-space:pre-wrap;word-break:break-all;line-height:1.6;min-height:48px"></div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="overlay" id="bank-info-modal"
    style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:9999; align-items:center; justify-content:center;">
    <div class="panel card"
      style="background:#fff; width:450px; max-width:90%; padding:24px; border-radius:12px; box-shadow:0 10px 25px rgba(0,0,0,0.2);">
      <h3 style="margin:0 0 12px 0; color:var(--text); font-size:18px;">💳 Thông Tin Nhận Tiền</h3>
      <p style="font-size:13px; color:var(--text-light); margin-bottom:16px; line-height:1.4;">Bạn cần thiết lập thông
        tin ngân hàng trước khi Gửi Yêu Cầu Thanh Toán. <br><b style="color:var(--orange)">Chỉ được nhập 1 lần duy
          nhất</b>.</p>

      <div class="fg">
        <label>Họ và tên chủ tài khoản</label>
        <input type="text" id="bank-fullname" placeholder="VD: NGUYEN VAN A" style="text-transform: uppercase;" />
      </div>
      <div class="fg">
        <label>Ngân hàng nhận tiền</label>
        <select id="bank-name"
          style="width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:8px; font-family:inherit; outline:none; font-size:14px;">
          <option value="">-- Đang tải danh sách ngân hàng... --</option>
        </select>
      </div>
      <div class="fg">
        <label>Số tài khoản</label>
        <input type="text" id="bank-account" placeholder="Nhập chính xác số tài khoản" />
      </div>
      <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:20px;">
        <button class="btn-outline" onclick="document.getElementById('bank-info-modal').style.display='none'"
          style="padding:10px 20px; border-radius:8px; border:1px solid #ccc; background:white; cursor:pointer;">Hủy
          bỏ</button>
        <button class="btn-main" id="btn-save-bank" onclick="saveBankInfo()"
          style="margin-top:0; width:auto; padding:10px 20px;">Lưu Thông Tin</button>
      </div>
    </div>
  </div>

  <!-- PAYMENT CONFIRM MODAL -->
  <div id="pay-confirm-modal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;align-items:center;justify-content:center">
    <div style="background:#fff;border-radius:16px;padding:24px;width:90%;max-width:400px;box-shadow:0 10px 40px rgba(0,0,0,0.2)">
      <h3 style="margin:0 0 16px;font-size:17px;font-weight:700">💳 Xác nhận thanh toán</h3>
      <div style="background:#f7f7f7;border-radius:10px;padding:14px;margin-bottom:14px;font-size:13px;line-height:2">
        <div style="display:flex;justify-content:space-between"><span style="color:#888">Ngân hàng</span><b id="pcm-bank"></b></div>
        <div style="display:flex;justify-content:space-between"><span style="color:#888">Số tài khoản</span><b id="pcm-account"></b></div>
        <div style="display:flex;justify-content:space-between"><span style="color:#888">Chủ tài khoản</span><b id="pcm-name"></b></div>
      </div>
      <div style="background:#fff8e1;border-radius:10px;padding:14px;margin-bottom:16px;font-size:13px;line-height:2">
        <div style="display:flex;justify-content:space-between"><span style="color:#888">Số đơn hàng</span><b id="pcm-orders"></b></div>
        <div style="display:flex;justify-content:space-between"><span style="color:#888">Tổng chiết khấu</span><b id="pcm-disc"></b></div>
        <div id="pcm-bonus-row" style="display:none;justify-content:space-between"><span style="color:#4caf50">🎁 Bonus</span><b id="pcm-bonus" style="color:#4caf50"></b></div>
        <div style="display:flex;justify-content:space-between;border-top:1px dashed #e0e0e0;margin-top:4px;padding-top:4px"><span style="font-weight:700">Tổng nhận</span><b id="pcm-total" style="color:#EE4D2D;font-size:15px"></b></div>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="document.getElementById('pay-confirm-modal').style.display='none'"
          style="flex:1;padding:11px;border:1px solid #ddd;border-radius:10px;background:#fff;font-size:14px;cursor:pointer;font-family:inherit">Huỷ</button>
        <button id="pcm-confirm-btn" onclick="window._confirmPayment && window._confirmPayment()"
          style="flex:2;padding:11px;border:none;border-radius:10px;background:#EE4D2D;color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">✅ Xác nhận</button>
      </div>
    </div>
  </div>

  <script>
    (function() {
      const text = "Sdeal.vn";
      const el = document.getElementById("typewriter-logo");
      if (!el) return;
      let i = 0;
      function type() {
        if (i <= text.length) {
          el.textContent = text.slice(0, i);
          i++;
          setTimeout(type, i === 1 ? 400 : 80);
        } else {
          el.classList.add("done");
        }
      }
      setTimeout(type, 600);
    })();
  </script>
` }} />
    </>
  );
}
