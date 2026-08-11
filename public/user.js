import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile, sendPasswordResetEmail,
  signInWithCustomToken, GoogleAuthProvider, signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, query, where, getDocs, limit, onSnapshot,
  serverTimestamp, runTransaction, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const cfg = {
  apiKey: "AIzaSyCfsn-TswbQt8oYLtCQMh0sZ9m_5CrSJ5E",
  authDomain: "sdeal-vn.firebaseapp.com",
  projectId: "sdeal-vn",
  storageBucket: "sdeal-vn.firebasestorage.app",
  messagingSenderId: "809771190910",
  appId: "1:809771190910:web:faa244f608fa11bf5de62f"
};
const app = initializeApp(cfg);
const auth = getAuth(app);
const db = getFirestore(app);

// Các field bị ẩn khỏi bảng
const EXCLUDE = new Set([
  "Hoa hồng Shopee trên sản phẩm(₫)",
  "Chiết Khấu 2%",
  "userId", "createdAt", "updatedAt", "claimedAt", "_id", "thanhToan"
]);

// Thứ tự cột cố định — luôn hiển thị theo đúng thứ tự này
const COL_ORDER = [
  "ID đơn hàng",
  "Thời Gian Đặt Hàng",
  "Tên Item",
  "Giá trị đơn hàng (₫)",
  "Chiết Khấu",
  "Trạng thái đặt hàng",
];

function escapeHTML(str) {
  if (typeof str !== 'string' && typeof str !== 'number') return '';
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

let me = null, myName = "", myOrders = [], myBankInfo = null;
let cachedUserDoc = null; // Cache cho user document

// ─── CAPTURE REF CODE FROM URL ────────────────────────────
(function () {
  const ref = new URLSearchParams(window.location.search).get('ref');
  if (ref) localStorage.setItem('pendingRef', ref.toUpperCase());
})();

// ─── AUTH STATE ───────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (user) {
    document.documentElement.classList.remove("not-logged-in");
    document.documentElement.classList.add("is-logged-in");

    const isNewLogin = me !== user.uid;
    me = user.uid;
    let uData = {};
    if (cachedUserDoc && cachedUserDoc.uid === user.uid) {
      uData = cachedUserDoc.data;
    } else {
      const snap = await getDoc(doc(db, "users", user.uid));
      uData = snap.exists() ? snap.data() : {};
      // Sau await, Zalo OAuth flow có thể đã set cachedUserDoc với data đầy đủ hơn
      if (cachedUserDoc && cachedUserDoc.uid === user.uid) {
        uData = cachedUserDoc.data;
      } else {
        // Bổ sung loginType từ Firebase Auth provider nếu Firestore chưa có
        if (!uData.loginType) {
          const isGoogle = user.providerData?.some(p => p.providerId === 'google.com');
          if (isGoogle) uData.loginType = 'google';
        }
        cachedUserDoc = { uid: user.uid, data: uData };
      }
    }

    myName = uData.name || user.displayName || user.email;

    document.getElementById("header-uname").textContent = myName;
    document.getElementById("welcome-name").textContent = myName;
    const elAuth = document.getElementById("auth-screen");
    if (elAuth) elAuth.style.display = "none";

    const elApp = document.getElementById("app-screen");
    if (elApp) {
      elApp.style.display = "block";
      localStorage.setItem("isLoggedIn", "true");
    }

    // Check bank info
    if (uData.bankAccount) {
      myBankInfo = { bankFullName: uData.bankFullName, bankName: uData.bankName, bankAccount: uData.bankAccount };
    } else {
      myBankInfo = null;
      window.loadBanksList();
    }

    // Backfill refCode nếu user cũ chưa có
    if (!uData.refCode) {
      const refCode = user.uid.slice(-7).toUpperCase();
      uData.refCode = refCode;
      if (cachedUserDoc?.data) cachedUserDoc.data.refCode = refCode;
      setDoc(doc(db, "users", user.uid), { refCode }, { merge: true });
    }

    if (isNewLogin) await refreshMyOrders();
    await loadMyBonus();
    loadConvertSettings();

    // Điều hướng tab sau login
    if (isNewLogin) {
      const createdAt = uData.createdAt?.toDate ? uData.createdAt.toDate() : (uData.createdAt ? new Date(uData.createdAt) : null);
      const isNewUser = createdAt && (Date.now() - createdAt.getTime() < 2 * 60 * 1000);
      // Chỉ tính là "đang pending" nếu còn hạn kích hoạt — mã pending đã quá
      // activateDeadline coi như chết, không nên cứ mãi kéo user qua tab Bonus
      // (giống đúng logic loại trừ pending quá hạn trong loadMyBonus() ở dưới).
      const hasPendingBonus = myBonusCodes.some(b => {
        if (b.status !== 'pending') return false;
        const dl = b.activateDeadline?.toDate ? b.activateDeadline.toDate().getTime() : (b.activateDeadline ? new Date(b.activateDeadline).getTime() : null);
        return !dl || Date.now() <= dl;
      });
      window.showMainTab && window.showMainTab((isNewUser || hasPendingBonus) ? 'bonus' : 'mine');
    }
  } else {
    document.documentElement.classList.remove("is-logged-in");
    document.documentElement.classList.add("not-logged-in");

    unsubscribeMyBonus();
    me = null;
    const elAuth = document.getElementById("auth-screen");
    if (elAuth) elAuth.style.display = "flex";

    const elApp = document.getElementById("app-screen");
    if (elApp) {
      elApp.style.display = "none";
      localStorage.removeItem("isLoggedIn");
    }
  }
});

// ─── MY ORDERS ────────────────────────────────────────────

/**
 * [Bước 1] Dọn dẹp trùng ID trong chính myOrders:
 * Nếu user có ≥2 bản ghi cùng "ID đơn hàng" và một trong đó là nháp
 * "Không có thông tin" → xóa nháp, gán đơn thật (nếu chưa có userId).
 */
async function cleanupDuplicateDrafts(orders) {
  const groups = {};
  for (const o of orders) {
    const orderId = (o["ID đơn hàng"] || "").trim();
    if (!orderId) continue;
    if (!groups[orderId]) groups[orderId] = [];
    groups[orderId].push(o);
  }

  const toDelete = [], toClaim = [];
  for (const [, group] of Object.entries(groups)) {
    if (group.length >= 2) {
      group.filter(o => o["Tên Item"] === "Không có thông tin").forEach(d => toDelete.push(d._id));
      group.filter(o => o["Tên Item"] !== "Không có thông tin" && !o.userId).forEach(r => toClaim.push(r._id));
    }
  }

  if (!toDelete.length && !toClaim.length) return false;
  if (toDelete.length) {
    await Promise.all(toDelete.map(id => deleteDoc(doc(db, "orders", id))));
    console.log(`[cleanup] Xóa ${toDelete.length} nháp trùng ID:`, toDelete);
  }
  if (toClaim.length) {
    await Promise.all(toClaim.map(id =>
      updateDoc(doc(db, "orders", id), { userId: me, claimedAt: serverTimestamp(), updatedAt: serverTimestamp() })
    ));
    console.log(`[cleanup] Gán ${toClaim.length} đơn thật (nội bộ) cho user:`, toClaim);
  }
  return true;
}

/**
 * [Bước 2] Với mỗi bản nháp "Không có thông tin" còn lại trong myOrders,
 * chủ động query Firestore để tìm đơn thật cùng "ID đơn hàng"
 * — kể cả đơn thật chưa có userId (không nằm trong myOrders).
 * Nếu tìm thấy → xóa nháp + tự động gán đơn thật về user.
 * Không cần user search thủ công.
 * Trả về true nếu có thay đổi.
 */
