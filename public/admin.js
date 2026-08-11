import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, updateProfile, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, getDocs, doc, getDoc, setDoc, updateDoc,
  deleteDoc, query, where, orderBy, limit, serverTimestamp, writeBatch,
  getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const cfg = window.ENV || {};
const app  = initializeApp(cfg);
const auth = getAuth(app);
const db   = getFirestore(app);

function escapeHTML(str) {
  if (typeof str !== 'string' && typeof str !== 'number') return '';
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

let allUsers = [], allOrders = [], allShortLinks = [], allPaymentRequests = [];
let ordersLastLoaded = 0;
let ordersLastSyncTs = 0; // mốc updatedAt (ms) mới nhất đã đồng bộ — dùng cho incremental sync
const ORDERS_CACHE_TTL = 5 * 60 * 1000; // 5 phút
let currentOrderPage = 1;
const ORDERS_PER_PAGE = 100;

// ─── AUTH ──────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists() && snap.data().role === "admin") {
      document.getElementById("adm-name").textContent = snap.data().name || user.email;
      document.getElementById("admin-auth").style.display  = "none";
      document.getElementById("admin-panel").style.display = "block";
      loadAll();
    } else {
      // Bỏ `await signOut(auth);` để không kick văng user đang đăng nhập ở tab khác
      showAuthErr("❌ Tài khoản không có quyền admin.");
    }
  } else {
    document.getElementById("admin-auth").style.display  = "flex";
    document.getElementById("admin-panel").style.display = "none";
  }
});

async function loadAll() { await Promise.all([loadUsers(), loadOrders(), loadPaymentRequests(), loadBonusCodes()]); populateUserFilter(); populateRefFilter(); renderDashboard(); }