async function autoClaimRealOrders(orders) {
  const drafts = orders.filter(o => o["Tên Item"] === "Không có thông tin");
  if (!drafts.length) return false;

  let changed = false;

  // Xử lý tuần tự để tránh race condition
  for (const draft of drafts) {
    const orderId = (draft["ID đơn hàng"] || "").trim();
    if (!orderId) continue;

    // Tìm tất cả đơn có cùng "ID đơn hàng" trong toàn bộ Firestore
    const snap = await getDocs(
      query(collection(db, "orders"), where("ID đơn hàng", "==", orderId))
    );

    // Lọc ra đơn thật (không phải bản nháp này, không phải "Không có thông tin")
    const reals = snap.docs
      .map(d => ({ _id: d.id, ...d.data() }))
      .filter(o => o._id !== draft._id && o["Tên Item"] !== "Không có thông tin");

    if (!reals.length) continue; // Chưa có đơn thật → bỏ qua

    // Có đơn thật → xóa bản nháp
    await deleteDoc(doc(db, "orders", draft._id));
    console.log(`[auto-claim] Xóa nháp "${orderId}" (${draft._id})`);

    // Gán các đơn thật chưa có chủ về user hiện tại
    for (const real of reals) {
      if (!real.userId) {
        await updateDoc(doc(db, "orders", real._id), {
          userId: me,
          claimedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        console.log(`[auto-claim] Gán đơn thật "${orderId}" (${real._id}) cho user`);
      }
    }

    changed = true;
  }

  return changed;
}

function ORDERS_CACHE_KEY() {
  return `orders_${me}_v2`;
}
const ORDERS_CACHE_TTL = 5 * 60 * 1000; // 5 phút

async function refreshMyOrders(forceRefresh = false) {
  // Render skeleton ngay để user thấy UI trong khi chờ data
  renderMyOrders(true);

  // Thử load từ sessionStorage trước
  if (!forceRefresh) {
    try {
      const cached = sessionStorage.getItem(ORDERS_CACHE_KEY());
      if (cached) {
        const { data, ts } = JSON.parse(cached);
        if (Date.now() - ts < ORDERS_CACHE_TTL) {
          myOrders = data;
          renderMyOrders();
          _updateOrderStats();
          return;
        }
      }
    } catch (e) { }
  }

  const q = query(collection(db, "orders"), where("userId", "==", me), limit(500));
  const snap = await getDocs(q);
  myOrders = snap.docs.map(d => ({ _id: d.id, ...d.data() }));

  // Bước 1: Dọn trùng ID trong myOrders
  const cleaned = await cleanupDuplicateDrafts(myOrders);

  // Bước 2: autoClaimRealOrders — dùng lại myOrders đã có, không fetch lại
  const ordersForClaim = cleaned
    ? (await getDocs(query(collection(db, "orders"), where("userId", "==", me), limit(500)))).docs.map(d => ({ _id: d.id, ...d.data() }))
    : myOrders;
  const autoClaimed = await autoClaimRealOrders(ordersForClaim);

  // Reload lần cuối CHỈ KHI có thay đổi thực sự (autoClaimed), cleaned đã reload ở trên
  if (autoClaimed && !cleaned) {
    const snap2 = await getDocs(query(collection(db, "orders"), where("userId", "==", me), limit(500)));
    myOrders = snap2.docs.map(d => ({ _id: d.id, ...d.data() }));
  } else if (cleaned) {
    myOrders = ordersForClaim;
  }

  // Lưu vào sessionStorage
  try {
    sessionStorage.setItem(ORDERS_CACHE_KEY(), JSON.stringify({ data: myOrders, ts: Date.now() }));
  } catch (e) { }

  _updateOrderStats();
  renderMyOrders();
}

function _updateOrderStats() {
  const count = myOrders.length;
  document.getElementById("mine-badge").textContent = count > 0 ? `(${count})` : "";
  let totalVal = 0, totalDisc = 0, totalAvailable = 0;
  myOrders.forEach(o => {
    totalVal += Number(o["Giá trị đơn hàng (₫)"]) || 0;
    const disc = calcDisc(o);
    totalDisc += disc;
    if (String(o["Trạng thái đặt hàng"] || "").trim().toLowerCase() === "hoàn thành" && o.thanhToan !== "Đã Thanh Toán") {
      totalAvailable += disc;
    }
  });
  document.getElementById("sum-count").textContent = count;
  document.getElementById("sum-value").textContent = (totalVal / 1e6).toFixed(2) + "M";
  document.getElementById("sum-disc").textContent = totalDisc.toLocaleString("vi-VN");
  const elTotalAvailable = document.getElementById("sum-avail");
  if (elTotalAvailable) elTotalAvailable.textContent = totalAvailable.toLocaleString("vi-VN");
}

function _clearOrdersCache() {
  try { sessionStorage.removeItem(ORDERS_CACHE_KEY()); } catch (e) { }
}

function paymentBadge(val) {
  if (val === "Đã Thanh Toán") return `<span class="tag-paid">💚 Đã Thanh Toán</span>`;
  if (val === "Đang chờ xử lý") return `<span class="tag-unpaid" style="background:#fff3e0;color:#e65100">⏳ Đang chờ xử lý</span>`;
  if (val === "Chưa Thanh Toán") return `<span class="tag-unpaid">🟡 Chưa Thanh Toán</span>`;
  return `<span class="tag-nopay">–</span>`;
}

function calcDisc(o) {
  const hh = Number((o["Hoa hồng Shopee trên sản phẩm(₫)"] || "0").toString().replace(/\./g, "")) || 0;
  const ck = Number(o["Chiết Khấu"]) || Number(o["Chiết Khấu 2%"]) || 0;
  return hh === 0 ? 0 : ck;
}

window.toggleOrderGroup = function (el) {
  el.closest('.order-group').classList.toggle('open');
};

function groupOrdersById(orders) {
  const groups = {};
  for (const o of orders) {
    const id = o["ID đơn hàng"] || "UNKNOWN";
    if (!groups[id]) {
      groups[id] = {
        orderId: id,
        items: [],
        totalVal: 0,
        totalDisc: 0,
        status: o["Trạng thái đặt hàng"] || "",
        payment: o.thanhToan || "",
        time: o["Thời Gian Đặt Hàng"] || "",
        userId: o.userId || null,
        isManual: false
      };
    }
    groups[id].items.push(o);
    groups[id].totalVal += Number(o["Giá trị đơn hàng (₫)"]) || 0;
    groups[id].totalDisc += calcDisc(o);
    if (o["Tên Item"] === "Không có thông tin") {
      groups[id].isManual = true;
    }
    if (o.thanhToan && o.thanhToan !== "Chưa cập nhật") {
      groups[id].payment = o.thanhToan;
    }

    // Cập nhật trạng thái nhóm: ưu tiên hiển thị "Đang chờ xử lý" hoặc các trạng thái chưa hoàn thành
    const itemStatus = (o["Trạng thái đặt hàng"] || "").trim();
    const currentStatus = groups[id].status.trim().toLowerCase();
    if (itemStatus.toLowerCase() === "đang chờ xử lý") {
      groups[id].status = itemStatus;
    } else if (currentStatus === "hoàn thành" && itemStatus.toLowerCase() !== "hoàn thành" && itemStatus !== "") {
      groups[id].status = itemStatus;
    }
  }
  return Object.values(groups);
}

window.renderMyOrders = renderMyOrders;
function renderMyOrders(skeleton = false) {
  const el = document.getElementById("mine-list");

  if (skeleton) {
    el.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;padding:4px 0">
      ${[1, 2, 3].map(() => `<div style="height:64px;border-radius:10px;background:linear-gradient(90deg,#f0f0f0 25%,#e0e0e0 50%,#f0f0f0 75%);background-size:200% 100%;animation:shimmer 1.2s infinite"></div>`).join("")}
    </div>`;
    return;
  }

  let filteredOrders = myOrders;
  const filterSelect = document.getElementById("order-filter");
  if (filterSelect) {
    const filterVal = filterSelect.value;
    if (filterVal === "paid") {
      filteredOrders = myOrders.filter(o => {
        const st = (o["Trạng thái đặt hàng"] || "").trim();
        const isCancelled = st === "Đã huỷ" || st === "Đã hủy" || st === "Hủy";
        return o.thanhToan === "Đã Thanh Toán" || isCancelled;
      });
    } else if (filterVal === "unpaid") {
      filteredOrders = myOrders.filter(o => {
        const st = (o["Trạng thái đặt hàng"] || "").trim();
        const isCancelled = st === "Đã huỷ" || st === "Đã hủy" || st === "Hủy";
        return o.thanhToan !== "Đã Thanh Toán" && !isCancelled;
      });
    }
  }

  if (!filteredOrders.length) {
    const noFilterMatch = myOrders.length > 0;
    el.innerHTML = `<div style="padding:36px;text-align:center;color:#999;font-size:14px">
      ${noFilterMatch ? 'Không có đơn hàng nào phù hợp với bộ lọc hiện tại.' : 'Chưa có đơn hàng nào.<br>Hãy sang tab <b>🔍 Tìm đơn hàng</b> để tìm và gán đơn về tài khoản!'}
    </div>`;
    return;
  }

  let grandTotalVal = 0, grandTotalDisc = 0;
  const groups = groupOrdersById(filteredOrders);

  const html = groups.map(g => {
    grandTotalVal += g.totalVal;
    grandTotalDisc += g.totalDisc;

    let titleText = g.items[0]["Tên Item"] || "Không có thông tin";
    if (g.items.length > 1) {
      titleText += ` (+ ${g.items.length - 1} sản phẩm khác)`;
    }

    const isManual = g.isManual;
    const itemIdsStr = g.items.map(o => o._id).join(',');

    const thaoTac = isManual
      ? `<div style="display:flex;gap:4px">
           <button class="btn-out" style="color: var(--blue); border-color: var(--blue); background: none; font-size:11px; padding:3px 8px; cursor: pointer;" data-id="${escapeHTML(g.orderId)}" onclick="event.stopPropagation(); searchSingleId(this.dataset.id)">🔄 Tìm Lại</button>
           <button class="btn-out" style="color: var(--red); border-color: var(--red); background: none; font-size:11px; padding:3px 8px; cursor: pointer;" data-ids="${escapeHTML(itemIdsStr)}" onclick="event.stopPropagation(); deleteMyOrder(this.dataset.ids, this)">🗑️ Xóa</button>
         </div>`
      : ``;

    const statusHtml = g.status.trim().toLowerCase() === "hoàn thành"
      ? `<span class="tag-mine" style="font-size:11px;padding:3px 10px">${escapeHTML(g.status)}</span>`
      : `<span>${escapeHTML(g.status)}</span>`;

    const itemsListHtml = g.items.map(o => `
      <div class="detail-item-row">
        <div class="item-name-col">${escapeHTML(o["Tên Item"] || "")}</div>
        <div class="item-price-col">
          <div>Giá: ${(Number(o["Giá trị đơn hàng (₫)"]) || 0).toLocaleString("vi-VN")}đ</div>
          <div style="font-size: 11px; color: var(--green);">CK: ${calcDisc(o).toLocaleString("vi-VN")}đ</div>
        </div>
      </div>
    `).join("");

    return `
    <div class="order-group">
      <div class="order-summary" onclick="toggleOrderGroup(this)" style="display: block;">
        <div class="order-title" title="${escapeHTML(g.items.map(i => i["Tên Item"] || "").join(', '))}" style="margin-bottom: 8px;">${escapeHTML(titleText)}</div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div class="order-meta">
            ${statusHtml}
            ${paymentBadge(g.payment)}
          </div>
          <div class="order-summary-right">
            <span style="font-size:12px;color:var(--green);font-weight:600;white-space:nowrap;">CK: ${(g.totalDisc || 0).toLocaleString("vi-VN")}đ</span>
            ${thaoTac}
          </div>
        </div>
      </div>
      <div class="order-details">
        <div class="detail-grid">
          <div class="detail-item"><span class="detail-lbl">Mã đơn hàng</span><span class="detail-val">${escapeHTML(g.orderId)}</span></div>
          <div class="detail-item"><span class="detail-lbl">Thời gian đặt</span><span class="detail-val">${g.time}</span></div>
          <div class="detail-item"><span class="detail-lbl">Tổng giá trị</span><span class="detail-val">${g.totalVal.toLocaleString("vi-VN")}đ</span></div>
          <div class="detail-item"><span class="detail-lbl">Tổng chiết khấu</span><span class="detail-val">${g.totalDisc.toLocaleString("vi-VN")}đ</span></div>
        </div>
        <div class="detail-items-list">
          ${itemsListHtml}
        </div>
      </div>
    </div>
    `;
  }).join("");

  el.innerHTML = `<div class="result-wrap">${html}</div>
  <div class="mobile-summary">
    <span>📦 ${groups.length} đơn (${filteredOrders.length} SP)</span>
    <span>💰 ${grandTotalVal.toLocaleString("vi-VN")}đ</span>
    <span>🎁 CK: ${grandTotalDisc.toLocaleString("vi-VN")}đ</span>
  </div>`;
}

// ─── SEARCH ──────────────────────────────────────────────
const searchCache = new Map();
let _searchTimestamps = []; // lưu thời điểm các lần tìm
const SEARCH_LIMIT = 15;    // tối đa 15 lần / phút

// Shopee order ID: bắt đầu bằng 6 chữ số (YYMMDD), theo sau là chữ số/chữ hoa, tổng 12-18 ký tự
function isValidOrderId(id) {
  return /^\d{6}(?=[A-Z0-9]{6,12}$)(?=\d*[A-Z])[A-Z0-9]{6,12}$/.test(id);
}

window.doSearch = async function () {
  const raw = document.getElementById("orderId").value;
  const allIds = Array.from(new Set(raw.toUpperCase().split(/[\s,]+/).filter(Boolean)));
  const ids = allIds.filter(isValidOrderId);
  const invalidIds = allIds.filter(id => !isValidOrderId(id));
  const resultDiv = document.getElementById("search-result");
  if (!allIds.length) return;

  if (ids.length === 0) {
    resultDiv.innerHTML = `<div class="not-found" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
      <div><b>⚠️ Không có thông tin đơn hàng</b><br><span style="font-size:13px;color:#999">Hãy thử tìm lại bạn nhé.</span></div>
      <button onclick="document.getElementById('orderId').value='';document.getElementById('search-result').innerHTML=''" style="background:#EE4D2D;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">✏️ Xoá văn bản</button>
    </div>`;
    return;
  }
  if (invalidIds.length > 0) {
    resultDiv.innerHTML = `<div class="msg msg-info" style="margin-bottom:8px">⚠️ Bỏ qua ${invalidIds.length} mã không hợp lệ: <code>${invalidIds.join(", ")}</code></div>`;
  }

  const btn = document.getElementById("btn-search");
  const now = Date.now();
  // Giữ lại các lần tìm trong 60 giây gần nhất
  _searchTimestamps = _searchTimestamps.filter(t => now - t < 60000);
  if (_searchTimestamps.length >= SEARCH_LIMIT) {
    const resetIn = Math.ceil((60000 - (now - _searchTimestamps[0])) / 1000);
    alert(`⚠️ Bạn đã tìm ${SEARCH_LIMIT} lần trong 1 phút. Vui lòng chờ ${resetIn}s.`);
    return;
  }
  _searchTimestamps.push(now);
  btn.disabled = true; btn.textContent = "⏳ Đang tìm...";
  resultDiv.innerHTML = `<div class="spinner-wrap"><div class="spinner"></div>Đang tìm kiếm trong hệ thống...</div>`;

  try {
    let found = [];
    let idsToQuery = [];

    // 1. Kiểm tra cache trước
    for (const id of ids) {
      if (searchCache.has(id)) {
        found.push(...searchCache.get(id));
      } else {
        idsToQuery.push(id);
      }
    }

    // 2. Fetch những ID chưa có trong cache
    if (idsToQuery.length > 0) {
      let newlyFound = [];
      for (let i = 0; i < idsToQuery.length; i += 30) {
        const chunk = idsToQuery.slice(i, i + 30);
        try {
          const snap = await getDocs(query(collection(db, "orders"), where("ID đơn hàng", "in", chunk)));
          snap.docs.forEach(d => newlyFound.push({ _id: d.id, ...d.data() }));
        } catch (qErr) {
          if (qErr.code === "permission-denied") {
            const promises = chunk.map(id => getDoc(doc(db, "orders", id)));
            const snaps = await Promise.all(promises);
            snaps.forEach(s => { if (s.exists()) newlyFound.push({ _id: s.id, ...s.data() }); });
          } else throw qErr;
        }
      }

      // 3. Cập nhật cache với những kết quả mới
      idsToQuery.forEach(id => {
        const matches = newlyFound.filter(o => (o["ID đơn hàng"] || "").toUpperCase() === id);
        searchCache.set(id, matches); // Nếu mảng rỗng (không tìm thấy) cũng lưu lại để tránh truy vấn lại
        found.push(...matches);
      });
    }

    const foundIds = new Set(found.map(o => (o["ID đơn hàng"] || "").toUpperCase()));
    const missingIds = ids.filter(id => !foundIds.has(id.toUpperCase()));

    if (found.length) {
      renderSearchResults(found, resultDiv);
      // Nếu có đơn thuộc về user nhưng chưa có trong myOrders cache → reload ngầm
      const myFoundIds = found.filter(o => o.userId === me).map(o => o._id);
      const myOrderIds = new Set(myOrders.map(o => o._id));
      const hasNewMine = myFoundIds.some(id => !myOrderIds.has(id));
      if (hasNewMine) {
        _clearOrdersCache();
        refreshMyOrders(true);
      }
    } else {
      resultDiv.innerHTML = ""; // Remove redundant global error card
    }

    const validMissingIds = missingIds.filter(id => /^\d{6}[0-9A-Z]{8}$/.test(id));
    const invalidMissingIds = missingIds.filter(id => !/^\d{6}[0-9A-Z]{8}$/.test(id));

    if (validMissingIds.length > 0 || invalidMissingIds.length > 0) {
      let missingHtml = "";

      if (validMissingIds.length > 0) {
        missingHtml += validMissingIds.map(id => `
        <div style="background:#fff3e0; padding: 14px 18px; border-radius: var(--radius); margin-top: 14px; border: 1px solid #ffcc80; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px;">
          <div>
            <div style="font-weight: 700; color: #e65100; margin-bottom: 4px;">❌ Không tìm thấy ID: ${escapeHTML(id)}</div>
            <div style="font-size: 13px; color: #e65100; opacity: 0.85;">Chưa có trong hệ thống, bạn có muốn lưu tạm?</div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn-claim" style="padding: 8px 16px; font-size: 13px;" data-id="${escapeHTML(id)}" onclick="saveMissingOrder(this.dataset.id, this)">💾 Lưu lại đơn hàng</button>
            <button class="btn-out" style="color: var(--blue); border-color: var(--blue); background: none;" data-id="${escapeHTML(id)}" onclick="searchSingleId(this.dataset.id)">🔄 Tìm lại</button>
          </div>
        </div>
        `).join("");
      }

      if (invalidMissingIds.length > 0) {
        missingHtml += `
        <div style="background:#fff3e0; padding: 14px 18px; border-radius: var(--radius); margin-top: 14px; border: 1px solid #ffcc80; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px;">
          <div>
            <div style="font-weight: 700; color: #e65100; margin-bottom: 4px;">⚠️ Không có thông tin đơn hàng</div>
            <div style="font-size: 13px; color: #e65100; opacity: 0.85;">Hãy thử tìm lại bạn nhé.</div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn-claim" style="padding: 8px 16px; font-size: 13px; background: #e65100; color: #fff; border: none; cursor: pointer;" onclick="document.getElementById('orderId').value = ''; document.getElementById('orderId').focus(); document.getElementById('search-result').innerHTML = '';">🧹 Xoá văn bản</button>
          </div>
        </div>
        `;
      }

      const missingContainer = document.createElement("div");
      missingContainer.innerHTML = missingHtml;
      resultDiv.appendChild(missingContainer);
    }
  } catch (e) {
    const hint = e.code === "permission-denied"
      ? `<br><small>💡 Lỗi quyền truy cập – liên hệ admin để cập nhật Firestore Security Rules.</small>`
      : "";
    resultDiv.innerHTML = `<div class="not-found">❌ Lỗi: ${e.message}${hint}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = "🔍 Tìm đơn hàng";
  }
};

function renderSearchResults(orders, container) {
  let grandTotalVal = 0, grandTotalDisc = 0;
  const groups = groupOrdersById(orders);

  const html = groups.map(g => {
    grandTotalVal += g.totalVal;
    grandTotalDisc += g.totalDisc;

    let titleText = g.items[0]["Tên Item"] || "Không có thông tin";
    if (g.items.length > 1) {
      titleText += ` (+ ${g.items.length - 1} sản phẩm khác)`;
    }

    const isManual = g.isManual;
    const mineCount = g.items.filter(o => o.userId === me).length;
    const claimedCount = g.items.filter(o => !!o.userId).length;

    let actionCell = "";
    const itemIdsStr = g.items.map(o => o._id).join(',');

    if (mineCount === g.items.length) {
      actionCell = isManual
        ? `<div style="display:flex;gap:4px">
             <button class="btn-out" style="color: var(--blue); border-color: var(--blue); background: none; padding:4px 8px; font-size:12px; cursor: pointer;" data-id="${escapeHTML(g.orderId)}" onclick="event.stopPropagation(); searchSingleId(this.dataset.id)">🔄 Tìm Lại</button>
             <button class="btn-out" style="color: var(--red); border-color: var(--red); background: none; padding:4px 8px; font-size:12px; cursor: pointer;" data-ids="${escapeHTML(itemIdsStr)}" onclick="event.stopPropagation(); deleteMyOrder(this.dataset.ids, this)">🗑️ Xóa</button>
           </div>`
        : `<span class="tag-mine">✅ Của tôi</span>`;
    } else if (claimedCount > 0 && mineCount === 0) {
      actionCell = `<span class="tag-other">🔒 Đã gán</span>`;
    } else if (claimedCount > 0 && mineCount > 0) {
      actionCell = `<span class="tag-other">🔒 Đã gán 1 phần</span>`;
    } else {
      actionCell = `<button class="btn-claim" data-ids="${escapeHTML(itemIdsStr)}" onclick="event.stopPropagation(); claimOrder(this.dataset.ids, this)">📌 Gán cho tôi</button>`;
    }

    const statusHtml = g.status.trim().toLowerCase() === "hoàn thành"
      ? `<span class="tag-mine" style="font-size:11px;padding:3px 10px">${escapeHTML(g.status)}</span>`
      : `<span>${escapeHTML(g.status)}</span>`;

    const itemsListHtml = g.items.map(o => `
      <div class="detail-item-row">
        <div class="item-name-col">${escapeHTML(o["Tên Item"] || "")}</div>
        <div class="item-price-col">
          <div>Giá: ${(Number(o["Giá trị đơn hàng (₫)"]) || 0).toLocaleString("vi-VN")}đ</div>
          <div style="font-size: 11px; color: var(--green);">CK: ${calcDisc(o).toLocaleString("vi-VN")}đ</div>
        </div>
      </div>
    `).join("");

    return `
    <div class="order-group">
      <div class="order-summary" onclick="toggleOrderGroup(this)" style="display: block;">
        <div class="order-title" title="${escapeHTML(g.items.map(i => i["Tên Item"] || "").join(', '))}" style="margin-bottom: 8px;">${escapeHTML(titleText)}</div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div class="order-meta">
            ${statusHtml}
            ${paymentBadge(g.payment)}
          </div>
          <div class="order-summary-right">
            <span style="font-size:12px;color:var(--green);font-weight:600;white-space:nowrap;">CK: ${(g.totalDisc || 0).toLocaleString("vi-VN")}đ</span>
            ${actionCell}
          </div>
        </div>
      </div>
      <div class="order-details">
        <div class="detail-grid">
          <div class="detail-item"><span class="detail-lbl">Mã đơn hàng</span><span class="detail-val">${escapeHTML(g.orderId)}</span></div>
          <div class="detail-item"><span class="detail-lbl">Thời gian đặt</span><span class="detail-val">${g.time}</span></div>
          <div class="detail-item"><span class="detail-lbl">Tổng giá trị</span><span class="detail-val">${g.totalVal.toLocaleString("vi-VN")}đ</span></div>
          <div class="detail-item"><span class="detail-lbl">Tổng chiết khấu</span><span class="detail-val">${g.totalDisc.toLocaleString("vi-VN")}đ</span></div>
        </div>
        <div class="detail-items-list">
          ${itemsListHtml}
        </div>
      </div>
    </div>
    `;
  }).join("");

  container.innerHTML = `<div class="card" style="padding:0; background:transparent; box-shadow:none;"><div class="result-wrap">
    ${html}
  </div></div>
  <div class="mobile-summary">
    <span>📦 ${groups.length} đơn (${orders.length} SP)</span>
    <span>💰 ${grandTotalVal.toLocaleString("vi-VN")}đ</span>
    <span>🎁 CK: ${grandTotalDisc.toLocaleString("vi-VN")}đ</span>
  </div>`;
}

// ─── CLAIM ───────────────────────────────────────────────
window.claimOrder = async function (docIdsStr, btn) {
  btn.disabled = true; btn.textContent = "⏳...";
  const docIds = docIdsStr.split(',');
  try {
    const batch = writeBatch(db);
    let anySuccess = false;

    for (const docId of docIds) {
      // Dùng transaction nếu cần check `userId` chặt chẽ, nhưng để nhanh thì cập nhật hàng loạt qua batch
      // (Bỏ qua transaction ở đây để đơn giản và phù hợp xử lý nhiều ID. Có thể sẽ ghi đè nếu vừa bị gán, nhưng xác suất thấp)
      const ref = doc(db, "orders", docId);
      batch.update(ref, { userId: me, claimedAt: serverTimestamp() });
      anySuccess = true;
    }

    if (anySuccess) await batch.commit();

    btn.parentNode.innerHTML = `<span class="tag-mine">✅ Của tôi</span>`;
    _clearOrdersCache();
    await refreshMyOrders(true);
  } catch (err) {
    btn.disabled = false; btn.textContent = "Lưu Thông Tin Mặc Định";
    alert("❌ Lỗi lưu thông tin: " + err.message);
  }
};

// ─── ZALO OAUTH CALLBACK HANDLER ─────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const zaloCode = urlParams.get('code');
const zaloState = urlParams.get('state');

if (zaloCode && zaloState) {
  const savedState = sessionStorage.getItem('zalo_oauth_state');
  if (savedState) {
    if (zaloState === savedState) {
      sessionStorage.removeItem('zalo_oauth_state');
      window.addEventListener('DOMContentLoaded', () => {
        handleZaloOauth(zaloCode);
      });
    } else {
      console.error("❌ Zalo OAuth state mismatch! CSRF protection triggered.");
      // State không khớp -> dừng flow, không xử lý tiếp
    }
  }
}

async function handleZaloOauth(code) {
  const msgId = localStorage.getItem('zalo_msg_id') || 'login-msg';
  const msg = document.getElementById(msgId);
  if (msg) {
    msg.className = "amsg";
    msg.textContent = "⏳ Đang xác thực với Zalo...";
    msg.style.display = "block";
  }

  const tokenUrl = "/api/zalo/token";
  const codeVerifier = localStorage.getItem('zalo_code_verifier') || '';

  try {
    // PHASE 1: Exchange code for Access Token
    let tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, codeVerifier: codeVerifier })
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      throw new Error("Lỗi máy chủ khi lấy Token: " + errText);
    }

    let tokenData = await tokenRes.json();
    if (!tokenData.zaloAccessToken) {
      throw new Error("Không nhận được Zalo Access Token.");
    }

    // PHASE 2: Fetch Zalo Profile from Client (IP Việt Nam)
    let profileRes = await fetch('https://graph.zalo.me/v2.0/me?fields=id,name,picture', {
      headers: { 'access_token': tokenData.zaloAccessToken }
    });

    if (!profileRes.ok) {
      throw new Error("Lỗi khi lấy thông tin cá nhân Zalo.");
    }

    let profileData = await profileRes.json();
    if (profileData.error || !profileData.id) {
      throw new Error("Zalo API Error: " + (profileData.message || "Không lấy được ID"));
    }

    const zaloId = profileData.id;
    const realName = profileData.name || "Người dùng Zalo";
    const realAvatar = profileData.picture?.data?.url || "";

    // LINK MODE: user email muốn gắn zaloId vào tài khoản hiện tại
    if (localStorage.getItem('zalo_link_mode') === '1') {
      localStorage.removeItem('zalo_link_mode');
      window.history.replaceState({}, document.title, window.location.pathname);
      if (msg) { msg.className = "amsg"; msg.textContent = "⏳ Đang liên kết..."; msg.style.display = "block"; }

      // Đợi Firebase Auth restore session (me có thể chưa được set lúc này)
      const resolvedUid = await new Promise(resolve => {
        if (me) { resolve(me); return; }
        const unsub = onAuthStateChanged(auth, user => {
          unsub();
          resolve(user ? user.uid : null);
        });
      });

      if (!resolvedUid) {
        if (msg) { msg.className = "amsg err"; msg.textContent = "❌ Bạn cần đăng nhập trước khi liên kết Zalo."; }
        return;
      }

      // Kiểm tra ZaloID này đã được liên kết với tài khoản khác chưa
      const dupSnap = await getDocs(query(collection(db, "users"), where("zaloId", "==", zaloId)));
      const alreadyLinked = dupSnap.docs.find(d => d.id !== resolvedUid);
      if (alreadyLinked) {
        if (msg) { msg.className = "amsg err"; msg.textContent = "❌ Tài khoản Zalo này đã được liên kết với một tài khoản khác."; }
        return;
      }

      await setDoc(doc(db, "users", resolvedUid), { zaloId, updatedAt: serverTimestamp() }, { merge: true });
      if (cachedUserDoc?.data) cachedUserDoc.data.zaloId = zaloId;
      else if (cachedUserDoc) cachedUserDoc.zaloId = zaloId;
      // Tạo bonus code nếu chưa có
      await createBonusCodeForUser(resolvedUid, zaloId);
      await loadMyBonus();
      // Hiện toast thành công (không phụ thuộc vào element trong card)
      showToast('✅ Liên kết Zalo thành công!');
      return;
    }

    // PHASE 3: Mint Custom Token on Server
    let mintRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zaloId: zaloId, zaloAccessToken: tokenData.zaloAccessToken })
    });

    if (!mintRes.ok) {
      const errText = await mintRes.text();
      throw new Error("Lỗi máy chủ khi tạo phiên đăng nhập: " + errText);
    }

    let mintData = await mintRes.json();
    if (!mintData.customToken) {
      throw new Error("Không nhận được Custom Token.");
    }

    // PHASE 4: Firebase Sign In
    window.history.replaceState({}, document.title, window.location.pathname);
    const userCredential = await signInWithCustomToken(auth, mintData.customToken);

    // Cập nhật Profile
    await updateProfile(userCredential.user, {
      displayName: realName,
      photoURL: realAvatar
    });

    // Đọc doc hiện tại để giữ createdAt nếu đã có
    const existingSnap = await getDoc(doc(db, "users", userCredential.user.uid));
    // Chỉ coi là "user mới" khi document thực sự chưa tồn tại — user cũ thiếu
    // field createdAt KHÔNG được tính là mới, tránh bị stamp lại createdAt = now
    // (gây hiểu nhầm "vừa tạo tài khoản" và tự nhảy qua tab Bonus sai)
    const isNewUser = !existingSnap.exists();
    const existingName = existingSnap.data()?.name;
    const updateData = {
      // Chỉ cập nhật tên nếu chưa có (user mới), giữ nguyên nếu đã có
      name: existingName || realName,
      avatar: realAvatar,
      role: "user",
      zaloId: zaloId,
      loginType: "zalo",
      updatedAt: serverTimestamp()
    };
    const myRefCode = userCredential.user.uid.slice(-7).toUpperCase();
    // Luôn ghi refCode nếu chưa có (kể cả user cũ)
    if (!existingSnap.data()?.refCode) {
      updateData.refCode = myRefCode;
    }
    if (isNewUser) {
      updateData.createdAt = serverTimestamp();
      // Ghi người giới thiệu nếu có (chỉ khi đăng ký lần đầu)
      const pendingRef = localStorage.getItem('pendingRef');
      if (pendingRef && pendingRef !== myRefCode) {
        const refSnap = await getDocs(query(collection(db, 'users'), where('refCode', '==', pendingRef), limit(1)));
        if (!refSnap.empty) updateData.referredBy = refSnap.docs[0].id;
      }
      localStorage.removeItem('pendingRef');
    }
    await setDoc(doc(db, "users", userCredential.user.uid), updateData, { merge: true });

    // Đảm bảo me được set trước khi gọi loadMyBonus
    if (!me) me = userCredential.user.uid;

    // Cập nhật UI và cache ngay sau khi ghi Firestore xong
    const displayName = existingName || realName;
    myName = displayName;
    const freshData = { name: displayName, avatar: realAvatar, role: 'user', zaloId, loginType: 'zalo' };
    cachedUserDoc = { uid: userCredential.user.uid, data: freshData };
    const elUname = document.getElementById("header-uname");
    const elWelcome = document.getElementById("welcome-name");
    if (elUname) elUname.textContent = displayName;
    if (elWelcome) elWelcome.textContent = displayName;

    // Tạo bonus code cho user Zalo (nếu chưa có) sau ngày launch
    if (new Date() >= BONUS_LAUNCH_DATE) {
      await createBonusCodeForUser(userCredential.user.uid, zaloId);
    }
    // Luôn gọi loadMyBonus sau cùng để đảm bảo tab Bonus hiển thị đúng
    await loadMyBonus();

    if (msg) {
      msg.className = "amsg ok";
      msg.textContent = "✅ Đăng nhập Zalo thành công!";
    }
  } catch (err) {
    if (msg) {
      msg.className = "amsg err";
      msg.textContent = "❌ Lỗi kết nối Zalo: " + err.message;
    }
    console.error("Zalo Login Error:", err);
  }
}

window.saveMissingOrder = async function (id, btn) {
  btn.disabled = true; btn.textContent = "⏳...";
  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, "orders", id);
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        tx.set(ref, {
          "ID đơn hàng": id,
          "Tên Item": "Không có thông tin",
          "Giá trị đơn hàng (₫)": 0,
          "Chiết Khấu": 0,
          "Trạng thái đặt hàng": "",
          userId: me,
          claimedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      } else {
        if (snap.data().userId) throw new Error("TAKEN");
        tx.update(ref, { userId: me, claimedAt: serverTimestamp() });
      }
    });
    btn.parentNode.innerHTML = `<span class="tag-mine" style="padding: 8px 16px; font-size: 13px;">✅ Đã lưu</span>`;
    _clearOrdersCache();
    await refreshMyOrders(true);
  } catch (e) {
    if (e.message === "TAKEN") {
      btn.parentNode.innerHTML = `<span class="tag-other" style="padding: 8px 16px; font-size: 13px;">🔒 Đã có người gán</span>`;
    } else {
      btn.disabled = false; btn.textContent = "💾 Lưu lại đơn hàng";
      alert("Lỗi: " + e.message);
    }
  }
};

window.deleteMyOrder = async function (docIdsStr, btn) {
  if (!confirm("Bạn có chắc chắn muốn xóa lưu nháp đơn hàng này không?")) return;
  const oldHtml = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = "⏳";
  const docIds = docIdsStr.split(',');
  try {
    const batch = writeBatch(db);
    for (const id of docIds) {
      batch.delete(doc(db, "orders", id));
    }
    await batch.commit();
    _clearOrdersCache();
    await refreshMyOrders(true);
    // Refresh search results if we are currently looking at search
    if (document.getElementById("main-search").style.display === "block" && document.getElementById("orderId").value.trim() !== "") {
      doSearch();
    }
  } catch (e) {
    btn.disabled = false; btn.innerHTML = oldHtml;
    alert("Lỗi xóa: " + e.message);
  }
};