// ─── LOAD ──────────────────────────────────────────────────
async function loadUsers() {
  const snap = await getDocs(collection(db, "users"));
  allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  allUsers.sort((a, b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
  renderUsers();
  // Re-render orders sau khi có allUsers (tránh hiện UID khi orders load từ cache trước)
  if (allOrders.length > 0) renderOrders();
}
const ORDERS_LS_KEY = 'admin_orders_cache_v3'; // v3: thêm lastSyncTs cho incremental sync

function _saveOrdersCache(data, lastSyncTs) {
  try {
    localStorage.setItem(ORDERS_LS_KEY, JSON.stringify({ data, lastSyncTs, ts: Date.now() }));
  } catch (e) {
    // QuotaExceededError: localStorage đầy → cache không lưu được, fallback fetch Firestore
    console.warn('Orders cache không lưu được vào localStorage:', e.message);
  }
}

function _clearOrdersCache() {
  localStorage.removeItem(ORDERS_LS_KEY);
  localStorage.removeItem('admin_orders_cache_v2'); // dọn cache bản cũ
  sessionStorage.removeItem('admin_orders_cache_v1');
}

// Giá trị updatedAt (ms) lớn nhất trong danh sách, dùng làm mốc cho lần incremental sync sau
function _maxUpdatedAt(list, base = 0) {
  let max = base;
  for (const o of list) {
    const t = o.updatedAt?.toMillis ? o.updatedAt.toMillis() : 0;
    if (t > max) max = t;
  }
  return max;
}

// Fetch lại TOÀN BỘ đơn hàng — dùng khi chưa có cache, hoặc khi phát hiện có đơn
// bị xoá (incremental sync không tự thấy được document đã xoá).
async function _fullReloadOrders() {
  const snap = await getDocs(query(collection(db, "orders"), orderBy("createdAt", "desc")));
  allOrders = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
  ordersLastSyncTs = _maxUpdatedAt(allOrders);
  ordersLastLoaded = Date.now();
  currentOrderPage = 1;
  _saveOrdersCache(allOrders, ordersLastSyncTs);
  renderOrders(); renderUsers();
}

// Load đơn hàng. Mặc định chỉ đồng bộ phần THAY ĐỔI kể từ lần trước (updatedAt mới hơn
// mốc đã lưu) để tiết kiệm số lượt đọc Firestore, thay vì fetch lại toàn bộ collection.
async function loadOrders(forceRefresh = false) {
  const now = Date.now();

  // 1. RAM cache còn hiệu lực (5 phút) → dùng luôn, trừ khi người dùng chủ động bấm "Làm mới"
  if (!forceRefresh && allOrders.length > 0 && (now - ordersLastLoaded) < ORDERS_CACHE_TTL) {
    renderOrders(); renderUsers(); return;
  }

  // 2. Xác định cache nền để đồng bộ incremental (ưu tiên RAM, fallback localStorage)
  let base = allOrders.length > 0 ? { data: allOrders, lastSyncTs: ordersLastSyncTs } : null;
  if (!base) {
    try {
      const ls = localStorage.getItem(ORDERS_LS_KEY);
      if (ls) {
        const parsed = JSON.parse(ls);
        if (parsed?.data?.length > 0) base = { data: parsed.data, lastSyncTs: parsed.lastSyncTs || 0 };
      }
    } catch (_) {}
  }

  // 3. Không có cache nào (lần đầu, hoặc sau khi cache bị xoá) → fetch toàn bộ
  if (!base) { await _fullReloadOrders(); return; }

  // 4. Có cache → chỉ fetch đơn có updatedAt mới hơn mốc đã đồng bộ lần trước
  try {
    const snap = await getDocs(query(
      collection(db, "orders"),
      where("updatedAt", ">", new Date(base.lastSyncTs)),
      orderBy("updatedAt")
    ));
    const changed = snap.docs.map(d => ({ _id: d.id, ...d.data() }));

    const cacheMap = new Map(base.data.map(o => [o._id, o]));
    changed.forEach(o => cacheMap.set(o._id, o));
    allOrders = [...cacheMap.values()];
    allOrders.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    ordersLastSyncTs = _maxUpdatedAt(changed, base.lastSyncTs);
    ordersLastLoaded = now;
    currentOrderPage = 1;
    _saveOrdersCache(allOrders, ordersLastSyncTs);

    // Đơn bị xoá sẽ không xuất hiện trong query trên (Firestore không trả về doc đã xoá).
    // Kiểm tra nhẹ bằng cách đếm số lượng thật trên server — getCountFromServer chỉ tốn
    // 1 read bất kể collection lớn cỡ nào. Lệch số lượng → có đơn bị xoá → fetch lại toàn bộ.
    const countSnap = await getCountFromServer(collection(db, "orders"));
    if (countSnap.data().count !== allOrders.length) {
      await _fullReloadOrders();
      return;
    }

    renderOrders(); renderUsers();
  } catch (e) {
    console.warn('Incremental sync lỗi, fallback fetch toàn bộ:', e.message);
    await _fullReloadOrders();
  }
}

let slSortMode = "newest"; // "newest" | "clicks"
const slCache = { newest: null, clicks: null }; // cache theo sort mode

async function loadShortLinks(forceReload = false) {
  // Dùng cache nếu có và không bị force reload
  if (!forceReload && slCache[slSortMode]) {
    allShortLinks = slCache[slSortMode];
    renderShortLinks();
    return;
  }
  try {
    const sortField = slSortMode === "clicks" ? "clicks" : "createdAt";
    const snap = await getDocs(query(collection(db, "shortlinks"), orderBy(sortField, "desc"), limit(20)));
    allShortLinks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    slCache[slSortMode] = allShortLinks;
  } catch (e) {
    console.error("Error loading shortlinks", e);
    // Fallback: load theo createdAt rồi sort client-side
    try {
      const snap2 = await getDocs(query(collection(db, "shortlinks"), orderBy("createdAt", "desc"), limit(20)));
      allShortLinks = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
      if (slSortMode === "clicks") {
        allShortLinks.sort((a, b) => (b.clicks || 0) - (a.clicks || 0));
      }
      slCache[slSortMode] = allShortLinks;
    } catch (e2) {
      console.error("Fallback error", e2);
      allShortLinks = [];
    }
  }
  renderShortLinks();
}

window.switchSLSort = async function(mode) {
  slSortMode = mode;
  document.getElementById("sl-sort-newest").classList.toggle("active", mode === "newest");
  document.getElementById("sl-sort-clicks").classList.toggle("active", mode === "clicks");
  await loadShortLinks();
};

window.loadOrders = loadOrders;

function getUserName(uid) {
  if (!uid) return "–";
  const u = allUsers.find(u => u.id === uid);
  return escapeHTML(u ? (u.name || u.email) : uid.slice(0,8)+"...");
}

// ─── DASHBOARD ─────────────────────────────────────────────
function renderDashboard() {
  const claimed = allOrders.filter(o => !!o.userId);
  const free    = allOrders.filter(o => !o.userId);
  document.getElementById("s-total").textContent   = allOrders.length;
  document.getElementById("s-claimed").textContent = claimed.length;
  document.getElementById("s-free").textContent    = free.length;
  document.getElementById("s-users").textContent   = allUsers.filter(u => u.role !== "admin").length;

  const recent = [...claimed].sort((a, b) => {
    const tA = (a.claimedAt && a.claimedAt.seconds) ? a.claimedAt.seconds : 0;
    const tB = (b.claimedAt && b.claimedAt.seconds) ? b.claimedAt.seconds : 0;
    return tB - tA;
  }).slice(0, 20);
  document.getElementById("dash-recent").innerHTML = recent.length === 0
    ? "<p style='color:#999;text-align:center'>Chưa có đơn nào được gán</p>"
    : `<div style="overflow-x:auto"><table>
        <thead><tr><th>ID Đơn hàng</th><th>Sản phẩm</th><th>Người gán</th><th>Giá trị (₫)</th><th>Chiết Khấu (₫)</th><th>Thao tác</th></tr></thead>
        <tbody>${recent.map(o => {
          const itemName = (o["Tên Item"] || "").toString();
          return `<tr>
          <td><code>${escapeHTML(o["ID đơn hàng"]||"")}</code></td>
          <td style="max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHTML(itemName)}">${escapeHTML(itemName || "–")}</td>
          <td>${getUserName(o.userId)}</td>
          <td>${(Number(o["Giá trị đơn hàng (₫)"])||0).toLocaleString("vi-VN")}</td>
          <td style="color:var(--orange)">${(Number(o["Chiết Khấu"])||0).toLocaleString("vi-VN")}</td>
          <td><button class="btn btn-outline btn-xs" onclick="resetClaim('${escapeHTML(o._id)}')">↩ Reset gán</button></td>
        </tr>`;
        }).join("")}</tbody>
      </table></div>`;
}

// ─── USERS ─────────────────────────────────────────────────
function populateRefFilter() {
  const sel = document.getElementById("filter-user-ref");
  if (!sel) return;
  const referrers = allUsers.filter(u => allUsers.some(x => x.referredBy === u.id));
  const current = sel.value;
  sel.innerHTML = `<option value="">-- Người giới thiệu --</option>` +
    referrers.map(u => `<option value="${u.id}" ${u.id === current ? 'selected' : ''}>${escapeHTML(u.name || u.email || u.id)}</option>`).join('');
}

function renderUsers() {
  const tbody = document.getElementById("users-tbody");
  if (!allUsers.length) { tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:24px;color:#999">Chưa có user</td></tr>`; return; }

  const kw = (document.getElementById("filter-user-search")?.value || "").toLowerCase().trim();
  const refFilter = document.getElementById("filter-user-ref")?.value || "";

  const filtered = allUsers.filter(u => {
    const kwMatch = !kw || (u.name || "").toLowerCase().includes(kw) || (u.email || "").toLowerCase().includes(kw) || (u.zaloId || "").toLowerCase().includes(kw);
    const refMatch = !refFilter || u.referredBy === refFilter;
    return kwMatch && refMatch;
  });

  if (!filtered.length) { tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:24px;color:#999">Không tìm thấy user nào</td></tr>`; return; }

  tbody.innerHTML = filtered.map(u => {
    const cnt  = allOrders.filter(o => o.userId === u.id).length;
    const refCount = allUsers.filter(x => x.referredBy === u.id).length;
    let date = "–";
    if (u.createdAt && typeof u.createdAt.toDate === "function") {
      date = u.createdAt.toDate().toLocaleDateString("vi-VN");
    }
    const referrer = u.referredBy ? (allUsers.find(x => x.id === u.referredBy)?.name || u.referredBy.slice(-7)) : "–";
    const bankStatus = u.bankAccount ? `<span class="badge badge-paid">✅ Đã điền</span>` : `<span class="badge badge-unpaid">Chưa có</span>`;

    return `<tr>
      <td>${escapeHTML(u.name || "–")}</td>
      <td>${escapeHTML(u.email)}</td>
      <td style="font-size:12px;color:#666">${escapeHTML(u.zaloId || "–")}</td>
      <td><span class="badge badge-${u.role === "admin" ? "admin" : "user"}">${u.role === "admin" ? "Admin" : "User"}</span></td>
      <td>${cnt}</td>
      <td>${bankStatus}</td>
      <td>${date}</td>
      <td>${escapeHTML(referrer)}${refCount > 0 ? ` <span style="background:#fff3e0;color:#EE4D2D;border-radius:10px;padding:1px 7px;font-size:11px;font-weight:700">${refCount} ref</span>` : ''}</td>
      <td style="display:flex;gap:4px;">${u.role !== "admin"
        ? `<button class="btn btn-outline btn-xs" style="color:var(--orange);border-color:var(--orange)" onclick="editUserBank('${escapeHTML(u.id)}')">💳 Bank</button>
           <button class="btn btn-outline btn-xs" style="color:var(--blue);border-color:var(--blue)" data-email="${escapeHTML(u.email)}" onclick="sendResetEmailToUser(this.dataset.email, this)">🔑 Đổi MK</button>
           <button class="btn btn-red btn-xs" data-uid="${escapeHTML(u.id)}" data-name="${escapeHTML(u.name||u.email)}" onclick="resetUserClaims(this.dataset.uid, this.dataset.name)">↩ Reset đơn</button>`
        : ""}</td>
    </tr>`;
  }).join("");
}
window.renderUsers = renderUsers;

// ─── USER BANK ADMIN EDIT ──────────────────────────────────
window.editUserBank = function(uid) {
  const u = allUsers.find(x => x.id === uid);
  if (!u) return;
  document.getElementById("eb-uid").value = uid;
  document.getElementById("eb-name").value = u.bankFullName || "";
  document.getElementById("eb-bank").value = u.bankName || "";
  document.getElementById("eb-account").value = u.bankAccount || "";
  document.getElementById("edit-bank-modal").style.display = "flex";
};

window.saveUserBank = async function() {
  const uid = document.getElementById("eb-uid").value;
  const name = document.getElementById("eb-name").value.trim().toUpperCase();
  const bank = document.getElementById("eb-bank").value.trim();
  const acc = document.getElementById("eb-account").value.trim();
  
  if (!uid) return;
  
  const btn = document.querySelector("#edit-bank-modal .btn-green");
  const oldText = btn.textContent;
  btn.disabled = true; btn.textContent = "⏳...";
  
  try {
    await updateDoc(doc(db, "users", uid), {
      bankFullName: name,
      bankName: bank,
      bankAccount: acc,
      updatedAt: serverTimestamp()
    });
    alert("✅ Cập nhật thông tin ngân hàng thành công!");
    document.getElementById("edit-bank-modal").style.display = "none";
    await loadUsers();
    renderDashboard();
  } catch(e) {
    alert("❌ Lỗi: " + e.message);
  } finally {
    btn.disabled = false; btn.textContent = oldText;
  }
};

window.openAddUser = function() {
  const p = document.getElementById("add-user-panel");
  p.style.display = p.style.display === "none" ? "block" : "none";
};

window.createUser = async function() {
  const name  = document.getElementById("nu-name").value.trim();
  const email = document.getElementById("nu-email").value.trim();
  const pass  = document.getElementById("nu-pass").value;
  const msgEl = document.getElementById("nu-msg");
  msgEl.innerHTML = "";
  if (!name||!email||!pass) { msgEl.innerHTML = `<div class="msg msg-err">Vui lòng nhập đầy đủ.</div>`; return; }
  try {
    const { initializeApp: ia2 } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
    const { getAuth: ga2, createUserWithEmailAndPassword: cup } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
    const app2  = ia2({ ...cfg }, "secondary-" + Date.now());
    const auth2 = ga2(app2);
    const cred  = await cup(auth2, email, pass);
    await auth2.signOut();
    await setDoc(doc(db, "users", cred.user.uid), { name, email, role: "user", createdAt: serverTimestamp() });
    msgEl.innerHTML = `<div class="msg msg-ok">✅ Tạo user thành công!</div>`;
    await loadUsers(); populateUserFilter(); renderDashboard();
    setTimeout(() => { document.getElementById("add-user-panel").style.display = "none"; }, 1500);
  } catch(e) {
    msgEl.innerHTML = `<div class="msg msg-err">❌ ${e.code === "auth/email-already-in-use" ? "Email đã tồn tại." : e.message}</div>`;
  }
};

window.sendResetEmailToUser = async function(email, btn) {
  if (!confirm(`Bạn có chắc muốn gửi email yêu cầu đổi mật khẩu tới:\n${email} ?`)) return;
  const oldText = btn.textContent;
  btn.disabled = true; btn.textContent = "⏳...";
  try {
    await sendPasswordResetEmail(auth, email);
    alert(`✅ Đã gửi email đổi mật khẩu tới ${email} thành công!`);
  } catch(e) {
    alert("❌ Lỗi gửi email: " + e.message);
  } finally {
    btn.disabled = false; btn.textContent = oldText;
  }
};

// ─── ORDERS ────────────────────────────────────────────────
function populateUserFilter() {
  const opts = allUsers.filter(u => u.role !== "admin").map(u => `<option value="${escapeHTML(u.id)}">${escapeHTML(u.name||u.email)}</option>`).join("");
  document.getElementById("filter-user").innerHTML = `<option value="">-- Lọc theo user --</option>` + opts;
}

function getCKValue(o) {
  let ck = Number(o["Chiết Khấu"]);
  if (isNaN(ck)) ck = Number((o["Chiết Khấu"]||"").toString().replace(/[^\d-]/g, ''));
  if (isNaN(ck) || ck === 0) {
    let ck2 = Number(o["Chiết Khấu 2%"]);
    if (isNaN(ck2)) ck2 = Number((o["Chiết Khấu 2%"]||"").toString().replace(/[^\d-]/g, ''));
    ck = ck2 || 0;
  }
  return ck;
}

// Build a Set of doc _id that are duplicates (same orderId + giá trị + HH Shopee)
function buildDupeSet(orders) {
  const map = {};
  orders.forEach(o => {
    const orderId = (o["ID Đơn hàng"] || "").trim();
    if (!orderId) return;
    const val = Number((o["Giá trị đơn hàng(₫)"] || "0").toString().replace(/[^\d-]/g, "")) || 0;
    const hh  = Number((o["Hoa hồng Shopee trên sản phẩm(₫)"] || "0").toString().replace(/[^\d-]/g, "")) || 0;
    const key = `${orderId}|${val}|${hh}`;
    if (!map[key]) map[key] = [];
    map[key].push(o._id);
  });
  const dupeSet = new Set();
  Object.values(map).forEach(ids => {
    if (ids.length > 1) ids.forEach(id => dupeSet.add(id));
  });
  return dupeSet;
}

let _currentDupeSet = new Set();

function isFraudOrder(o, dupeSet) {
  const status = (o["Trạng thái đặt hàng"] || "").trim();
  const isCancelled = status === "Đã huỷ" || status === "Đã hủy" || status === "Hủy";
  const isPaid = o.thanhToan === "Đã Thanh Toán";
  const ck = getCKValue(o);
  const hh = Number((o["Hoa hồng Shopee trên sản phẩm(₫)"] || "0").toString().replace(/[^\d-]/g, "")) || 0;

  const reasons = [];
  if (isPaid && isCancelled) reasons.push("Đã thanh toán nhưng đơn bị huỷ");
  if (ck > hh && hh > 0) reasons.push(`CK (${ck.toLocaleString("vi-VN")}đ) > HH Shopee (${hh.toLocaleString("vi-VN")}đ)`);
  if (dupeSet && dupeSet.has(o._id)) reasons.push("Đơn hàng trùng lặp (ID + Giá trị + HH giống nhau)");
  return reasons;
}

window.copyFraudOrders = function() {
  const dupeSet = _currentDupeSet;
  const fraudIds = new Set();
  allOrders.forEach(o => {
    if (isFraudOrder(o, dupeSet).length > 0) {
      const id = (o["ID Đơn hàng"] || "").trim();
      if (id) fraudIds.add(id);
    }
  });
  if (fraudIds.size === 0) { alert("Không có đơn nghi vấn nào."); return; }
  navigator.clipboard.writeText([...fraudIds].join("\n")).then(() => {
    const el = document.getElementById("os-fraud");
    if (el) { const prev = el.textContent; el.textContent = "✅ Đã copy!"; setTimeout(() => { renderOrders(); }, 1500); }
  });
};

function renderOrders(list) {
  const orders = list || allOrders;
  const tbody  = document.getElementById("orders-tbody");

  // Build dupe set from full allOrders (không chỉ trang hiện tại)
  _currentDupeSet = buildDupeSet(allOrders);

  // Tính tổng từ TOÀN BỘ danh sách (không phụ thuộc trang)
  let totalCK = 0, totalHH = 0, totalPaid = 0, fraudCount = 0;
  orders.forEach(o => {
    const ck = getCKValue(o);
    const hh = Number((o["Hoa hồng Shopee trên sản phẩm(₫)"] || "0").toString().replace(/[^\d-]/g, "")) || 0;
    totalCK += ck;
    totalHH += hh;
    if (o.thanhToan === "Đã Thanh Toán") totalPaid += ck;
    if (isFraudOrder(o, _currentDupeSet).length > 0) fraudCount++;
  });

  const elTotal = document.getElementById("os-total");
  const elCK = document.getElementById("os-ck");
  const elHH = document.getElementById("os-hh");
  const elPaid = document.getElementById("os-paid");
  const elProfit = document.getElementById("os-profit");
  const elFraud = document.getElementById("os-fraud");

  const uniqueOrderIds = new Set(orders.map(o => (o["ID đơn hàng"] || o._id || "").toString().split("_")[0]).filter(Boolean));
  if (elTotal) elTotal.textContent = uniqueOrderIds.size.toLocaleString("vi-VN");
  if (elCK) elCK.textContent = totalCK.toLocaleString("vi-VN") + " đ";
  if (elHH) elHH.textContent = totalHH.toLocaleString("vi-VN") + " đ";
  if (elPaid) elPaid.textContent = totalPaid.toLocaleString("vi-VN") + " đ";
  if (elProfit) elProfit.textContent = (totalHH - totalPaid).toLocaleString("vi-VN") + " đ";
  if (elFraud) {
    elFraud.textContent = fraudCount > 0 ? `⚠️ ${fraudCount} đơn nghi vấn` : "✅ Không phát hiện";
    elFraud.style.color = fraudCount > 0 ? "var(--red)" : "var(--green)";
    elFraud.style.cursor = fraudCount > 0 ? "pointer" : "default";
    elFraud.title = fraudCount > 0 ? "Bấm để copy danh sách ID đơn nghi vấn" : "";
    elFraud.onclick = fraudCount > 0 ? copyFraudOrders : null;
  }

  if (!orders.length) { tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:24px;color:#999">Không có đơn hàng</td></tr>`; renderOrderPagination(0, 0); return; }

  // Xoá check all khi render lại
  const chkAll = document.getElementById("chk-all-orders");
  if (chkAll) chkAll.checked = false;
  if (window.updateDeleteSelectedButton) window.updateDeleteSelectedButton();

  // Pagination — slice 100 items/trang
  const totalPages = Math.ceil(orders.length / ORDERS_PER_PAGE);
  if (currentOrderPage > totalPages) currentOrderPage = totalPages;
  const start = (currentOrderPage - 1) * ORDERS_PER_PAGE;
  const pageOrders = orders.slice(start, start + ORDERS_PER_PAGE);

  tbody.innerHTML = pageOrders.map(o => {
    const val = Number((o["Giá trị đơn hàng (₫)"]||"0").toString().replace(/[^\d-]/g, "")) || 0;
    const ck  = getCKValue(o);
    const hh  = Number((o["Hoa hồng Shopee trên sản phẩm(₫)"] || "0").toString().replace(/[^\d-]/g, "")) || 0;
    const claimed = !!o.userId;
    const payVal  = o.thanhToan || "";
    const payClass = payVal === "Đã Thanh Toán" ? "badge-paid" : payVal === "Chưa Thanh Toán" || payVal === "Đang chờ xử lý" ? "badge-unpaid" : "badge-free";
    const payBadge = `<span class="badge ${payClass}">${payVal || "– Chưa cập nhật"}</span>`;

    const fraudReasons = isFraudOrder(o, _currentDupeSet);
    const fraudBadge = fraudReasons.length > 0
      ? `<span title="${escapeHTML(fraudReasons.join('; '))}" style="cursor:help;color:var(--red);font-size:14px">⚠️</span>`
      : "";

    return `<tr${fraudReasons.length > 0 ? ' style="background:#fff5f5"' : ''}>
      <td style="text-align:center"><input type="checkbox" class="chk-order" value="${escapeHTML(o._id)}" onchange="toggleOrderCheckbox()"></td>
      <td><code>${escapeHTML(o["ID đơn hàng"]||"")}</code> ${fraudBadge}</td>
      <td>${val.toLocaleString("vi-VN")}</td>
      <td style="color:var(--orange);font-weight:600">
        ${ck.toLocaleString("vi-VN")} đ
        <button class="btn btn-outline btn-xs" style="margin-left:4px;font-size:10px;padding:1px 5px" onclick="editCK('${escapeHTML(o._id)}', ${ck})">✏️</button>
      </td>
      <td style="color:var(--green);font-weight:600">${hh.toLocaleString("vi-VN")} đ</td>
      <td>${escapeHTML(o["Trạng thái đặt hàng"] || "–")}</td>
      <td><span class="badge badge-${claimed?"claimed":"free"}">${claimed ? "✅ Đã gán" : "⏳ Chưa gán"}</span></td>
      <td>${payBadge}</td>
      <td>${getUserName(o.userId)}</td>
      <td style="display:flex;gap:6px">
        ${claimed ? `<button class="btn btn-outline btn-xs" onclick="resetClaim('${escapeHTML(o._id)}')">↩ Reset</button>` : ""}
        <button class="btn btn-red btn-xs" onclick="deleteOrder('${escapeHTML(o._id)}')">&#128465;</button>
      </td>
    </tr>`;
  }).join("");

  renderOrderPagination(orders.length, totalPages);
}

function renderOrderPagination(total, totalPages) {
  let el = document.getElementById("orders-pagination");
  if (!el) {
    el = document.createElement("div");
    el.id = "orders-pagination";
    el.style.cssText = "display:flex;align-items:center;gap:8px;justify-content:center;padding:12px 0;flex-wrap:wrap";
    const tbody = document.getElementById("orders-tbody");
    tbody?.closest("table")?.after(el);
  }
  if (totalPages <= 1) { el.innerHTML = ""; return; }

  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentOrderPage - 2 && i <= currentOrderPage + 2)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== "...") {
      pages.push("...");
    }
  }

  el.innerHTML = `
    <button class="btn btn-outline btn-xs" ${currentOrderPage === 1 ? "disabled" : ""} onclick="goOrderPage(${currentOrderPage - 1})">◀</button>
    ${pages.map(p => p === "..."
      ? `<span style="padding:0 4px">...</span>`
      : `<button class="btn btn-xs ${p === currentOrderPage ? "btn-green" : "btn-outline"}" onclick="goOrderPage(${p})">${p}</button>`
    ).join("")}
    <button class="btn btn-outline btn-xs" ${currentOrderPage === totalPages ? "disabled" : ""} onclick="goOrderPage(${currentOrderPage + 1})">▶</button>
    <span style="font-size:12px;color:#999">${total} đơn</span>
  `;
}

window.goOrderPage = function(page) {
  currentOrderPage = page;
  renderOrders(currentFilteredOrders.length > 0 || document.getElementById("filter-status")?.value || document.getElementById("filter-user")?.value || document.getElementById("filter-id")?.value
    ? currentFilteredOrders : undefined);
  document.getElementById("orders-tbody")?.closest(".card")?.scrollIntoView({ behavior: "smooth", block: "start" });
};

let currentFilteredOrders = [];

window.applyFilter = function() {
  const status  = document.getElementById("filter-status").value;
  const uid     = document.getElementById("filter-user").value;
  const keyword = document.getElementById("filter-id").value.toUpperCase().trim();
  const dateFrom = document.getElementById("filter-date-from")?.value;
  const dateTo = document.getElementById("filter-date-to")?.value;

  let f = allOrders;
  if (status === "claimed")   f = f.filter(o => !!o.userId);
  if (status === "free")      f = f.filter(o => !o.userId);
  if (status === "paid")      f = f.filter(o => o.thanhToan === "Đã Thanh Toán");
  if (status === "no-status") f = f.filter(o => o.thanhToan !== "Đã Thanh Toán");
  if (uid)     f = f.filter(o => o.userId === uid);
  if (keyword) f = f.filter(o => (o["ID đơn hàng"]||"").toUpperCase().includes(keyword));
  
  if (dateFrom || dateTo) {
    const dFrom = dateFrom ? new Date(dateFrom) : null;
    if (dFrom) dFrom.setHours(0, 0, 0, 0);
    const dTo = dateTo ? new Date(dateTo) : null;
    if (dTo) dTo.setHours(23, 59, 59, 999);

    f = f.filter(o => {
      const idStr = (o["ID đơn hàng"] || "").toString();
      if (!idStr || idStr.length < 6) return true; // Include if we can't parse
      const yy = parseInt(idStr.substring(0, 2), 10);
      const mm = parseInt(idStr.substring(2, 4), 10);
      const dd = parseInt(idStr.substring(4, 6), 10);
      
      if (isNaN(yy) || isNaN(mm) || isNaN(dd)) return true;
      
      const year = 2000 + yy;
      const month = mm - 1;
      const oDate = new Date(year, month, dd);
      
      if (dFrom && oDate < dFrom) return false;
      if (dTo && oDate > dTo) return false;
      return true;
    });
  }
  
  currentFilteredOrders = f;
  
  const btnCopy = document.getElementById("btn-copy-orders");
  if (btnCopy) {
    if (uid && f.length > 0) {
      btnCopy.style.display = "inline-block";
    } else {
      btnCopy.style.display = "none";
    }
  }
  
  renderOrders(f);
};

window.copyFilteredOrders = function() {
  if (!currentFilteredOrders || currentFilteredOrders.length === 0) return;
  
  const orderIds = currentFilteredOrders.map(o => o["ID đơn hàng"] || "").filter(Boolean);
  const uniqueOrderIds = [...new Set(orderIds)];
  
  if (uniqueOrderIds.length === 0) {
    alert("Không có mã đơn hàng nào để copy");
    return;
  }
  
  const textToCopy = uniqueOrderIds.join("\n");
  navigator.clipboard.writeText(textToCopy).then(() => {
    const btnCopy = document.getElementById("btn-copy-orders");
    const oldText = btnCopy.textContent;
    btnCopy.textContent = "✅ Đã copy " + uniqueOrderIds.length + " đơn";
    setTimeout(() => {
      btnCopy.textContent = "📋 Copy đơn hàng";
    }, 2000);
  }).catch(err => {
    console.error("Lỗi copy", err);
    alert("Không thể copy. Hãy thử lại!");
  });
};

// ─── SỬA CHIẾT KHẤU (admin only) ────────────────────────────
window.editCK = async function(docId, currentCK) {
  const input = prompt(`Nhập số tiền Chiết Khấu mới (hiện tại: ${Number(currentCK).toLocaleString("vi-VN")} đ):`, currentCK);
  if (input === null) return;
  const newCK = Number(input.toString().replace(/[^\d.-]/g, ''));
  if (isNaN(newCK) || newCK < 0) { alert("❌ Số tiền không hợp lệ."); return; }
  try {
    await updateDoc(doc(db, "orders", docId), { "Chiết Khấu": newCK, updatedAt: serverTimestamp() });
    const o = allOrders.find(o => o._id === docId);
    if (o) o["Chiết Khấu"] = newCK;
    await loadOrders(true); renderDashboard();
  } catch(e) {
    alert("❌ Lỗi cập nhật chiết khấu: " + e.message);
  }
};

// ─── DỌN DATA SAI: draft + real order bị tách đôi ───────────
window.fixDraftData = async function() {
  const input = prompt(
    "Nhập mã đơn hàng cần dọn (VD: 2506021234567).\n\nĐể trống và nhấn OK nếu muốn quét TOÀN BỘ database (không khuyến khích):"
  );
  if (input === null) return;

  const msgEl = document.getElementById("upload-msg");
  msgEl.innerHTML = `<div class="msg msg-info"><span class="spinner"></span> Đang xử lý...</div>`;

  try {
    let drafts = [];

    if (input.trim()) {
      const targetId = input.trim();
      const snap = await getDocs(
        query(collection(db, "orders"),
          where("ID đơn hàng", "==", targetId),
          where("Tên Item", "==", "Không có thông tin")
        )
      );
      drafts = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
      if (!drafts.length) {
        msgEl.innerHTML = `<div class="msg msg-ok">✅ Không tìm thấy đơn nháp nào cho mã: <strong>${targetId}</strong></div>`;
        return;
      }
    } else {
      if (!confirm("⚠️ Xác nhận quét TOÀN BỘ database?")) return;
      const snap = await getDocs(
        query(collection(db, "orders"), where("Tên Item", "==", "Không có thông tin"))
      );
      drafts = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
      if (!drafts.length) {
        msgEl.innerHTML = `<div class="msg msg-ok">✅ Không có đơn nháp nào cần dọn.</div>`;
        return;
      }
    }

    let fixed = 0, skipped = 0;
    const batch = writeBatch(db);

    for (const draft of drafts) {
      const orderId = (draft["ID đơn hàng"] || "").trim();
      if (!orderId) { skipped++; continue; }

      const realSnap = await getDocs(
        query(collection(db, "orders"), where("ID đơn hàng", "==", orderId))
      );
      const reals = realSnap.docs
        .map(d => ({ _id: d.id, ...d.data() }))
        .filter(o => o._id !== draft._id && o["Tên Item"] !== "Không có thông tin");

      if (!reals.length) {
        msgEl.innerHTML += `<div class="msg msg-err" style="margin-top:6px">⚠️ Chưa có real order cho mã: <strong>${orderId}</strong> — bỏ qua.</div>`;
        skipped++; continue;
      }

      for (const real of reals) {
        if (!real.userId && draft.userId) {
          batch.update(doc(db, "orders", real._id), {
            userId: draft.userId,
            claimedAt: draft.claimedAt || serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        }
      }

      batch.delete(doc(db, "orders", draft._id));
      fixed++;
    }

    await batch.commit();
    await loadOrders(true); renderDashboard();
    msgEl.innerHTML = `<div class="msg msg-ok">✅ Hoàn tất! Đã dọn <strong>${fixed}</strong> đơn. Bỏ qua: <strong>${skipped}</strong>.</div>`;
  } catch(e) {
    msgEl.innerHTML = `<div class="msg msg-err">❌ Lỗi: ${e.message}</div>`;
  }
};

// ─── SET PAYMENT (admin only) ────────────────────────────────
window.setPayment = async function(docId, sel) {
  const val = sel.value;
  // Update class for instant visual feedback
  sel.className = "pay-sel " + (val === "Đã Thanh Toán" ? "paid" : val === "Chưa Thanh Toán" || val === "Đang chờ xử lý" ? "unpaid" : "");
  try {
    await updateDoc(doc(db, "orders", docId), { thanhToan: val || null, updatedAt: serverTimestamp() });
    // Update local cache
    const o = allOrders.find(o => o._id === docId);
    if (o) o.thanhToan = val || null;
  } catch(e) {
    alert("❌ Lỗi cập nhật thanh toán: " + e.message);
    // Revert select
    sel.value = allOrders.find(o => o._id === docId)?.thanhToan || "";
  }
};

// Reset claim on single order
window.resetClaim = async function(docId) {
  if (!confirm("Reset gán đơn hàng này? Đơn sẽ trở về pool chung.")) return;
  await updateDoc(doc(db, "orders", docId), { userId: null, claimedAt: null, updatedAt: serverTimestamp() });
  await loadOrders(true); renderDashboard();
};

// Reset all claims for a user
window.resetUserClaims = async function(uid, name) {
  if (!confirm(`Reset tất cả đơn hàng của "${name}"? Chúng sẽ trở về pool chung.`)) return;
  const q    = query(collection(db, "orders"), where("userId", "==", uid));
  const snap = await getDocs(q);
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.update(d.ref, { userId: null, claimedAt: null, updatedAt: serverTimestamp() }));
  await batch.commit();
  await loadOrders(true); renderDashboard();
};

window.deleteOrder = async function(docId) {
  if (!confirm("Xóa đơn hàng này?")) return;
  await deleteDoc(doc(db, "orders", docId));
  await loadOrders(true); renderDashboard();
};

window.toggleAllOrders = function(source) {
  const checkboxes = document.querySelectorAll('.chk-order');
  checkboxes.forEach(cb => {
    cb.checked = source.checked;
  });
  updateDeleteSelectedButton();
};

window.toggleOrderCheckbox = function() {
  updateDeleteSelectedButton();
  const checkboxes = document.querySelectorAll('.chk-order');
  const allChecked = Array.from(checkboxes).every(cb => cb.checked);
  const chkAll = document.getElementById('chk-all-orders');
  if (chkAll) chkAll.checked = checkboxes.length > 0 && allChecked;
};

window.updateDeleteSelectedButton = function() {
  const checkedBoxes = document.querySelectorAll('.chk-order:checked');
  const btn = document.getElementById('btn-delete-selected');
  if (btn) {
    if (checkedBoxes.length > 0) {
      btn.style.display = 'inline-block';
      btn.textContent = `🗑️ Xóa đã chọn (${checkedBoxes.length})`;
    } else {
      btn.style.display = 'none';
    }
  }
};

window.deleteSelectedOrders = async function() {
  const checkedBoxes = document.querySelectorAll('.chk-order:checked');
  if (checkedBoxes.length === 0) return;
  if (!confirm(`Xóa ${checkedBoxes.length} đơn hàng đã chọn?`)) return;
  
  const CHUNK = 400;
  const idsToDelete = Array.from(checkedBoxes).map(cb => cb.value);
  
  const btn = document.getElementById('btn-delete-selected');
  const oldText = btn.textContent;
  btn.textContent = "⏳ Đang xoá...";
  btn.disabled = true;

  try {
    for (let i = 0; i < idsToDelete.length; i += CHUNK) {
      const batch = writeBatch(db);
      idsToDelete.slice(i, i + CHUNK).forEach(id => {
        batch.delete(doc(db, "orders", id));
      });
      await batch.commit();
    }
    await loadOrders(true); 
    renderDashboard();
  } catch (error) {
    alert("❌ Lỗi khi xoá: " + error.message);
  } finally {
    btn.textContent = oldText;
    btn.disabled = false;
  }
};

window.clearAllOrders = async function() {
  if (!confirm("⚠️ Xóa TOÀN BỘ đơn hàng? Thao tác này không thể hoàn tác!")) return;
  if (!confirm("Xác nhận lần 2: Xóa tất cả đơn hàng?")) return;
  const snap  = await getDocs(collection(db, "orders"));
  const CHUNK = 400;
  for (let i = 0; i < snap.docs.length; i += CHUNK) {
    const batch = writeBatch(db);
    snap.docs.slice(i, i+CHUNK).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  await loadOrders(true); renderDashboard();
};

// ─── UPLOAD ────────────────────────────────────────────────
let pendingData = null;

window.handleDrop = function(e) {
  e.preventDefault();
  document.getElementById("upload-area").classList.remove("dragover");
  if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
};
window.handleFile = function(file) { if (file) processFile(file); };

async function diffWithCache(newData) {
  // Đảm bảo cache đã load (fetch Firestore nếu chưa có)
  if (allOrders.length === 0) {
    document.getElementById("upload-msg").innerHTML =
      `<div class="msg msg-info"><span class="spinner"></span>Đang tải dữ liệu để so sánh...</div>`;
    try {
      await loadOrders(false);
    } finally {
      document.getElementById("upload-msg").innerHTML = "";
    }
    if (allOrders.length === 0) {
      throw new Error("Không thể tải dữ liệu để so sánh. Vui lòng thử lại.");
    }
  }

  let countNew = 0, countChanged = 0, countSame = 0;
  const statusChanges = {}; // "A → B": count
  const newOrdersList = [];    // orderId
  const changedOrdersList = []; // { orderId, oldStatus, newStatus, statusChanged }

  for (const order of newData) {
    const orderId  = (order["ID đơn hàng"] || "").toString().trim();
    const modelId  = (order["ID Model"]    || "").toString().trim();
    const price    = (order["Giá trị đơn hàng (₫)"] || "").toString().trim();
    const newStatus = (order["Trạng thái đặt hàng"] || "").toString().trim();

    // Tìm doc tương ứng trong cache (cùng logic với upload)
    const candidates = allOrders.filter(o => o["ID đơn hàng"] == orderId);
    let matched = candidates.find(o =>
      (o["ID Model"] || "").toString() === modelId &&
      (o["Giá trị đơn hàng (₫)"] || "").toString() === price
    ) || candidates.find(o =>
      (o["ID Model"] || "").toString() === modelId && candidates.length === 1
    ) || (candidates.length === 1 ? candidates[0] : null);

    if (!matched) {
      countNew++;
      newOrdersList.push(orderId || "(không có mã)");
    } else {
      // Mô phỏng ĐÚNG state machine thật trong confirmUpload(): trạng thái chỉ đổi khi
      // "Đang chờ xử lý" -> "Hoàn thành"/"Đã huỷ"; Chiết Khấu chỉ đổi (về 0) khi trạng
      // thái mới là "Đã huỷ" (bất kể trạng thái cũ) — còn lại giữ nguyên cả 2.
      const oldStatus = (matched["Trạng thái đặt hàng"] || "").toString().trim();
      const isCancelledNew = newStatus === "Đã huỷ" || newStatus === "Đã hủy" || newStatus === "Hủy";
      const statusChangeAllowed = oldStatus === "Đang chờ xử lý" && (newStatus === "Hoàn thành" || isCancelledNew);
      const finalStatus = statusChangeAllowed ? newStatus : oldStatus;

      const oldCK = String(matched["Chiết Khấu"] ?? "");
      const finalCK = isCancelledNew ? "0" : oldCK;
      const oldHH = String(matched["Hoa hồng Shopee trên sản phẩm(₫)"] ?? "");
      const newHH = String(order["Hoa hồng Shopee trên sản phẩm(₫)"] ?? "");

      const statusChanged = finalStatus !== oldStatus;
      const dataChanged = oldCK !== finalCK || oldHH !== newHH;
      if (statusChanged || dataChanged) {
        countChanged++;
        changedOrdersList.push({ orderId: orderId || "(không có mã)", oldStatus: oldStatus || "?", newStatus: finalStatus, statusChanged });
        if (statusChanged) {
          const key = `${oldStatus || "?"} → ${finalStatus}`;
          statusChanges[key] = (statusChanges[key] || 0) + 1;
        }
      } else {
        countSame++;
      }
    }
  }

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Render diff
  const changeRows = Object.entries(statusChanges)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #f0f0f0">
      <span style="color:#555;font-size:12px">${esc(k)}</span>
      <strong style="color:#EE4D2D;font-size:12px">${v}</strong>
    </div>`).join('');

  const newOrdersHtml = newOrdersList.length ? `
    <div style="font-size:12px;font-weight:600;color:#333;margin:10px 0 6px">🆕 Danh sách đơn mới (${newOrdersList.length}):</div>
    <div style="max-height:150px;overflow-y:auto;border:1px solid #f0f0f0;border-radius:6px;padding:6px 8px">
      ${newOrdersList.map(id => `<div style="font-size:12px;color:#555;padding:2px 0;border-bottom:1px solid #f7f7f7">${esc(id)}</div>`).join('')}
    </div>
  ` : '';

  const changedOrdersHtml = changedOrdersList.length ? `
    <div style="font-size:12px;font-weight:600;color:#333;margin:10px 0 6px">🔄 Danh sách đơn thay đổi (${changedOrdersList.length}):</div>
    <div style="max-height:180px;overflow-y:auto;border:1px solid #f0f0f0;border-radius:6px;padding:6px 8px">
      ${changedOrdersList.map(c => `
        <div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-bottom:1px solid #f7f7f7">
          <span style="font-size:12px;color:#555">${esc(c.orderId)}</span>
          <span style="font-size:12px;color:#EE4D2D;text-align:right;white-space:nowrap">${c.statusChanged ? `${esc(c.oldStatus)} → ${esc(c.newStatus)}` : 'Cập nhật CK/hoa hồng'}</span>
        </div>`).join('')}
    </div>
  ` : '';

  return `
    <div style="background:#fff;border:1px solid #e0e0e0;border-radius:10px;padding:14px;margin-bottom:12px">
      <div style="font-weight:700;font-size:14px;margin-bottom:10px">📊 So sánh với dữ liệu hiện tại</div>
      <div style="display:flex;gap:8px;margin-bottom:${changeRows ? 10 : 0}px">
        <div style="flex:1;background:#f0fff4;border:1px solid #b7ebc8;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:#22863a">${countNew}</div>
          <div style="font-size:11px;color:#555">🆕 Đơn mới${countNew > 0 ? '<br><span style="font-size:10px;color:#aaa">(ước tính)</span>' : ''}</div>
        </div>
        <div style="flex:1;background:#fff8f0;border:1px solid #ffd591;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:#EE4D2D">${countChanged}</div>
          <div style="font-size:11px;color:#555">🔄 Thay đổi</div>
        </div>
        <div style="flex:1;background:#f5f5f5;border:1px solid #e0e0e0;border-radius:8px;padding:10px;text-align:center">
          <div style="font-size:22px;font-weight:800;color:#999">${countSame}</div>
          <div style="font-size:11px;color:#555">✅ Không đổi</div>
        </div>
      </div>
      ${changeRows ? `<div style="font-size:12px;font-weight:600;color:#333;margin-bottom:6px">Chi tiết thay đổi trạng thái:</div>${changeRows}` : ''}
      ${newOrdersHtml}
      ${changedOrdersHtml}
    </div>
    <button class="btn btn-green" onclick="confirmUpload()">📤 Xác nhận Import</button>
  `;
}

function processFile(file) {
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) throw new Error("File JSON phải là mảng []");
      pendingData = data;
      document.getElementById("upload-preview").innerHTML =
        `<div class="msg msg-info"><span class="spinner"></span>Đang so sánh ${data.length} đơn...</div>`;
      document.getElementById("upload-msg").innerHTML = "";
      const diffHtml = await diffWithCache(data);
      document.getElementById("upload-preview").innerHTML = diffHtml;
    } catch(err) {
      document.getElementById("upload-preview").innerHTML = `<div class="msg msg-err">❌ ${err.message}</div>`;
    }
  };
  reader.readAsText(file);
}

window.confirmUpload = async function() {
  if (!pendingData) return;
  const msgEl = document.getElementById("upload-msg");
  msgEl.innerHTML = `<div class="msg msg-info"><span class="spinner"></span>Đang import ${pendingData.length} đơn hàng...</div>`;
  try {
    const CHUNK = 400;
    let countNew = 0, countUpdated = 0;

    let idCounter = {};
    let usedDocIds = new Set();

    // Build lookup map từ allUsers để auto-assign theo Sub_id2/Sub_id3/Sub_id4
    const userBySenderZaloId = {};
    const userByZaloUsername = {};
    const userByFbId = {};
    for (const u of allUsers) {
      if (u.senderZaloId) userBySenderZaloId[u.senderZaloId] = u.id;
      if (u.zaloUsername) userByZaloUsername[u.zaloUsername] = u.id;
      if (u.fbId) userByFbId[u.fbId] = u.id;
    }

    for (let i = 0; i < pendingData.length; i += CHUNK) {
      const batch = writeBatch(db);
      const slice = pendingData.slice(i, i + CHUNK);

      // Xử lý tuần tự (không dùng Promise.all) để tránh race condition với usedDocIds
      for (const order of slice) {
        const orderId = (order["ID đơn hàng"] || "").toString().trim();
        if (!orderId) {
          // No order ID — create with auto ID (fallback)
          const ref = doc(collection(db, "orders"));
          batch.set(ref, { ...order, userId: null, claimedAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
          countNew++;
          continue;
        }

        const modelId = (order["ID Model"] || "").toString().trim();
        const itemName = (order["Tên Item"] || "").toString().trim();
        const price = (order["Giá trị đơn hàng (₫)"] || "").toString().trim();

        // 1. Tìm các đơn cùng orderId trong bộ nhớ đệm
        const existingDocs = allOrders.filter(o => o["ID đơn hàng"] == orderId);
        let matchedDoc = null;

        // Ưu tiên match theo ID Model + Giá (trùng cả 3: orderId + modelId + giá)
        if (modelId) {
            matchedDoc = existingDocs.find(d =>
                d["ID Model"] == modelId &&
                (d["Giá trị đơn hàng (₫)"] || "").toString().trim() === price &&
                !usedDocIds.has(d._id)
            );
            // Fallback: match theo ID Model không có giá (doc cũ chưa có giá trong docId)
            if (!matchedDoc) {
                matchedDoc = existingDocs.find(d =>
                    d["ID Model"] == modelId &&
                    !d._id.includes(`_${price}`) &&
                    (existingDocs.filter(x => x["ID Model"] == modelId).length === 1) &&
                    !usedDocIds.has(d._id)
                );
            }
        }

        // Fallback: match theo Tên Item (đơn cũ trong DB chưa có ID Model)
        if (!matchedDoc && itemName) {
            matchedDoc = existingDocs.find(d =>
                !d["ID Model"] &&
                (d["Tên Item"] || "").trim() === itemName &&
                !usedDocIds.has(d._id)
            );
        }

        // Fallback cuối: match theo ID Model bất kể giá (trường hợp đơn huỷ / giá về 0)
        if (!matchedDoc && modelId) {
            const newStatus = (order["Trạng thái đặt hàng"] || "").toString().trim();
            const isCancelledNew = newStatus === "Đã huỷ" || newStatus === "Đã hủy" || newStatus === "Hủy";
            const newPrice = Number((order["Giá trị đơn hàng (₫)"] || "0").toString().replace(/[^\d]/g, "")) || 0;
            const byModel = existingDocs.filter(d => d["ID Model"] == modelId && !usedDocIds.has(d._id));
            // Nếu đơn huỷ hoặc giá = 0 → không tạo mới, luôn update vào doc cũ
            if (byModel.length === 1 || (byModel.length > 1 && (isCancelledNew || newPrice === 0))) {
                matchedDoc = byModel[0];
            }
        }

        // Đơn hàng ĐÃ CÓ trong database nhưng không match được:
        // - Nếu không có ID Model → bỏ qua để tránh tạo trùng
        if (!matchedDoc && existingDocs.length > 0 && !modelId) {
            continue;
        }

        // Fallback: nếu existingDocs rỗng (allOrders bị limit không load hết),
        // thử query thẳng Firestore theo plain orderId trước khi tạo mới
        if (!matchedDoc && existingDocs.length === 0) {
            try {
                const plainRef = doc(db, "orders", orderId);
                const plainSnap = await getDoc(plainRef);
                if (plainSnap.exists()) {
                    const d = { _id: plainSnap.id, ...plainSnap.data() };
                    const dModelId = (d["ID Model"] || "").toString().trim();
                    const dPrice = (d["Giá trị đơn hàng (₫)"] || "").toString().trim();
                    if (!usedDocIds.has(d._id) && (dModelId === modelId || !dModelId)) {
                        matchedDoc = d;
                        usedDocIds.add(d._id);
                    }
                }
            } catch (_) {}
        }

        let docId = "";
        let isExisting = false;

        if (matchedDoc) {
            docId = matchedDoc._id;
            usedDocIds.add(docId);
            isExisting = true;
        } else {
            // Hoàn toàn mới: docId = orderId_modelId_price
            let baseId = "";
            if (modelId) {
                baseId = price ? `${orderId}_${modelId}_${price}` : `${orderId}_${modelId}`;
            } else {
                // Fallback hash tên item nếu không có ID Model
                let hash = 0;
                for (let j = 0; j < itemName.length; j++) {
                  hash = ((hash << 5) - hash) + itemName.charCodeAt(j);
                  hash |= 0;
                }
                baseId = `${orderId}_${Math.abs(hash).toString(16)}`;
            }
            idCounter[baseId] = (idCounter[baseId] || 0) + 1;
            docId = idCounter[baseId] > 1 ? `${baseId}_${idCounter[baseId]}` : baseId;
            usedDocIds.add(docId);
        }

        const ref = doc(db, "orders", docId);

        if (isExisting) {
          // Đơn đã tồn tại — 2 quy tắc khoá:
          // 1. Trạng thái CHỈ được cập nhật đúng 2 chuyển tiếp: "Đang chờ xử lý" -> "Hoàn
          //    thành" hoặc "Đang chờ xử lý" -> "Đã huỷ". Mọi trường hợp khác giữ nguyên
          //    trạng thái đang có trong DB, bỏ qua giá trị trong JSON.
          // 2. Chiết Khấu chỉ đổi (về 0) khi JSON báo trạng thái mới là "Đã huỷ" — bất kể
          //    trạng thái cũ là gì. Các trường hợp còn lại giữ nguyên Chiết Khấu trong DB.
          const oldData = matchedDoc;
          const oldStatus = (oldData["Trạng thái đặt hàng"] || "").toString().trim();
          const newStatus = (order["Trạng thái đặt hàng"] || "").toString().trim();
          const isCancelledNew = newStatus === "Đã huỷ" || newStatus === "Đã hủy" || newStatus === "Hủy";

          const statusChangeAllowed = oldStatus === "Đang chờ xử lý" && (newStatus === "Hoàn thành" || isCancelledNew);
          const finalStatus = statusChangeAllowed ? newStatus : oldStatus;

          const oldCK = String(oldData["Chiết Khấu"] ?? "");
          const newCK = isCancelledNew ? "0" : oldCK; // giá trị CK thật sự sẽ được ghi
          const oldHH = String(oldData["Hoa hồng Shopee trên sản phẩm(₫)"] ?? "");
          const newHH = String(order["Hoa hồng Shopee trên sản phẩm(₫)"] ?? "");

          // Skip nếu không có gì thay đổi → tiết kiệm Firestore writes
          if (finalStatus === oldStatus && oldCK === newCK && oldHH === newHH) {
            continue;
          }

          const { userId, claimedAt, createdAt, ...orderFields } = order;
          orderFields["Trạng thái đặt hàng"] = finalStatus;

          if (isCancelledNew) {
            orderFields["Chiết Khấu"] = 0;
            if (orderFields["Chiết Khấu 2%"] !== undefined) orderFields["Chiết Khấu 2%"] = 0;
          } else {
            orderFields["Chiết Khấu"] = oldData["Chiết Khấu"] ?? null;
            if (oldData["Chiết Khấu 2%"] !== undefined) orderFields["Chiết Khấu 2%"] = oldData["Chiết Khấu 2%"];
          }

          batch.set(ref, { ...orderFields, updatedAt: serverTimestamp() }, { merge: true });
          countUpdated++;
        } else {
          // Đơn mới: tạo với userId = null (chưa gán)
          // Kiểm tra xem có đơn nháp (docId = plain orderId) không để kế thừa userId
          let inheritUserId = null;
          let inheritClaimedAt = null;
          const draftRef = doc(db, "orders", orderId);
          try {
            const draftSnap = await getDoc(draftRef);
            if (draftSnap.exists()) {
              const draftData = draftSnap.data();
              // Chỉ kế thừa nếu đây là đơn nháp (Tên Item = placeholder hoặc không có itemId)
              const isDraft = !draftData["Item ID"] && !draftData["itemID"] && !draftData["itemId"];
              if (isDraft && draftData.userId) {
                inheritUserId = draftData.userId;
                inheritClaimedAt = draftData.claimedAt || null;
              }
              // Xoá đơn nháp trong cùng batch
              batch.delete(draftRef);
            }
          } catch(e) {
            // Không ảnh hưởng đến việc tạo đơn mới
          }
          // Auto-assign userId theo Sub_id2 (senderZaloId), Sub_id3 (zaloUsername), Sub_id4 (fbId)
          if (!inheritUserId) {
            const sub2 = (order["Sub_id2"] || "").toString().trim();
            const sub3 = (order["Sub_id3"] || "").toString().trim();
            const sub4 = (order["Sub_id4"] || "").toString().trim();
            inheritUserId = (sub2 && userBySenderZaloId[sub2])
              || (sub3 && userByZaloUsername[sub3])
              || (sub4 && userByFbId[sub4])
              || null;
          }
          batch.set(ref, { ...order, userId: inheritUserId, claimedAt: inheritUserId ? serverTimestamp() : null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
          countNew++;
        }
      }

      await batch.commit();
    }

    msgEl.innerHTML = `<div class="msg msg-ok">
      ✅ Import thành công <strong>${pendingData.length}</strong> đơn hàng!
      <br><small>🆕 Thêm mới: <strong>${countNew}</strong> &nbsp;|  🔄 Cập nhật trạng thái: <strong>${countUpdated}</strong></small>
    </div>`;
    document.getElementById("upload-preview").innerHTML = "";
    pendingData = null;
    _clearOrdersCache();          // xóa cache cũ → lần load tiếp fetch all mới
    await loadOrders(true); renderDashboard();
  } catch(e) {
    msgEl.innerHTML = `<div class="msg msg-err">❌ ${e.message}</div>`;
  }
};

// ─── PAYMENTS ──────────────────────────────────────────────
async function loadPaymentRequests() {
  try {
    const snap = await getDocs(collection(db, "payment_requests"));
    allPaymentRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    allPaymentRequests.sort((a, b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
  } catch (e) {
    console.error("Error loading payment requests", e);
    allPaymentRequests = [];
  }
  
  const pendingCount = allPaymentRequests.filter(r => r.status === "pending").length;
  const badge = document.getElementById("payment-badge");
  if (badge) {
    badge.textContent = pendingCount > 0 ? `(${pendingCount})` : "";
  }

  renderPaymentRequests();
}
window.loadPaymentRequests = loadPaymentRequests;

function renderPaymentRequests() {
  const tbody = document.getElementById("payments-tbody");
  if (!allPaymentRequests.length) { tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:#999">Không có yêu cầu nào</td></tr>`; return; }
  
  const stFilter = document.getElementById("filter-pay-status")?.value || "";
  const txtFilter = (document.getElementById("filter-pay-search")?.value || "").toLowerCase();

  const filtered = allPaymentRequests.filter(r => {
    if (stFilter && r.status !== stFilter) return false;
    if (txtFilter) {
      const q = txtFilter;
      const uid = (r.requestId || "").toLowerCase();
      const uname = (r.userName || getUserName(r.userId) || "").toLowerCase();
      if (!uid.includes(q) && !uname.includes(q)) return false;
    }
    return true;
  });

  if (!filtered.length) { tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:#999">Không tìm thấy yêu cầu nào</td></tr>`; return; }

  tbody.innerHTML = filtered.map(r => {
    let date = "–";
    if (r.createdAt && typeof r.createdAt.toDate === "function") {
      date = r.createdAt.toDate().toLocaleString("vi-VN");
    }
    
    let stBadge = r.status === "approved" ? `<span class="badge badge-paid">✅ Đã duyệt</span>` : `<span class="badge badge-unpaid">⏳ Đang chờ</span>`;

    let paidDate = "–";
    if (r.paidAt && typeof r.paidAt.toDate === "function") {
      const d = r.paidAt.toDate();
      paidDate = d.toLocaleString("vi-VN", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
    }
    
    const uInfo = allUsers.find(x => x.id === r.userId) || {};
    const bankAcc = uInfo.bankAccount || "";
    const bankName = uInfo.bankName || "";
    const amount = r.totalPayout || r.totalValue || 0;
    const userName = (r.userName || "USER").trim();
    // Thay thế dấu gạch ngang/underscore bằng khoảng trắng vì VietQR xoá kí tự đặc biệt làm dính chữ
    const neatId = (r.requestId || "").replace(/_/g, ' '); 
    const desc = encodeURIComponent(`SANDEAL THANH TOAN ${neatId}`);
    const qrUrl = (bankAcc && bankName) ? `https://qr.sepay.vn/img?acc=${bankAcc}&bank=${bankName}&amount=${amount}&des=${desc}&template=compact` : '';
    
    
    
    let qrBtn = qrUrl ? `<button class="btn btn-outline btn-xs" style="color:var(--orange); border-color:var(--orange); margin-right:4px;" data-url="${escapeHTML(qrUrl)}" data-name="${escapeHTML(userName)}" data-bfull="${escapeHTML(uInfo.bankFullName || '')}" data-bname="${escapeHTML(bankName)}" data-bacc="${escapeHTML(bankAcc)}" onclick="showQR(this.dataset.url, this.dataset.name, this.dataset.bfull, this.dataset.bname, this.dataset.bacc)">📷 Lấy QR</button>` : '';

    let actionBtn = r.status === "pending" ?
      `${qrBtn}<button class="btn btn-green btn-xs" onclick="approvePayment('${escapeHTML(r.id)}')">✅ Duyệt thanh toán</button>
       <button class="btn btn-red btn-xs" onclick="deletePayment('${escapeHTML(r.id)}')" style="margin-left:4px;">🗑️ Xoá</button>` :
      `<button class="btn btn-xs" style="background:#6c757d;color:#fff;margin-right:4px;" onclick="getPaymentJson('${escapeHTML(r.id)}')">JSON</button>
       <button class="btn btn-red btn-xs" onclick="deletePayment('${escapeHTML(r.id)}')" style="margin-left:4px;">🗑️ Xoá</button>`;
      
    const orderCodes = (r.orderIds || []).map(id => id.split('_')[0]);
    const uniqueCodes = [...new Set(orderCodes)].filter(Boolean);
      
    return `<tr>
      <td><code>${escapeHTML(r.requestId)}</code></td>
      <td>${escapeHTML(r.userName || getUserName(r.userId))}</td>
      <td>
        <div style="font-weight: 600;">${r.totalCount} đơn</div>
        <div style="font-size: 11px; color: #666; max-width: 200px; white-space: normal; line-height: 1.5; margin-top: 4px;">
          ${uniqueCodes.map(id => `<code>${escapeHTML(id)}</code>`).join(", ")}
        </div>
      </td>
      <td style="font-weight:600;color:var(--orange)">${(r.totalValue||0).toLocaleString("vi-VN")} đ</td>
      <td>${r.bonusApplied
        ? `<span style="color:var(--green);font-weight:600">+${(r.bonusAmount||0).toLocaleString("vi-VN")} đ</span><br><span style="font-size:11px;color:#888">(+${r.bonusPercent||0}%)</span>`
        : `<span style="color:#ccc">–</span>`}</td>
      <td style="font-weight:700;color:var(--blue)">${(r.totalPayout||r.totalValue||0).toLocaleString("vi-VN")} đ</td>
      <td>${date}</td>
      <td>${paidDate}</td>
      <td>${stBadge}</td>
      <td>${actionBtn}</td>
    </tr>`;
  }).join("");
}

window.approvePayment = async function(reqId) {
  if (!confirm("Xác nhận đã thanh toán cho yêu cầu này?\\nThao tác này sẽ tự động chuyển tất cả đơn hàng trong yêu cầu sang trạng thái 'Đã Thanh Toán'.")) return;
  
  const req = allPaymentRequests.find(r => r.id === reqId);
  if (!req || !req.orderIds || !req.orderIds.length) return;
  
  try {
    const batch = writeBatch(db);
    
    // Update request
    const reqRef = doc(db, "payment_requests", reqId);
    batch.update(reqRef, { status: "approved", paidAt: serverTimestamp(), updatedAt: serverTimestamp() });
    
    // Update orders
    req.orderIds.forEach(orderId => {
      const orderRef = doc(db, "orders", orderId);
      batch.update(orderRef, { thanhToan: "Đã Thanh Toán", updatedAt: serverTimestamp() });
    });
    
    await batch.commit();
    alert("✅ Đã duyệt yêu cầu thành công!");
    await Promise.all([loadPaymentRequests(), loadOrders()]);
  } catch (e) {
    alert("❌ Lỗi duyệt yêu cầu: " + e.message);
  }
};

window.getPaymentJson = function(reqId) {
  const r = allPaymentRequests.find(x => x.id === reqId);
  if (!r) return;

  let payment_date = "";
  if (r.paidAt && typeof r.paidAt.toDate === "function") {
    const d = r.paidAt.toDate();
    const dd = String(d.getDate()).padStart(2,"0");
    const mm = String(d.getMonth()+1).padStart(2,"0");
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2,"0");
    const min = String(d.getMinutes()).padStart(2,"0");
    payment_date = `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  }

  const json = {
    user_name: r.userName || "",
    orders: r.totalCount || 0,
    products: (r.orderIds || []).length,
    saved_money: r.totalPayout || r.totalValue || 0,
    payment_date,
  };

  const str = JSON.stringify(json, null, 2);
  navigator.clipboard?.writeText(str).then(() => {
    alert("✅ Đã copy JSON vào clipboard!\n\n" + str);
  }).catch(() => {
    prompt("Copy JSON bên dưới:", str);
  });
};

// ─── SHORTLINKS ────────────────────────────────────────────
let currentSLPage = 1;
const SL_PER_PAGE = 100;

function renderShortLinks() {
  const tbody = document.getElementById("shortlinks-tbody");
  if (!allShortLinks.length) { tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:#999">Chưa có link nào</td></tr>`; renderSLPagination(0, 0); return; }

  const totalPages = Math.ceil(allShortLinks.length / SL_PER_PAGE);
  if (currentSLPage > totalPages) currentSLPage = totalPages;
  const start = (currentSLPage - 1) * SL_PER_PAGE;
  const pageLinks = allShortLinks.slice(start, start + SL_PER_PAGE);

  const domain = window.location.origin + "/";
  tbody.innerHTML = pageLinks.map(s => {
    const shortLink = domain + s.id;
    const originUrl = s.url || "";
    let date = "–";
    if (s.createdAt && typeof s.createdAt.toDate === "function") {
      date = s.createdAt.toDate().toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
    }
    return `<tr>
      <td><a href="${shortLink}" target="_blank" style="color:var(--blue);font-weight:600;text-decoration:none">${shortLink}</a></td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHTML(originUrl)}">${escapeHTML(originUrl)}</td>
      <td>${date}</td>
      <td>${s.clicks || 0}</td>
      <td style="display:flex;gap:4px;">
        <button class="btn btn-outline btn-xs" data-link="${escapeHTML(originUrl)}" onclick="copyToClipboard(this.dataset.link, this)">📋 Copy</button>
        <button class="btn btn-red btn-xs" onclick="deleteShortLink('${escapeHTML(s.id)}')">🗑️</button>
      </td>
    </tr>`;
  }).join("");

  renderSLPagination(allShortLinks.length, totalPages);
}

function renderSLPagination(total, totalPages) {
  let el = document.getElementById("sl-pagination");
  if (!el) {
    el = document.createElement("div");
    el.id = "sl-pagination";
    el.style.cssText = "display:flex;align-items:center;gap:8px;justify-content:center;padding:12px 0;flex-wrap:wrap";
    document.getElementById("shortlinks-tbody")?.closest("table")?.after(el);
  }
  if (totalPages <= 1) { el.innerHTML = ""; return; }
  el.innerHTML = `
    <button class="btn btn-outline btn-xs" ${currentSLPage === 1 ? "disabled" : ""} onclick="goSLPage(${currentSLPage - 1})">◀</button>
    <span style="font-size:13px">Trang ${currentSLPage}/${totalPages}</span>
    <button class="btn btn-outline btn-xs" ${currentSLPage === totalPages ? "disabled" : ""} onclick="goSLPage(${currentSLPage + 1})">▶</button>
    <span style="font-size:12px;color:#999">${total} links</span>
  `;
}

window.goSLPage = function(page) {
  currentSLPage = page;
  renderShortLinks();
};

window.copyToClipboard = function(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const old = btn.innerHTML;
    btn.innerHTML = "✅ Copied";
    setTimeout(() => btn.innerHTML = old, 1500);
  });
};

window.deleteShortLink = async function(id) {
  if (!confirm("Xóa link rút gọn này?")) return;
  await deleteDoc(doc(db, "shortlinks", id));
  slCache.newest = null; slCache.clicks = null;
  await loadShortLinks(true);
};

window.createShortLink = async function() {
  const url = document.getElementById("sl-url").value.trim();
  const msg = document.getElementById("sl-msg");
  msg.innerHTML = "";
  if (!url) { msg.innerHTML = `<div class="msg msg-err">Vui lòng nhập link gốc.</div>`; return; }
  if (!url.startsWith("http")) { msg.innerHTML = `<div class="msg msg-err">Link phải có dạng http:// hoặc https://</div>`; return; }
  
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let shortCode = '';
  for (let i = 0; i < 10; i++) {
    shortCode += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  msg.innerHTML = `<div class="msg msg-info"><span class="spinner"></span> Đang tạo...</div>`;
  try {
    await setDoc(doc(db, "shortlinks", shortCode), {
      url: url,
      clicks: 0,
      createdAt: serverTimestamp()
    });
    
    msg.innerHTML = `<div class="msg msg-ok">✅ Rút gọn thành công! Link đã được thêm vào danh sách.</div>`;
    document.getElementById("sl-url").value = "";
    slCache.newest = null; slCache.clicks = null;
    await loadShortLinks(true);
  } catch (e) {
    msg.innerHTML = `<div class="msg msg-err">❌ Lỗi: ${e.message}</div>`;
  }
};

// ─── TABS / AUTH ───────────────────────────────────────────
window.showTab = function(tab) {
  document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
  document.getElementById("tab-" + tab).classList.add("active");
  document.querySelector(`[data-tab="${tab}"]`).classList.add("active");
  const titles = { dashboard: "Dashboard", orders: "Đơn hàng", users: "Users", payments: "Yêu Cầu Thanh Toán", upload: "Upload JSON", shortlinks: "Rút gọn Link" };
  document.getElementById("topbar-title").textContent = titles[tab] || tab;
  const sidebar = document.querySelector(".sidebar");
  if (sidebar && sidebar.classList.contains("show")) sidebar.classList.remove("show");
  // Lazy load shortlinks khi vào tab
  if (tab === "shortlinks" && allShortLinks.length === 0) loadShortLinks();
};

window.adminLogin = async function() {
  const email = document.getElementById("adm-email").value.trim();
  const pass  = document.getElementById("adm-pass").value;
  try { await signInWithEmailAndPassword(auth, email, pass); }
  catch(e) { showAuthErr("❌ Email hoặc mật khẩu không đúng."); }
};
window.adminLogout = async function() { await signOut(auth); };

function showAuthErr(text) {
  const m = document.getElementById("adm-msg");
  m.className = "amsg err"; m.textContent = text;
}

window.showQR = function(url, uname, bFullName, bName, bAcc) {
  document.getElementById("qr-img-preview").src = url;
  if(document.getElementById("qr-username")) {
    document.getElementById("qr-username").textContent = uname || "Không có";
    document.getElementById("qr-bank-fullname").textContent = bFullName || "Không có";
    document.getElementById("qr-bank-name").textContent = bName || "Không có";
    document.getElementById("qr-bank-account").textContent = bAcc || "Không có";
  }
  document.getElementById("qr-modal").style.display = "flex";
};

window.deletePayment = async function(reqId) {
  if (!confirm("⚠️ CẢNH BÁO: Bạn có chắc chắn muốn XOÁ yêu cầu thanh toán này không?\\n\\nLưu ý: Thao tác này chỉ xoá phiếu yêu cầu trên hệ thống. Các đơn hàng bên trong yêu cầu sẽ KHÔNG bị mất, chúng vẫn ở trạng thái hiện tại (Đang chờ xử lý).")) return;
  
  try {
    const { deleteDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    await deleteDoc(doc(db, "payment_requests", reqId));
    alert("✅ Đã xoá yêu cầu thanh toán thành công!");
    await loadPaymentRequests();
  } catch(e) {
    alert("❌ Lỗi khi xoá: " + e.message);
  }
};

// ─── BONUS CODES ───────────────────────────────────────────
let allBonusCodes = [];

async function loadBonusCodes() {
  try {
    const snap = await getDocs(collection(db, "bonusCodes"));
    allBonusCodes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    allBonusCodes.sort((a, b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0));
  } catch (e) {
    console.error("loadBonusCodes error", e);
    allBonusCodes = [];
  }
  renderBonusCodes();
}
window.loadBonusCodes = loadBonusCodes;

function renderBonusCodes() {
  // Stat cards
  const total = allBonusCodes.length;
  const pending = allBonusCodes.filter(b => b.status === "pending").length;
  const active = allBonusCodes.filter(b => b.status === "active").length;
  const used = allBonusCodes.filter(b => b.status === "used").length;
  const expired = allBonusCodes.filter(b => b.status === "expired" || (b.status === "active" && b.expireAt && new Date(b.expireAt?.seconds ? b.expireAt.seconds * 1000 : b.expireAt) < new Date())).length;

  const sTotal = document.getElementById("bonus-stat-total");
  const sPending = document.getElementById("bonus-stat-pending");
  const sActive = document.getElementById("bonus-stat-active");
  const sUsed = document.getElementById("bonus-stat-used");
  const sExpired = document.getElementById("bonus-stat-expired");
  if (sTotal) sTotal.textContent = total;
  if (sPending) sPending.textContent = pending;
  if (sActive) sActive.textContent = active;
  if (sUsed) sUsed.textContent = used;
  if (sExpired) sExpired.textContent = expired;

  const tbody = document.getElementById("bonus-tbody");
  if (!tbody) return;

  const stFilter = document.getElementById("filter-bonus-status")?.value || "";
  const txtFilter = (document.getElementById("filter-bonus-search")?.value || "").toLowerCase();
  const now = Date.now();

  let list = allBonusCodes.filter(b => {
    if (stFilter && b.status !== stFilter) return false;
    if (txtFilter) {
      const s = [b.code, b.zaloId, getUserName(b.userId)].join(" ").toLowerCase();
      if (!s.includes(txtFilter)) return false;
    }
    return true;
  });

  if (!list.length) { tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:#999">Không có dữ liệu</td></tr>`; return; }

  tbody.innerHTML = list.map(b => {
    const isExpired = b.status === "active" && b.expireAt && new Date(b.expireAt?.seconds ? b.expireAt.seconds * 1000 : b.expireAt) < new Date();
    const displayStatus = isExpired ? "expired" : b.status;

    const statusMap = {
      pending:  `<span class="badge badge-unpaid">🕐 Chờ kích hoạt</span>`,
      active:   `<span class="badge badge-paid">✅ Đã active</span>`,
      used:     `<span class="badge" style="background:#e3f2fd;color:#1565c0">🎉 Đã dùng</span>`,
      expired:  `<span class="badge" style="background:#f5f5f5;color:#999">⏰ Hết hạn</span>`,
      revoked:  `<span class="badge" style="background:#fce4ec;color:#b71c1c">🚫 Đã thu hồi</span>`,
    };

    const createdAt = b.createdAt?.seconds ? new Date(b.createdAt.seconds * 1000).toLocaleDateString("vi-VN") : "–";
    const activatedAt = b.activatedAt?.seconds ? new Date(b.activatedAt.seconds * 1000).toLocaleDateString("vi-VN") : "–";
    const activateDeadline = b.activateDeadline?.seconds ? new Date(b.activateDeadline.seconds * 1000).toLocaleDateString("vi-VN") : (b.activateDeadline ? new Date(b.activateDeadline).toLocaleDateString("vi-VN") : null);
    const expireAt = b.expireAt?.seconds ? new Date(b.expireAt.seconds * 1000).toLocaleDateString("vi-VN") : (b.expireAt ? new Date(b.expireAt).toLocaleDateString("vi-VN") : null);
    const usedAt = b.usedAt?.seconds ? new Date(b.usedAt.seconds * 1000).toLocaleDateString("vi-VN") : "–";
    const bonusAmt = b.bonusAmount ? `+${b.bonusAmount.toLocaleString("vi-VN")}đ` : "–";
    const userName = getUserName(b.userId) || b.userId || "–";

    const statusOptions = ["pending","active","used","expired","revoked"]
      .filter(s => s !== displayStatus)
      .map(s => `<option value="${s}">${{pending:"⏳ Pending",active:"✅ Active",used:"🎉 Used",expired:"⏰ Expired",revoked:"🚫 Revoked"}[s]}</option>`)
      .join("");
    const actions = `<div style="display:flex;gap:4px;align-items:center">
      <select onchange="changeBonusStatus('${escapeHTML(b.id)}', this)" style="font-size:11px;padding:3px 5px;border-radius:6px;border:1px solid #ddd;cursor:pointer">
        <option value="">Đổi trạng thái</option>
        ${statusOptions}
      </select>
    </div>`;

    return `<tr>
      <td><code>${escapeHTML(b.id)}</code></td>
      <td>${escapeHTML(userName)}</td>
      <td style="font-size:12px;color:#888">${escapeHTML(b.zaloId || "–")}</td>
      <td>${statusMap[displayStatus] || displayStatus}</td>
      <td style="color:var(--green);font-weight:600">${b.bonusPercent || 10}%</td>
      <td style="font-size:12px">${createdAt}<br><span style="color:#aaa">${activatedAt !== "–" ? "Active: " + activatedAt : ""}</span><br>${activateDeadline ? `<span style="color:#f57c00;font-size:11px">Hạn KH: ${activateDeadline}</span><br>` : ""}${expireAt ? `<span style="color:#e53935;font-size:11px">Hết hạn: ${expireAt}</span>` : ""}</td>
      <td style="color:var(--blue);font-weight:600">${bonusAmt}<br><span style="font-size:11px;color:#888">${usedAt !== "–" ? usedAt : ""}</span></td>
      <td>${actions}</td>
    </tr>`;
  }).join("");
}
window.renderBonusCodes = renderBonusCodes;

window.changeBonusStatus = async function(codeId, selectEl) {
  const newStatus = selectEl.value;
  if (!newStatus) return;
  if (!confirm(`Đổi mã ${codeId} sang trạng thái "${newStatus}"?`)) { selectEl.value = ""; return; }
  try {
    const updateData = { status: newStatus };
    if (newStatus === "active" && !selectEl.dataset.activatedAt) updateData.activatedAt = serverTimestamp();
    if (newStatus === "active") updateData.expireAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await setDoc(doc(db, "bonusCodes", codeId), updateData, { merge: true });
    await loadBonusCodes();
    alert(`✅ Đã đổi trạng thái mã ${codeId} → ${newStatus}`);
  } catch (e) {
    alert("❌ Lỗi: " + e.message);
    selectEl.value = "";
  }
};

window.revokeBonus = async function(codeId) {
  if (!confirm(`Thu hồi mã bonus ${codeId}?`)) return;
  try {
    await setDoc(doc(db, "bonusCodes", codeId), { status: "revoked" }, { merge: true });
    await loadBonusCodes();
    alert("✅ Đã thu hồi mã bonus.");
  } catch (e) {
    alert("❌ Lỗi: " + e.message);
  }
};

window.searchGrantUser = function() {
  const q = (document.getElementById("grant-bonus-search")?.value || "").toLowerCase().trim();
  const dropdown = document.getElementById("grant-user-dropdown");
  if (!dropdown) return;
  if (!q) { dropdown.style.display = "none"; return; }

  const matches = allUsers.filter(u => {
    const name = (u.name || u.displayName || "").toLowerCase();
    const email = (u.email || "").toLowerCase();
    const zaloId = (u.zaloId || "").toLowerCase();
    return name.includes(q) || email.includes(q) || zaloId.includes(q);
  }).slice(0, 8);

  if (!matches.length) {
    dropdown.innerHTML = `<div style="padding:10px 14px;color:#999;font-size:13px">Không tìm thấy user</div>`;
  } else {
    dropdown.innerHTML = matches.map(u => {
      const name = escapeHTML(u.name || u.displayName || "Không tên");
      const email = escapeHTML(u.email || "");
      const zaloId = escapeHTML(u.zaloId || "");
      const isZalo = u.loginType === "zalo" || (u.email || "").includes("@zalo.com");
      const tag = isZalo ? `<span style="font-size:10px;background:#e3f2fd;color:#1565c0;border-radius:4px;padding:1px 5px;margin-left:4px">Zalo</span>` : "";
      return `<div style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #f0f0f0;font-size:13px"
        onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background=''"
        onclick="selectGrantUser('${escapeHTML(u.id)}','${name}','${email}','${zaloId}')">
        <div style="font-weight:600">${name}${tag}</div>
        <div style="color:#888;font-size:12px">${email || (zaloId ? "Zalo: " + zaloId : "–")}</div>
      </div>`;
    }).join("");
  }
  dropdown.style.display = "block";
};

window.selectGrantUser = function(uid, name, email, zaloId) {
  document.getElementById("grant-bonus-user").value = uid;
  document.getElementById("grant-bonus-zalo").value = zaloId || "";
  document.getElementById("grant-selected-name").textContent = name;
  document.getElementById("grant-selected-email").textContent = email ? "(" + email + ")" : (zaloId ? "(Zalo: " + zaloId + ")" : "");
  document.getElementById("grant-bonus-search").value = name;
  document.getElementById("grant-user-dropdown").style.display = "none";
};

document.addEventListener("click", function(e) {
  if (!e.target.closest("#grant-bonus-search") && !e.target.closest("#grant-user-dropdown")) {
    const dd = document.getElementById("grant-user-dropdown");
    if (dd) dd.style.display = "none";
  }
});

window.grantBonus = async function() {
  const userId = document.getElementById("grant-bonus-user")?.value?.trim();
  const zaloId = document.getElementById("grant-bonus-zalo")?.value?.trim();
  if (!userId) { alert("Vui lòng tìm và chọn user trước."); return; }

  const expireInput = document.getElementById("grant-bonus-expire")?.value;
  const activateDeadline = expireInput ? new Date(expireInput + "T23:59:59+07:00") : null;
  const bonusPercent = Math.min(100, Math.max(1, parseInt(document.getElementById("grant-bonus-percent")?.value) || 10));

  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "SD-";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];

  try {
    await setDoc(doc(db, "bonusCodes", code), {
      code,
      userId,
      zaloId: zaloId || null,
      status: "pending",
      bonusPercent,
      createdAt: serverTimestamp(),
      activatedAt: null,
      activateDeadline: activateDeadline,
      expireAt: null,
      usedAt: null,
      usedOnRequestId: null,
      bonusAmount: null,
      createdBy: "admin",
    });
    document.getElementById("grant-bonus-user").value = "";
    document.getElementById("grant-bonus-zalo").value = "";
    document.getElementById("grant-bonus-search").value = "";
    document.getElementById("grant-bonus-expire").value = "";
    document.getElementById("grant-selected-name").textContent = "–";
    document.getElementById("grant-selected-email").textContent = "";
    const expireMsg = activateDeadline ? ` (hạn kích hoạt ${activateDeadline.toLocaleDateString("vi-VN")})` : "";
    alert(`✅ Đã cấp mã bonus: ${code}${expireMsg}`);
    await loadBonusCodes();
  } catch (e) {
    alert("❌ Lỗi: " + e.message);
  }
};