window.searchSingleId = function (id) {
  showMainTab('search');
  document.getElementById("orderId").value = id;
  // Cuộn lên phần nhập tìm kiếm nếu cần thiết
  const card = document.getElementById("orderId").closest(".card");
  if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
  doSearch();
};

// ─── PAYMENT REQUEST ──────────────────────────────────────
window.createPaymentRequest = async function () {
  if (!myBankInfo) {
    document.getElementById("bank-info-modal").style.display = "flex";
    return;
  }

  const eligibleOrders = myOrders.filter(o =>
    String(o["Trạng thái đặt hàng"] || "").trim().toLowerCase() === "hoàn thành" &&
    (!o.thanhToan || o.thanhToan === "" || o.thanhToan === "Chưa cập nhật") &&
    o["Tên Item"] !== "Không có thông tin"
  );

  if (!eligibleOrders.length) {
    alert("❌ Không có đơn hàng nào hợp lệ để yêu cầu thanh toán.");
    return;
  }

  let totalVal = 0, totalDisc = 0;
  eligibleOrders.forEach(o => {
    totalVal += Number(o["Giá trị đơn hàng (₫)"]) || 0;
    totalDisc += calcDisc(o);
  });

  // Tính bonus
  const bonusAmt = (myBonusCode && myBonusCode.status === "active")
    ? Math.round(totalDisc * (myBonusCode.bonusPercent || 10) / 100) : 0;
  const totalReceive = totalDisc + bonusAmt;

  // Hiện modal xác nhận với thông tin ngân hàng + số tiền
  const modal = document.getElementById("pay-confirm-modal");
  if (modal) {
    document.getElementById("pcm-bank").textContent = myBankInfo.bankName || "–";
    document.getElementById("pcm-account").textContent = myBankInfo.bankAccount || "–";
    document.getElementById("pcm-name").textContent = myBankInfo.bankFullName || "–";
    document.getElementById("pcm-orders").textContent = eligibleOrders.length + " đơn";
    document.getElementById("pcm-disc").textContent = totalDisc.toLocaleString("vi-VN") + "đ";
    const bonusRow = document.getElementById("pcm-bonus-row");
    if (bonusAmt > 0) {
      bonusRow.style.display = "flex";
      document.getElementById("pcm-bonus").textContent = `+${bonusAmt.toLocaleString("vi-VN")}đ (+${myBonusCode.bonusPercent}%)`;
    } else {
      bonusRow.style.display = "none";
    }
    document.getElementById("pcm-total").textContent = totalReceive.toLocaleString("vi-VN") + "đ";
    modal.style.display = "flex";
  } else {
    // Fallback nếu không có modal
    if (!confirm(`Xác nhận tạo yêu cầu thanh toán ${eligibleOrders.length} đơn, tổng: ${totalReceive.toLocaleString("vi-VN")}đ?`)) return;
  }

  // Đặt callback khi user bấm Xác nhận trong modal
  window._confirmPayment = async function() {
    document.getElementById("pay-confirm-modal").style.display = "none";
    window._confirmPayment = null;

  const btn = document.querySelector('button[onclick="createPaymentRequest()"]');
  const oldText = btn ? btn.textContent : "💳 Yêu Cầu Thanh Toán Toàn Bộ";
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Đang tạo yêu cầu..."; }

  try {
    const reqId = "REQ_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
    const orderIds = eligibleOrders.map(o => o._id);

    const batch = writeBatch(db);

    // Create new payment_requests document
    // Kiểm tra bonus active
    // Reload bonus mới nhất từ Firestore trước khi apply
    await loadMyBonus();

    let bonusApplied = false, bonusAmount = 0, bonusPercent = 0;
    if (myBonusCode && myBonusCode.status === "active") {
      const expireTs = myBonusCode.expireAt?.toDate ? myBonusCode.expireAt.toDate().getTime() : (myBonusCode.expireAt ? new Date(myBonusCode.expireAt).getTime() : null);
      if (!expireTs || Date.now() <= expireTs) {
        bonusApplied = true;
        bonusPercent = myBonusCode.bonusPercent || BONUS_PERCENT;
        bonusAmount = Math.round(totalDisc * bonusPercent / 100);
      }
    }
    const totalPayout = totalDisc + bonusAmount;

    const reqRef = doc(collection(db, "payment_requests"), reqId);
    batch.set(reqRef, {
      requestId: reqId,
      userId: me,
      userName: myName,
      orderIds: orderIds,
      totalCount: new Set(eligibleOrders.map(o => (o["ID đơn hàng"] || o._id).split("_")[0])).size,
      totalValue: totalDisc,
      totalOrderValue: totalVal,
      bonusApplied,
      bonusPercent: bonusApplied ? bonusPercent : 0,
      bonusAmount: bonusApplied ? bonusAmount : 0,
      totalPayout,
      status: "pending",
      createdAt: serverTimestamp()
    });

    // Update bonusCode → used
    if (bonusApplied && myBonusCode) {
      const bonusRef = doc(db, "bonusCodes", myBonusCode.id);
      batch.update(bonusRef, {
        status: "used",
        usedAt: serverTimestamp(),
        usedOnRequestId: reqId,
        bonusAmount,
      });
    }

    // Update all relevant orders
    eligibleOrders.forEach(o => {
      const orderRef = doc(db, "orders", o._id);
      batch.update(orderRef, { thanhToan: "Đang chờ xử lý", updatedAt: serverTimestamp() });
    });

    await batch.commit();
    const bonusMsg = bonusApplied ? `\n🎁 Bonus +${bonusAmount.toLocaleString("vi-VN")}đ đã được áp dụng!` : "";
    alert(`✅ Đã tạo yêu cầu thanh toán thành công!${bonusMsg}`);
    _clearOrdersCache();
    await refreshMyOrders(true);
    if (bonusApplied) loadMyBonus();
  } catch (e) {
    alert("❌ Lỗi: " + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = oldText; }
  }
  }; // end _confirmPayment
};

// ─── BONUS CODE ───────────────────────────────────────────
const BONUS_LAUNCH_DATE = new Date("2026-07-01T00:00:00+07:00");
const BONUS_PERCENT = 10;

function genBonusCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "SD-";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

const _bonusCreating = new Set(); // lock tránh race condition tạo 2 code cùng lúc

async function createBonusCodeForUser(userId, zaloId) {
  if (_bonusCreating.has(userId)) return; // call khác đang chạy → bỏ qua
  _bonusCreating.add(userId);
  try {
    // Kiểm tra đã có bonus code chưa
    const existing = await getDocs(query(
      collection(db, "bonusCodes"),
      where("userId", "==", userId),
      limit(1)
    ));
    if (!existing.empty) return; // đã có rồi

    // Sinh code unique
    let code, attempt = 0;
    do {
      code = genBonusCode();
      const snap = await getDoc(doc(db, "bonusCodes", code));
      if (!snap.exists()) break;
      attempt++;
    } while (attempt < 5);

    const activateDeadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await setDoc(doc(db, "bonusCodes", code), {
      code,
      userId,
      zaloId,
      status: "pending",
      bonusPercent: BONUS_PERCENT,
      createdAt: serverTimestamp(),
      activateDeadline,
      activatedAt: null,
      expireAt: null,
      usedAt: null,
      usedOnRequestId: null,
      bonusAmount: null,
    });
    return code;
  } catch (e) {
    console.error("createBonusCode error:", e.code, e.message);
  } finally {
    _bonusCreating.delete(userId); // giải phóng lock dù thành công hay lỗi
  }
}

let myBonusCode = null;   // mã tốt nhất để áp dụng khi rút
let myBonusCodes = [];    // toàn bộ mã của user

// Xử lý danh sách mã bonus vừa nhận được (từ fetch 1 lần hoặc từ listener realtime):
// tự đánh dấu "expired" cho mã pending/active đã quá hạn — ghi lại Firestore luôn
// (không chỉ tính tạm lúc đọc), để status không mãi kẹt sai và các nơi khác đọc
// thẳng field status (VD lọc trong admin panel) cũng đúng. Rồi chọn mã tốt nhất
// để áp dụng (active > pending > còn lại) và render lại UI.
function processBonusDocs(docs) {
  myBonusCodes = docs;

  const now = Date.now();
  const toMs = ts => ts?.toDate ? ts.toDate().getTime() : (ts ? new Date(ts).getTime() : null);
  for (const b of myBonusCodes) {
    let expiredTs = null;
    if (b.status === "pending") expiredTs = toMs(b.activateDeadline);
    else if (b.status === "active") expiredTs = toMs(b.expireAt);
    if (expiredTs && now > expiredTs) {
      b.status = "expired";
      updateDoc(doc(db, "bonusCodes", b.id), { status: "expired" }).catch(() => {});
    }
  }

  const activeValid = myBonusCodes.filter(b => b.status === "active");
  const pending = myBonusCodes.filter(b => b.status === "pending");
  myBonusCode = activeValid[0] || pending[0] || myBonusCodes[0] || null;

  renderBonusTab();
  renderRefSection();
}

// Lắng nghe realtime thay đổi bonusCodes của user hiện tại — để khi bot Zalo/Messenger
// kích hoạt mã (ghi thẳng vào Firestore qua Admin SDK ở server), tab web đang mở tự
// cập nhật ngay, không cần load lại trang hay đăng nhập lại mới thấy.
let bonusUnsub = null;
function subscribeMyBonus() {
  if (bonusUnsub || !me) return; // đã có listener đang chạy đúng cho user hiện tại
  const uidAtSubscribe = me;
  bonusUnsub = onSnapshot(
    query(collection(db, "bonusCodes"), where("userId", "==", uidAtSubscribe)),
    snap => {
      if (uidAtSubscribe !== me) return; // đã logout/đổi user khác, bỏ qua snapshot cũ
      processBonusDocs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    },
    err => console.error('[bonus] onSnapshot lỗi:', err)
  );
}

function unsubscribeMyBonus() {
  if (bonusUnsub) { bonusUnsub(); bonusUnsub = null; }
}

async function loadMyBonus() {
  if (!me) return;
  const snap = await getDocs(query(
    collection(db, "bonusCodes"),
    where("userId", "==", me)
  ));
  let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Fallback: user Zalo/Google chưa có code → tạo luôn
  if (docs.length === 0 && new Date() >= BONUS_LAUNCH_DATE) {
    const userData = cachedUserDoc?.data || cachedUserDoc;
    const isGoogleAuth = auth.currentUser?.providerData?.some(p => p.providerId === 'google.com');
    if (userData && (userData.loginType === "zalo" || userData.loginType === "google" || userData.zaloId || isGoogleAuth)) {
      await createBonusCodeForUser(me, userData.zaloId || "");
      // Reload lại sau khi tạo
      const snap2 = await getDocs(query(collection(db, "bonusCodes"), where("userId", "==", me)));
      docs = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
    }
  }

  processBonusDocs(docs);
  subscribeMyBonus();
}

function bonusCard(borderColor, type, title, bodyHtml) {
  const color = borderColor === '#eee' ? '#9ca3af' : borderColor;
  let svg = "";
  if (type === 'check') {
    svg = `<svg width="28" height="28" viewBox="0 0 24 24" fill="${color}" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" stroke="none"/><path d="m9 12 2 2 4-4"/></svg>`;
  } else if (type === 'gift') {
    svg = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5" fill="${color}22"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>`;
  } else if (type === 'clock') {
    svg = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" fill="${color}22"/><polyline points="12 6 12 12 16 14"/></svg>`;
  } else if (type === 'party') {
    svg = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12v0c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11v0c-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98v0C9.52 4.91 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z" fill="${color}22"/></svg>`;
  } else if (type === 'lock') {
    svg = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" fill="${color}22"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
  } else {
    svg = type;
  }

  const iconHtml = `<div style="display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:50%;background:${color}15;flex-shrink:0">
    ${svg}
  </div>`;

  return `<div class="card" style="border-top:4px solid ${borderColor};margin-bottom:16px;padding:16px;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.04);text-align:left;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
      ${iconHtml}
      <div style="font-size:17px;font-weight:700;color:#333;line-height:1.3">${title}</div>
    </div>
    <div>${bodyHtml}</div>
  </div>`;
}

function renderBonusTab() {
  const el = document.getElementById("main-bonus-content");
  if (!el) return;
  const userData = cachedUserDoc?.data || cachedUserDoc;
  const authUser = auth.currentUser;
  const isGoogleProvider = authUser?.providerData?.some(p => p.providerId === 'google.com');
  const isLinked = userData?.zaloId || userData?.loginType === 'google' || isGoogleProvider;
  if (!isLinked) {
    el.innerHTML = bonusCard("#EE4D2D", "lock", "Kết nối Zalo / Google",
      `<div style="font-size:14px;color:#555;line-height:1.8;margin-bottom:16px">
           Liên kết tài khoản Zalo để sử dụng tính năng Bonus này bạn nhé!
         </div>
         <div style="max-width:280px;margin:0 auto">
           <button onclick="window.doLinkZalo('bonus-link-msg', this)" style="background:#0068ff;color:#fff;border:none;border-radius:8px;padding:10px 16px;font-size:14px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;width:100%">
             <img src="https://stc-id.zaloapp.com/pc/static/imgs/logo.png" style="width:20px;height:20px;border-radius:4px" onerror="this.style.display='none'"> Liên kết Zalo
           </button>
           <div id="bonus-link-msg" style="display:none;margin-top:10px;font-size:13px;text-align:center"></div>
         </div>`);
    updateBonusBadge(null);
    return;
  }

  // ── Helper render danh sách tất cả mã (nếu > 1)
  function renderAllCodesList() {
    if (myBonusCodes.length <= 1) return "";
    const statusLabel = s => ({ pending: "⏳ Chờ kích hoạt", active: "✅ Đã kích hoạt", used: "🎉 Đã dùng", expired: "⏰ Hết hạn", revoked: "🚫 Thu hồi" }[s] || s);
    const statusColor = s => ({ pending: "#EE4D2D", active: "#0abd50", used: "#0a6ebd", expired: "#999", revoked: "#999" }[s] || "#999");
    // Tính effective status dựa vào thời gian thực
    const effectiveStatus = bc => {
      const now = Date.now();
      if (bc.status === 'active') {
        const exp = bc.expireAt?.toDate ? bc.expireAt.toDate().getTime() : (bc.expireAt ? new Date(bc.expireAt).getTime() : null);
        return (exp && now > exp) ? 'expired' : 'active';
      }
      if (bc.status === 'pending') {
        const deadline = bc.activateDeadline?.toDate ? bc.activateDeadline.toDate().getTime() : (bc.activateDeadline ? new Date(bc.activateDeadline).getTime() : null);
        return (deadline && now > deadline) ? 'expired' : 'pending';
      }
      return bc.status;
    };
    const sorted = [...myBonusCodes].sort((a, b) => {
      const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      return tb - ta;
    });
    const list = sorted.map(bc => {
      const ts = bc.expireAt?.toDate ? bc.expireAt.toDate().getTime() : (bc.expireAt ? new Date(bc.expireAt).getTime() : null);
      const deadlineTs = bc.activateDeadline?.toDate ? bc.activateDeadline.toDate().getTime() : (bc.activateDeadline ? new Date(bc.activateDeadline).getTime() : null);
      const expStr = bc.status === "pending"
        ? (deadlineTs ? `Hạn kích hoạt: ${new Date(deadlineTs).toLocaleDateString("vi-VN")}` : "Chưa kích hoạt")
        : (ts ? new Date(ts).toLocaleDateString("vi-VN") : "Không hạn");
      const isBest = bc.id === myBonusCode?.id;
      const effStatus = effectiveStatus(bc);
      const isExpired = effStatus === 'expired';
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;background:${isBest && !isExpired ? "#fff8f0" : "#f9f9f9"};border:1px solid ${isBest && !isExpired ? "#EE4D2D" : "#eee"};margin-bottom:8px">
        <div style="flex:1;min-width:0">
          <div style="font-family:monospace;font-weight:700;font-size:14px;color:${isExpired ? '#aaa' : '#333'}">${escapeHTML(bc.code)}</div>
          ${isBest && !isExpired && effStatus !== 'used' && effStatus !== 'revoked' ? '<div style="margin-top:4px"><span style="font-size:11px;background:#EE4D2D;color:#fff;border-radius:4px;padding:2px 6px">Đang dùng</span></div>' : ''}
          ${isExpired ? '<div style="margin-top:4px"><span style="font-size:11px;background:#999;color:#fff;border-radius:4px;padding:2px 6px">⏰ Hết hạn</span></div>' : ''}
          <div style="font-size:12px;color:#aaa;margin-top:2px">+${bc.bonusPercent}% · ${expStr}</div>
        </div>
        <div style="font-size:12px;font-weight:600;color:${statusColor(effStatus)};white-space:nowrap">${statusLabel(effStatus)}</div>
      </div>`;
    }).join("");
    return `<div class="card" style="margin-top:4px"><div style="font-size:13px;font-weight:600;color:#555;margin-bottom:10px">📋 Tất cả mã của bạn (${myBonusCodes.length})</div>${list}</div>`;
  }

  if (!myBonusCode) {
    el.innerHTML = bonusCard("#eee", "gift", "Chưa có ưu đãi",
      `<div style="font-size:14px;color:#777">Tài khoản của bạn chưa có mã bonus nào.</div>`);
    return;
  }

  const b = myBonusCode;
  const now = Date.now();
  const expireTs = b.expireAt?.toDate ? b.expireAt.toDate().getTime() : (b.expireAt ? new Date(b.expireAt).getTime() : null);
  const daysLeft = expireTs ? Math.max(0, Math.ceil((expireTs - now) / 86400000)) : null;
  const expireStr = expireTs ? new Date(expireTs).toLocaleDateString("vi-VN") : "";

  if (b.status === "active" && expireTs && now > expireTs) {
    el.innerHTML = bonusCard("#ccc", "⏰", "Ưu đãi đã hết hạn",
      `<div style="font-size:14px;color:#777">Bạn đã kích hoạt nhưng không sử dụng trong 30 ngày.</div>`) + renderAllCodesList();
    updateBonusBadge(null);
    return;
  }

  if (b.status === "pending") {
    const deadlineTs = b.activateDeadline?.toDate ? b.activateDeadline.toDate().getTime() : (b.activateDeadline ? new Date(b.activateDeadline).getTime() : null);
    if (deadlineTs && Date.now() > deadlineTs) {
      el.innerHTML = bonusCard("#ccc", "clock", "Ưu đãi đã hết hạn",
        `<div style="font-size:14px;color:#777">Mã bonus đã quá hạn kích hoạt (${new Date(deadlineTs).toLocaleDateString("vi-VN")}).</div>`) + renderAllCodesList();
      updateBonusBadge(null);
      return;
    }
    const syntax = `/sandeal ${b.code}`;
    el.innerHTML = bonusCard("#EE4D2D", "gift", "Bạn có ưu đãi chờ kích hoạt!",
      `<div style="font-size:14px;color:#555;line-height:1.6;margin-bottom:14px">Nhắn tin vào group Zalo hoặc Fanpage Facebook để nhận <b style="color:#EE4D2D">+${b.bonusPercent}%</b> cho lần rút đầu tiên.</div>
       <div style="display:flex;align-items:center;gap:8px;background:#f5f5f5;border-radius:10px;padding:10px 14px;margin-bottom:8px;flex-wrap:wrap;justify-content:center">
         <span style="font-size:13px;color:#888">Cú pháp:</span>
         <span id="bonus-syntax-text" style="font-family:monospace;font-size:15px;font-weight:700;color:#EE4D2D;letter-spacing:1px">${escapeHTML(syntax)}</span>
         <button id="bonus-copy-btn" onclick="copyBonusSyntax()" style="background:#EE4D2D;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:13px;font-weight:600;cursor:pointer;transition:background 0.2s">📋 Copy</button>
       </div>
       <div style="display:flex;gap:8px;margin-top:6px">
         <a href="https://zalo.me/g/TODO_NHOM_ZALO_MOI" target="_blank" rel="noopener noreferrer" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:12px;color:#0068ff;text-decoration:none;background:#f0f6ff;border:1px solid #b3d1ff;border-radius:8px;padding:8px 6px;font-weight:600;text-align:center">
           <span style="font-size:11px;opacity:.8">Gửi vào</span>
           <span style="display:flex;align-items:center;gap:4px;white-space:nowrap"><svg width="13" height="13" viewBox="0 0 460.1 436.3" fill="none"><path d="M230.1 0C103 0 0 92.5 0 206.5C0 268 30.6 323.4 82 359.8C80.2 373.1 72.8 406.8 61.3 430.7C60.2 433 62 435.6 64.5 435.1C91.5 430 139.6 414.5 168.3 395.4C188 401 208.6 404 230.1 404C357.2 404 460.1 311.5 460.1 197.5C460.1 83.5 357.2 0 230.1 0Z" fill="#0068ff"/></svg>Group Zalo</span>
         </a>
         <a href="https://m.me/TODO_FANPAGE_MOI" target="_blank" rel="noopener noreferrer" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:12px;color:#fff;text-decoration:none;background:#0084ff;border:1px solid #0073e6;border-radius:8px;padding:8px 6px;font-weight:600;text-align:center">
           <span style="font-size:11px;opacity:.85">Gửi vào</span>
           <span style="display:flex;align-items:center;gap:4px;white-space:nowrap"><svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M12 0C5.373 0 0 4.974 0 11.111c0 3.498 1.744 6.614 4.469 8.652V24l4.088-2.242c1.092.3 2.246.464 3.443.464 6.627 0 12-4.974 12-11.111S18.627 0 12 0zm1.191 14.963l-3.055-3.26-5.963 3.26L10.732 8l3.131 3.26L19.752 8l-6.561 6.963z"/></svg>Fanpage Facebook</span>
         </a>
       </div>`) + renderAllCodesList();
    updateBonusBadge("pending");
    return;
  }

  if (b.status === "active") {
    const activatedStr = b.activatedAt?.toDate
      ? b.activatedAt.toDate().toLocaleDateString("vi-VN")
      : (b.activatedAt ? new Date(b.activatedAt).toLocaleDateString("vi-VN") : "–");
    const expireInfo = expireTs
      ? `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #d1fae5">
           <span style="color:#888">⏳ Hết hạn</span><b>${expireStr} (còn ${daysLeft} ngày)</b>
         </div>`
      : `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #d1fae5">
           <span style="color:#888">⏳ Hết hạn</span><b>Không giới hạn</b>
         </div>`;
    el.innerHTML = bonusCard("#0abd50", "check", "Bonus đang hoạt động!",
      `<div style="font-size:14px;color:#555;margin-bottom:14px"><b style="color:#0abd50;font-size:18px">+${b.bonusPercent}%</b> sẽ được cộng vào lần rút tiếp theo của bạn.</div>
       <div style="background:#f0fdf4;border-radius:10px;padding:10px 14px;font-size:13px;color:#333;line-height:2">
         <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #d1fae5">
           <span style="color:#888">🎫 Mã</span><b style="font-family:monospace;letter-spacing:1px">${escapeHTML(b.code)}</b>
         </div>
         <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #d1fae5">
           <span style="color:#888">📅 Kích hoạt</span><b>${activatedStr}</b>
         </div>
         ${expireInfo}
         <div style="display:flex;justify-content:space-between;padding:6px 0">
           <span style="color:#888">💰 Bonus</span><b style="color:#0abd50">+${b.bonusPercent}% hoa hồng lần rút đầu</b>
         </div>
       </div>`) + renderAllCodesList();
    updateBonusBadge("active");
    return;
  }

  if (b.status === "used") {
    const usedDate = b.usedAt?.toDate ? b.usedAt.toDate().toLocaleDateString("vi-VN") : "";
    const bonusAmt = b.bonusAmount ? b.bonusAmount.toLocaleString("vi-VN") + "đ" : "";
    el.innerHTML = bonusCard("#0a6ebd", "party", "Đã sử dụng bonus!",
      `<div style="font-size:14px;color:#555">Bạn đã nhận <b style="color:#0a6ebd">+${bonusAmt}</b> bonus vào lần rút ngày ${usedDate}.</div>`) + renderAllCodesList();
    updateBonusBadge(null);
    return;
  }

  el.innerHTML = bonusCard("#ccc", "clock", "Ưu đãi đã hết hạn",
    `<div style="font-size:14px;color:#777">Mã bonus đã hết hạn sử dụng.</div>`) + renderAllCodesList();
  updateBonusBadge(null);
}

async function renderRefSection() {
  const el = document.getElementById("ref-section");
  if (!el || !me) return;
  const userData = cachedUserDoc?.data || {};
  const refCode = userData.refCode || (me ? me.slice(-7).toUpperCase() : null);
  if (!refCode) return;
  const refLink = `${location.origin}/login?ref=${refCode}`;

  const refSnap = await getDocs(query(collection(db, 'users'), where('referredBy', '==', me), limit(50)));
  const refCount = refSnap.size;

  el.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:16px;box-shadow:0 2px 12px rgba(0,0,0,0.08);margin-bottom:4px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="font-size:14px;font-weight:700;color:#222">🔗 Link giới thiệu</div>
        <div style="background:#fff5f2;border-radius:20px;padding:4px 12px;display:flex;align-items:center;gap:5px">
          <span style="font-size:15px;font-weight:800;color:#EE4D2D">${refCount}</span>
          <span style="font-size:11px;color:#aaa">người đã ref</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;background:#f7f7f7;border-radius:10px;padding:9px 12px">
        <span style="font-size:12px;color:#666;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${refLink}</span>
        <button onclick="copyRefLink()" id="copy-ref-btn" style="flex-shrink:0;background:#EE4D2D;color:#fff;border:none;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer">Copy</button>
      </div>
    </div>`;
}

window.copyRefLink = function () {
  const refCode = (cachedUserDoc?.data?.refCode) || (me ? me.slice(-7).toUpperCase() : '');
  const refLink = `${location.origin}/login?ref=${refCode}`;
  const btn = document.getElementById("copy-ref-btn");
  navigator.clipboard.writeText(refLink).then(() => {
    if (btn) { btn.textContent = "✅ Đã copy"; setTimeout(() => { btn.textContent = "Copy"; }, 2000); }
  });
};

function updateBonusBadge(status) {
  const show = (status === "pending" || status === "active") ? "inline-block" : "none";
  const badge = document.getElementById("nav-bonus-badge");
  if (badge) badge.style.display = show;
  const badgeB = document.getElementById("nav-bonus-badge-b");
  if (badgeB) badgeB.style.display = show;
}

window.copyBonusSyntax = function () {
  const txt = document.getElementById("bonus-syntax-text")?.textContent || "";
  const btn = document.getElementById("bonus-copy-btn");
  navigator.clipboard.writeText(txt).then(() => {
    if (btn) {
      btn.textContent = "✅ Đã copy!";
      btn.style.background = "#22c55e";
      setTimeout(() => {
        btn.textContent = "📋 Copy";
        btn.style.background = "#EE4D2D";
      }, 2000);
    }
  }).catch(() => {
    if (btn) {
      btn.textContent = "❌ Lỗi";
      setTimeout(() => { btn.textContent = "📋 Copy"; }, 2000);
    }
  });
};

// ─── NAV TABS ─────────────────────────────────────────────
window.showMainTab = function (tab) {
  document.getElementById("main-search").style.display = tab === "search" ? "block" : "none";
  document.getElementById("main-mine").style.display = tab === "mine" ? "block" : "none";
  document.getElementById("main-bonus").style.display = tab === "bonus" ? "block" : "none";
  document.getElementById("main-convert").style.display = tab === "convert" ? "block" : "none";
  document.getElementById("nav-search").classList.toggle("active", tab === "search");
  document.getElementById("nav-mine").classList.toggle("active", tab === "mine");
  document.getElementById("nav-bonus").classList.toggle("active", tab === "bonus");
  document.getElementById("nav-convert").classList.toggle("active", tab === "convert");
  const bs = document.getElementById("bnav-search");
  const bm = document.getElementById("bnav-mine");
  const bb = document.getElementById("bnav-bonus");
  const bc = document.getElementById("bnav-convert");
  if (bs) bs.classList.toggle("active", tab === "search");
  if (bm) bm.classList.toggle("active", tab === "mine");
  if (bb) bb.classList.toggle("active", tab === "bonus");
  if (bc) bc.classList.toggle("active", tab === "convert");
};

// ─── SWIPE BETWEEN TABS ───────────────────────────────────
(function () {
  let startX = 0, startY = 0;
  const THRESHOLD = 60;
  const MAX_Y = 80;
  const TABS = ["search", "mine", "bonus", "convert"];

  const container = document.getElementById("app-screen");
  if (!container) return;

  container.addEventListener("touchstart", e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  container.addEventListener("touchend", e => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dy) > MAX_Y) return;
    if (Math.abs(dx) < THRESHOLD) return;

    const currentIdx = TABS.findIndex(t => {
      const el = document.getElementById("main-" + t);
      return el && el.style.display !== "none";
    });
    if (currentIdx === -1) return;
    if (dx < 0 && currentIdx < TABS.length - 1) window.showMainTab(TABS[currentIdx + 1]);
    if (dx > 0 && currentIdx > 0) window.showMainTab(TABS[currentIdx - 1]);
  }, { passive: true });
})();

window.switchTab = function (tab) {
  document.getElementById("tab-login").style.display = tab === "login" ? "block" : "none";
  document.getElementById("tab-register").style.display = tab === "register" ? "block" : "none";
  document.getElementById("tab-forgot").style.display = tab === "forgot" ? "block" : "none";
  document.querySelectorAll(".auth-tab").forEach((el, i) =>
    el.classList.toggle("active", (tab === "login" && i === 0) || (tab === "register" && i === 1))
  );
};
window.showForgotPassword = function () {
  switchTab("forgot");
};

// ─── AUTH ACTIONS ─────────────────────────────────────────
window.doLinkZalo = function (msgId = "bonus-link-msg") {
  const msg = document.getElementById(msgId);
  if (msg) { msg.className = "amsg"; msg.textContent = "⏳ Đang kết nối với Zalo...."; msg.style.display = "block"; }
  localStorage.setItem('zalo_link_mode', '1');
  localStorage.setItem('zalo_msg_id', msgId);
  const appId = '1150083649033793704';
  const redirectUrl = encodeURIComponent(window.location.origin + '/login');
  const state = crypto.randomUUID();
  sessionStorage.setItem('zalo_oauth_state', state);
  window.location.href = `https://oauth.zaloapp.com/v4/permission?app_id=${appId}&redirect_uri=${redirectUrl}&state=${state}`;
};

window.doLoginZalo = function (msgId = "login-msg") {
  // Xoá cờ liên kết còn sót lại nếu có lần "Liên kết Zalo" trước đó bị bỏ dở
  // (đóng tab giữa đường...) — nếu không, đăng nhập bình thường ở đây sẽ bị
  // handleZaloOauth() hiểu nhầm thành LINK MODE và tự nhảy qua tab Bonus.
  localStorage.removeItem('zalo_link_mode');

  const msg = document.getElementById(msgId);
  msg.className = "amsg";
  msg.textContent = "⏳ Đang kết nối với Zalo....";
  msg.style.display = "block";

  const appId = '1150083649033793704';
  const redirectUrl = encodeURIComponent(window.location.origin + '/login');
  const state = crypto.randomUUID(); // Sinh state ngẫu nhiên chống CSRF

  sessionStorage.setItem('zalo_oauth_state', state);

  // Lưu lại ID của message box để hiện thị lỗi sau khi redirect về
  localStorage.setItem('zalo_msg_id', msgId);

  window.location.href = `https://oauth.zaloapp.com/v4/permission?app_id=${appId}&redirect_uri=${redirectUrl}&state=${state}`;
};

async function handleZaloFirebaseLogin(zaloId, name, msgEl, serverPass = null) {
  const email = `${zaloId}@zalo.com`;

  // Nếu có serverPass (do server API trả về từ Firestore) thì giải mã base64 để dùng
  let pass = serverPass ? atob(serverPass) : null;

  try {
    if (pass) {
      // Đăng nhập bằng pass giải mã được
      await signInWithEmailAndPassword(auth, email, pass);
      msgEl.className = "amsg ok";
      msgEl.textContent = "✅ Đăng nhập thành công!";
      return;
    }

    // Nếu chưa có pass, thử đăng nhập bằng password default (dành cho các user cũ chưa được migrate)
    const oldPass = `ZaloAuth_${zaloId}_#`;
    await signInWithEmailAndPassword(auth, email, oldPass);
    msgEl.className = "amsg ok";
    msgEl.textContent = "✅ Đăng nhập thành công!";
  } catch (e) {
    // Nếu không tìm thấy user hoặc sai password, tạo mới với pass ngẫu nhiên an toàn
    if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password') {
      try {
        const randomArray = new Uint8Array(16);
        crypto.getRandomValues(randomArray);
        const newPass = Array.from(randomArray).map(b => b.toString(16).padStart(2, '0')).join('');

        const cred = await createUserWithEmailAndPassword(auth, email, newPass);
        await updateProfile(cred.user, { displayName: name });
        await setDoc(doc(db, "users", cred.user.uid), {
          name: name,
          email: email,
          role: "user",
          createdAt: serverTimestamp(),
          zaloId: zaloId,
          zaloPass: btoa(newPass) // Mã hóa nhẹ (base64) trước khi lưu vào Firestore
        });

        msgEl.className = "amsg ok";
        msgEl.textContent = "✅ Đăng ký thành công!";
      } catch (err) {
        msgEl.className = "amsg err";
        msgEl.textContent = "❌ Lỗi tạo tài khoản: " + err.message;
      }
    } else {
      msgEl.className = "amsg err";
      msgEl.textContent = "❌ Lỗi đăng nhập: " + e.message;
    }
  }
}

window.doLogin = async function () {
  const email = document.getElementById("login-email").value.trim();
  const pass = document.getElementById("login-pass").value;
  const msg = document.getElementById("login-msg");
  msg.className = "amsg";
  if (!email || !pass) { msg.className = "amsg err"; msg.textContent = "Vui lòng nhập đầy đủ."; return; }
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    msg.className = "amsg err";
    msg.textContent = e.code === "auth/invalid-credential" ? "❌ Email hoặc mật khẩu không đúng." : "❌ " + e.message;
  }
};

window.doRegister = async function () {
  const name = document.getElementById("reg-name").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const pass = document.getElementById("reg-pass").value;
  const refEmail = document.getElementById("reg-ref").value.trim();
  const msg = document.getElementById("reg-msg");
  msg.className = "amsg";
  // Xoá lỗi cũ
  ["reg-name", "reg-email", "reg-pass"].forEach(id => {
    const el = document.getElementById(id);
    el.style.borderColor = "";
    const err = el.parentElement.querySelector(".field-err");
    if (err) err.remove();
  });

  let hasErr = false;
  function fieldErr(id, text) {
    const el = document.getElementById(id);
    el.style.borderColor = "#e53e3e";
    const span = document.createElement("span");
    span.className = "field-err";
    span.style.cssText = "color:#e53e3e;font-size:12px;margin-top:3px;display:block";
    span.textContent = text;
    el.parentElement.appendChild(span);
    hasErr = true;
  }

  if (!name) fieldErr("reg-name", "Vui lòng nhập họ tên");
  if (!email) fieldErr("reg-email", "Vui lòng nhập email");
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fieldErr("reg-email", "Email không hợp lệ");
  if (!pass) fieldErr("reg-pass", "Vui lòng nhập mật khẩu");
  else if (pass.length < 6) fieldErr("reg-pass", "Mật khẩu phải ít nhất 6 ký tự");
  if (hasErr) return;
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, "users", cred.user.uid), { name, email, role: "user", refEmail, createdAt: serverTimestamp() });
    // Cập nhật tên trực tiếp vì onAuthStateChanged đã fire trước khi updateProfile xong
    myName = name;
    cachedUserDoc = { uid: cred.user.uid, data: { name, email, role: "user", refEmail } };
    document.getElementById("header-uname").textContent = name;
    document.getElementById("welcome-name").textContent = name;
    msg.className = "amsg ok"; msg.textContent = "✅ Đăng ký thành công!";
    setTimeout(showBonusWelcomeTip, 800);
  } catch (e) {
    msg.className = "amsg err";
    msg.textContent = e.code === "auth/email-already-in-use" ? "❌ Email đã được dùng." : "❌ " + e.message;
  }
};

window.doForgotPassword = async function () {
  const email = document.getElementById("forgot-email").value.trim();
  const msg = document.getElementById("forgot-msg");
  msg.className = "amsg";
  if (!email) { msg.className = "amsg err"; msg.textContent = "Vui lòng nhập email."; return; }
  try {
    const btn = document.querySelector('#tab-forgot .btn-main');
    btn.disabled = true; btn.textContent = "Đang gửi...";
    await sendPasswordResetEmail(auth, email);
    msg.className = "amsg ok"; msg.textContent = "✅ Đã gửi link tới email của bạn (kiểm tra cả thư rác).";
    btn.disabled = false; btn.textContent = "Gửi Lại Lần Nữa";
  } catch (e) {
    const btn = document.querySelector('#tab-forgot .btn-main');
    btn.disabled = false; btn.textContent = "Gửi Email Khôi Phục";
    msg.className = "amsg err";
    if (e.code === "auth/invalid-email") msg.textContent = "❌ Email không hợp lệ.";
    else if (e.code === "auth/user-not-found") msg.textContent = "❌ Không tìm thấy tài khoản với email này.";
    else msg.textContent = "❌ Lỗi: " + e.message;
  }
};

window.toggleEmailLogin = function () {
  const form = document.getElementById("email-login-form");
  const toggle = document.getElementById("email-login-toggle");
  if (!form) return;
  const isOpen = form.style.display !== "none";
  form.style.display = isOpen ? "none" : "block";
  if (toggle) toggle.textContent = isOpen ? "▼ Đăng nhập bằng Email / Mật khẩu" : "▲ Ẩn đăng nhập Email";
};

window.doLoginGoogle = async function (msgId) {
  const msg = document.getElementById(msgId);
  try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    const existingSnap = await getDoc(doc(db, "users", user.uid));
    // Chỉ coi là "user mới" khi document thực sự chưa tồn tại — user cũ thiếu
    // field createdAt KHÔNG được tính là mới, tránh bị stamp lại createdAt = now
    // (gây hiểu nhầm "vừa tạo tài khoản" và tự nhảy qua tab Bonus sai)
    const isNewUser = !existingSnap.exists();
    const myRefCode = user.uid.slice(-7).toUpperCase();

    const updateData = {
      name: user.displayName || "",
      avatar: user.photoURL || "",
      email: user.email || "",
      role: existingSnap.exists() ? (existingSnap.data().role || "user") : "user",
      loginType: "google",
      updatedAt: serverTimestamp(),
    };
    if (!existingSnap.data()?.refCode) updateData.refCode = myRefCode;
    if (isNewUser) {
      updateData.createdAt = serverTimestamp();
      const pendingRef = localStorage.getItem('pendingRef');
      if (pendingRef && pendingRef !== myRefCode) {
        const refSnap = await getDocs(query(collection(db, 'users'), where('refCode', '==', pendingRef), limit(1)));
        if (!refSnap.empty) updateData.referredBy = refSnap.docs[0].id;
      }
      localStorage.removeItem('pendingRef');
    }
    await setDoc(doc(db, "users", user.uid), updateData, { merge: true });

    // Cập nhật cache ngay để loadMyBonus đọc đúng loginType
    const mergedData = { ...(existingSnap.data() || {}), ...updateData };
    cachedUserDoc = { uid: user.uid, data: mergedData };
    if (!me) me = user.uid;
    await loadMyBonus();
    if (isNewUser) setTimeout(showBonusWelcomeTip, 800);

    if (msg) { msg.className = "amsg ok"; msg.textContent = "✅ Đăng nhập Google thành công!"; }
  } catch (err) {
    if (msg) { msg.className = "amsg err"; msg.textContent = "❌ " + err.message; }
  }
};

window.toggleLogoutMenu = function () {
  const menu = document.getElementById("logout-menu");
  if (!menu) return;
  const isOpen = menu.style.display !== "none";
  menu.style.display = isOpen ? "none" : "block";
  if (!isOpen) {
    setTimeout(() => document.addEventListener("click", function handler(e) {
      if (!menu.contains(e.target)) { menu.style.display = "none"; document.removeEventListener("click", handler); }
    }), 0);
  }
};

function showToast(msg, duration = 3000) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#fff;padding:10px 20px;border-radius:20px;font-size:14px;font-weight:600;z-index:99999;white-space:nowrap;pointer-events:none';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

function showBonusWelcomeTip() {
  // Xoá tip cũ
  document.querySelectorAll('.bonus-welcome-tip').forEach(el => el.remove());

  // Ưu tiên bottom nav (mobile), fallback top nav
  const btn = document.getElementById('bnav-bonus') || document.getElementById('nav-bonus');
  if (!btn) return;

  const rect = btn.getBoundingClientRect();
  const tip = document.createElement('div');
  tip.className = 'bonus-welcome-tip';
  tip.innerHTML = '🎁 Bạn có Quà Chào Mừng<div style="position:absolute;top:100%;left:50%;transform:translateX(-50%);border:5px solid transparent;border-top-color:#EE4D2D"></div>';
  tip.style.cssText = `position:fixed;bottom:${window.innerHeight - rect.top + 8}px;left:${rect.left + rect.width / 2}px;transform:translateX(-50%);background:#EE4D2D;color:#fff;font-size:12px;font-weight:600;white-space:nowrap;padding:6px 12px;border-radius:8px;pointer-events:none;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,.25)`;
  document.body.appendChild(tip);

  // Tự xoá sau 8 giây
  setTimeout(() => tip.remove(), 8000);
}

window.doLogout = async function () {
  if (!confirm('Bạn có chắc muốn đăng xuất không?')) return;
  _clearOrdersCache();
  cachedUserDoc = null;
  me = null;
  myOrders = [];
  await signOut(auth);

  const searchResult = document.getElementById("search-result");
  if (searchResult) searchResult.innerHTML = "";

  const orderId = document.getElementById("orderId");
  if (orderId) orderId.value = "";

  const bankFullname = document.getElementById("bank-fullname");
  if (bankFullname) {
    bankFullname.value = "";
    bankFullname.disabled = false;
  }

  const bankAccount = document.getElementById("bank-account");
  if (bankAccount) {
    bankAccount.value = "";
    bankAccount.disabled = false;
  }

  const bankName = document.getElementById("bank-name");
  if (bankName) bankName.disabled = false;

  const btnSaveBank = document.getElementById("btn-save-bank");
  if (btnSaveBank) {
    btnSaveBank.style.display = "block";
    btnSaveBank.textContent = "Lưu Thông Tin Mặc Định";
  }

  const bankInfoMsg = document.getElementById("bank-info-msg");
  if (bankInfoMsg) bankInfoMsg.style.display = "none";
};

// ─── BANK API ─────────────────────────────────────────────
let banksList = [];
window.loadBanksList = async function () {
  const select = document.getElementById("bank-name");
  try {
    let data;
    const r2 = await fetch("https://api.vietqr.io/v2/banks");
    data = await r2.json();
    banksList = data.data || [];
    select.innerHTML = '<option value="">-- Chọn ngân hàng --</option>' + banksList.map(b => `<option value="${escapeHTML(b.short_name || b.shortName)}">${escapeHTML(b.name)} (${b.short_name || b.shortName})</option>`).join("");
  } catch (err) {
    select.innerHTML = '<option value="">-- Lỗi tải danh sách ngân hàng --</option>';
  }
};

window.saveBankInfo = async function () {
  const fullname = document.getElementById("bank-fullname").value.trim().toUpperCase();
  const bank = document.getElementById("bank-name").value;
  const account = document.getElementById("bank-account").value.trim();

  if (!fullname || !bank || !account) {
    alert("❌ Vui lòng điền đầy đủ cả 3 thông tin!");
    return;
  }

  if (!confirm("⚠️ Chú ý: Bạn chỉ được nhập thông tin thanh toán MỘT LẦN DUY NHẤT.\n\nNếu sai sót sẽ không nhận được tiền. Bạn có chắc chắn thông tin cung cấp là CHÍNH XÁC không?")) return;

  const btn = document.getElementById("btn-save-bank");
  btn.disabled = true; btn.textContent = "⏳ Đang lưu...";
  try {
    await updateDoc(doc(db, "users", me), {
      bankFullName: fullname,
      bankName: bank,
      bankAccount: account,
      updatedAt: serverTimestamp()
    });
    myBankInfo = { bankFullName: fullname, bankName: bank, bankAccount: account };
    alert("✅ Lưu thông tin thanh toán thành công!\nBạn có thể Yêu cầu thanh toán ngay bây giờ.");
    document.getElementById("bank-info-modal").style.display = "none";
  } catch (e) {
    alert("❌ Lỗi lưu thông tin (có quyền bị giới hạn hoặc lỗi định dạng): " + e.message);
  } finally {
    btn.disabled = false; btn.textContent = "Lưu Thông Tin";
  }
};

// ─── CONVERT TAB ──────────────────────────────────────────
const SUPPORTED_URL_RE = /https?:\/\/(shope\.ee|vn\.shp\.ee|shopee\.vn|s\.shopee\.vn|sandeal\.io\.vn)[^\s​‌‍﻿\)\]\>"']*/gi;
const ANY_URL_RE_CV    = /https?:\/\/[^\s​‌‍﻿\)\]\>"']*/gi;

let _saveConvertTimer = null;
window.updateConvertClearBtn = function() {
  const btn = document.getElementById('convert-clear-btn');
  const has = !!document.getElementById('convert-input')?.value;
  if (btn) { btn.style.color = has ? '#EE4D2D' : '#ccc'; btn.style.fontWeight = has ? '700' : '400'; }
};

window.saveConvertSettings = function() {
  const affId = document.getElementById('convert-aff-id')?.value || '';
  const subId = document.getElementById('convert-sub-id')?.value || '';
  localStorage.setItem('convert_aff_id', affId);
  localStorage.setItem('convert_sub_id', subId);
  // Debounce Firestore save 1.5s
  clearTimeout(_saveConvertTimer);
  _saveConvertTimer = setTimeout(() => {
    if (me) setDoc(doc(db, 'users', me), { convertAffId: affId, convertSubId: subId }, { merge: true });
  }, 1500);
};

async function loadConvertSettings() {
  const affEl = document.getElementById('convert-aff-id');
  const subEl = document.getElementById('convert-sub-id');
  if (!affEl || !subEl) return;
  // Ưu tiên Firestore, fallback localStorage
  const userData = cachedUserDoc?.data;
  if (userData?.convertAffId) {
    affEl.value = userData.convertAffId;
    subEl.value = userData.convertSubId || '';
  } else {
    affEl.value = localStorage.getItem('convert_aff_id') || '';
    subEl.value = localStorage.getItem('convert_sub_id') || '';
  }
}

window.doConvert = async function() {
  const text = document.getElementById('convert-input')?.value?.trim();
  const affiliateId = document.getElementById('convert-aff-id')?.value?.trim();
  const subId = document.getElementById('convert-sub-id')?.value?.trim() || '';
  const status = document.getElementById('convert-status');
  const outputWrap = document.getElementById('convert-output-wrap');
  const outputEl = document.getElementById('convert-output');
  const btn = document.getElementById('btn-convert');

  if (!text) { alert('Vui lòng dán text vào ô input.'); return; }
  if (!affiliateId) { alert('Vui lòng điền Affiliate ID.'); return; }

  // Validate: tìm link không hỗ trợ
  const allUrls = [...text.matchAll(ANY_URL_RE_CV)].map(m => m[0]);
  const supportedUrls = [...text.matchAll(SUPPORTED_URL_RE)].map(m => m[0]);
  const unsupported = allUrls.filter(u => !supportedUrls.some(s => u.startsWith(s)));
  if (unsupported.length) {
    const preview = unsupported.slice(0, 2).map(u => u.slice(0, 50) + (u.length > 50 ? '…' : '')).join('\n');
    if (!confirm(`⚠️ Có ${unsupported.length} link không hỗ trợ (sẽ bị bỏ qua):\n${preview}\n\nTiếp tục?`)) return;
  }

  btn.disabled = true; btn.textContent = '⏳ Đang xử lý...';
  status.textContent = '';
  if (outputWrap) outputWrap.style.display = 'none';

  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) { alert('Vui lòng đăng nhập lại.'); return; }

    const resp = await fetch('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, affiliateId, subId, token })
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Lỗi không xác định');

    outputEl.textContent = data.result;
    outputWrap.style.display = 'block';
    status.textContent = `✅ Đã chuyển ${data.done}/${data.total} link`;
  } catch(e) {
    status.textContent = '❌ ' + e.message;
  } finally {
    btn.disabled = false; btn.textContent = '⚡ Chuyển đổi';
  }
};

window.copyConvertOutput = function() {
  const txt = document.getElementById('convert-output')?.textContent;
  if (!txt) return;
  navigator.clipboard.writeText(txt).then(() => showToast('📋 Đã copy kết quả!'));
};

// ─── SWIPE NAVIGATION (theo thứ tự: newsfeed > search > mine > bonus > convert) ───
(function initSwipeNav() {
  if (window.innerWidth > 680) return;

  const TAB_ORDER = ['search', 'mine', 'bonus', 'convert'];
  const TAB_LABEL = { search: 'Tìm đơn', mine: 'Đơn của tôi', bonus: 'Bonus', convert: 'Chuyển đổi' };
  const TAB_ICON  = { search: '🔍', mine: '📦', bonus: '🎁', convert: '⚡' };

  function getCurrentTab() {
    for (const t of TAB_ORDER) {
      const el = document.getElementById('bnav-' + t) || document.getElementById('nav-' + t);
      if (el && el.classList.contains('active')) return t;
    }
    return 'search';
  }

  // Tạo panel preview (dùng chung, cập nhật nội dung theo hướng swipe)
  const panel = document.createElement('div');
  panel.style.cssText = `display:none;position:fixed;top:0;bottom:0;left:0;right:0;
    z-index:998;background:#f0f2f5;transform:translateX(100%);
    flex-direction:column;overflow:hidden;pointer-events:none;
    font-family:system-ui,-apple-system,sans-serif;`;
  document.body.appendChild(panel);

  // Cập nhật nội dung panel theo destination
  function setPanelContent(dest) {
    if (dest === 'newsfeed') {
      panel.innerHTML = `
        <div style="background:#fff;border-bottom:1px solid #e0e0e0;padding:12px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0">
          <img src="/logo.png" style="width:28px;height:28px;border-radius:50%;object-fit:cover"/>
          <span style="font-size:15px;font-weight:700;color:#222">Sdeal.vn</span>
        </div>
        <div style="background:#fff;margin:8px 0 0;padding:14px 16px;flex-shrink:0">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <div style="width:36px;height:36px;border-radius:50%;background:#eee;flex-shrink:0"></div>
            <div><div style="width:100px;height:11px;background:#eee;border-radius:6px;margin-bottom:5px"></div>
            <div style="width:60px;height:9px;background:#f3f3f3;border-radius:6px"></div></div>
          </div>
          <div style="height:10px;background:#eee;border-radius:6px;margin-bottom:6px;width:90%"></div>
          <div style="height:10px;background:#eee;border-radius:6px;width:70%"></div>
          <div style="height:150px;background:#eee;border-radius:10px;margin-top:10px"></div>
        </div>
        <div style="background:#fff;margin:8px 0 0;padding:14px 16px;flex-shrink:0">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <div style="width:36px;height:36px;border-radius:50%;background:#eee;flex-shrink:0"></div>
            <div><div style="width:80px;height:11px;background:#eee;border-radius:6px;margin-bottom:5px"></div></div>
          </div>
          <div style="height:10px;background:#eee;border-radius:6px;width:85%"></div>
        </div>
        <div class="sp-label" style="position:absolute;bottom:80px;left:0;right:0;
          text-align:center;font-size:13px;font-weight:700;color:#EE4D2D;
          background:rgba(255,255,255,0.9);padding:6px 0">Cộng đồng</div>`;
    } else {
      const icon  = TAB_ICON[dest]  || '📄';
      const label = TAB_LABEL[dest] || dest;
      panel.innerHTML = `
        <div style="background:#EE4D2D;padding:12px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0">
          <span style="font-size:16px;font-weight:700;color:#fff">🛍️ Sandeal</span>
        </div>
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px">
          <div style="font-size:56px">${icon}</div>
          <div style="font-size:16px;font-weight:700;color:#333">${label}</div>
        </div>
        <!-- Bottom nav -->
        <div style="height:60px;background:#fff;border-top:1px solid #eee;display:flex;flex-shrink:0">
          ${TAB_ORDER.map(t => `
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
              color:${t===dest?'#EE4D2D':'#999'};border-top:2px solid ${t===dest?'#EE4D2D':'transparent'}">
              <span style="font-size:18px">${TAB_ICON[t]}</span>
              <span style="font-size:9px;font-weight:${t===dest?700:400}">${TAB_LABEL[t]}</span>
            </div>`).join('')}
        </div>
        <div class="sp-label" style="position:absolute;top:50%;left:0;right:0;transform:translateY(-50%);
          text-align:center;font-size:13px;font-weight:700;color:#EE4D2D;
          background:rgba(255,255,255,0.88);padding:6px 0">${label}</div>`;
    }
  }

  let startX = 0, startY = 0, swipeX = 0, isSwiping = false, swipeDir = 0, dest = null;

  const resetPanel = () => {
    panel.style.transition = 'none';
    panel.style.display = 'none';
    panel.style.transform = 'translateX(100%)';
  };

  const applyTransform = (absDx) => {
    if (dest !== 'newsfeed') return;
    const w = window.innerWidth;
    const pct = Math.max(0, 100 - (absDx / w) * 100);
    panel.style.transform = swipeDir > 0 ? `translateX(-${pct}%)` : `translateX(${pct}%)`;
    panel.style.display = absDx > 5 ? 'flex' : 'none';
    const label = panel.querySelector('.sp-label');
    if (label) label.textContent = absDx >= w * 0.5 ? '✓ Thả để mở' : 'Cộng đồng';
  };

  const onStart = (e) => {
    if (window.innerWidth > 680) return;
    const t = e.target;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'
     || t.tagName === 'BUTTON' || t.tagName === 'A'
     || t.closest('[data-swipe-ignore]')) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    isSwiping = false; swipeX = 0; swipeDir = 0; dest = null;
    resetPanel();
  };

  const onMove = (e) => {
    if (!startX || window.innerWidth > 680) return;
    const rawDx = e.touches[0].clientX - startX;
    const dy    = Math.abs(e.touches[0].clientY - startY);
    const absDx = Math.abs(rawDx);
    if (absDx < 10) return;
    if (dy > absDx * 0.8) {
      // Bị lệch dọc → cancel, reset sạch
      startX = 0;
      if (isSwiping) resetPanel();
      isSwiping = false;
      return;
    }

    if (!isSwiping) {
      swipeDir = rawDx > 0 ? 1 : -1;
      const cur = getCurrentTab();
      const idx = TAB_ORDER.indexOf(cur);
      if (swipeDir === 1) {
        dest = idx === 0 ? 'newsfeed' : TAB_ORDER[idx - 1];
      } else {
        dest = idx < TAB_ORDER.length - 1 ? TAB_ORDER[idx + 1] : null;
      }
      if (!dest) { startX = 0; return; }
      setPanelContent(dest);
    }

    isSwiping = true;
    e.preventDefault();
    swipeX = Math.min(absDx, window.innerWidth);
    applyTransform(swipeX);
  };

  const onEnd = () => {
    if (!isSwiping) {
      // Không thực sự swipe, đảm bảo panel sạch
      resetPanel();
      startX = 0;
      return;
    }
    const w = window.innerWidth;
    if (swipeX >= w * 0.5 && dest) {
      if (dest === 'newsfeed') {
        panel.style.transition = 'transform 0.25s ease';
        applyTransform(w);
        setTimeout(() => { window.location.href = '/'; }, 220);
      } else {
        resetPanel();
        window.showMainTab && window.showMainTab(dest);
      }
    } else {
      if (dest === 'newsfeed') {
        panel.style.transition = 'transform 0.25s ease';
        applyTransform(0);
        setTimeout(resetPanel, 260);
      } else {
        resetPanel();
      }
    }
    isSwiping = false; startX = 0; swipeX = 0;
  };

  document.addEventListener('touchstart', onStart, { passive: true });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd);

  window.addEventListener('resize', () => {
    if (window.innerWidth > 680) panel.style.display = 'none';
  });
})();
