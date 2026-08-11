"use client";


export default function Page() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: `window.ENV={apiKey:${JSON.stringify(process.env.NEXT_PUBLIC_FIREBASE_API_KEY)},authDomain:${JSON.stringify(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN)},projectId:${JSON.stringify(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID)},storageBucket:${JSON.stringify(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)},messagingSenderId:${JSON.stringify(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID)},appId:${JSON.stringify(process.env.NEXT_PUBLIC_FIREBASE_APP_ID)}};` }} />
      <script type="module" src="/admin.js?v=202608095"></script>
      <style dangerouslySetInnerHTML={{ __html: `html, body { overflow-x: auto !important; } .main { overflow-x: auto; } .content { overflow-x: auto; }` }} />
      <div suppressHydrationWarning dangerouslySetInnerHTML={{ __html: `

<!-- LOGIN -->
<div id="admin-auth">
  <div class="login-card">
    <h2>🔐 Admin Panel</h2>
    <p>Đăng nhập tài khoản admin để quản lý hệ thống</p>
    <div class="fg"><label>Email</label><input type="email" id="adm-email" placeholder="admin@example.com"/></div>
    <div class="fg"><label>Mật khẩu</label><input type="password" id="adm-pass" placeholder="••••••••" onkeydown="if(event.key==='Enter')adminLogin()"/></div>
    <button class="btn btn-blue" style="width:100%;padding:11px" onclick="adminLogin()">Đăng nhập</button>
    <div id="adm-msg" class="amsg"></div>
  </div>
</div>

<!-- PANEL -->
<div id="admin-panel">
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-logo">🛍️ Admin <span class="s-badge">PRO</span></div>
      <nav class="sidebar-nav">
        <div class="nav-item active" data-tab="dashboard" onclick="showTab('dashboard')"><span class="nav-icon">📊</span> Dashboard</div>
        <div class="nav-item" data-tab="orders"    onclick="showTab('orders')"><span class="nav-icon">📦</span> Đơn hàng</div>
        <div class="nav-item" data-tab="users"     onclick="showTab('users')"><span class="nav-icon">👥</span> Users</div>
        <div class="nav-item" data-tab="payments"  onclick="showTab('payments')"><span class="nav-icon">💳</span> Yêu Cầu Thanh Toán <span id="payment-badge" style="color:var(--orange);font-weight:700;margin-left:4px"></span></div>
        <div class="nav-item" data-tab="upload"    onclick="showTab('upload')"><span class="nav-icon">📤</span> Upload JSON</div>
        <div class="nav-item" data-tab="shortlinks" onclick="showTab('shortlinks')"><span class="nav-icon">🔗</span> Rút gọn Link</div>
        <div class="nav-item" data-tab="bonus" onclick="showTab('bonus')"><span class="nav-icon">🎁</span> Bonus Code</div>
      </nav>
      <div class="sidebar-foot">
        <div class="aname" id="adm-name">Admin</div>
        <div>Sdeal.vn</div>
      </div>
    </aside>
    <main class="main">
      <div class="topbar">
        <div style="display:flex;align-items:center;">
          <button class="menu-btn" onclick="document.querySelector('.sidebar').classList.toggle('show')">☰</button>
          <h1 id="topbar-title">Dashboard</h1>
        </div>
      </div>
      <div class="content">

        <!-- DASHBOARD -->
        <div id="tab-dashboard" class="tab-content active">
          <div class="stats-row">
            <div class="stat-card"><div class="stat-icon">📦</div><div><div class="stat-label">Tổng sản phẩm</div><div class="stat-value" id="s-total">–</div></div></div>
            <div class="stat-card"><div class="stat-icon">✅</div><div><div class="stat-label">Đã được gán</div><div class="stat-value" id="s-claimed">–</div></div></div>
            <div class="stat-card"><div class="stat-icon">⏳</div><div><div class="stat-label">Chưa được gán</div><div class="stat-value" id="s-free">–</div></div></div>
            <div class="stat-card"><div class="stat-icon">👥</div><div><div class="stat-label">Tổng users</div><div class="stat-value" id="s-users">–</div></div></div>
          </div>
          <div class="panel">
            <div class="panel-header"><h2>📋 Đơn hàng gần đây được gán</h2></div>
            <div class="panel-body" id="dash-recent">Đang tải...</div>
          </div>
        </div>

        <!-- ORDERS -->
        <div id="tab-orders" class="tab-content">
          <div class="stats-row" style="margin-bottom: 24px;" id="orders-stats">
            <div class="stat-card"><div class="stat-icon">📦</div><div><div class="stat-label">Tổng đơn hàng</div><div class="stat-value" id="os-total">0</div></div></div>
            <div class="stat-card"><div class="stat-icon">💸</div><div><div class="stat-label">Tổng chiết khấu</div><div class="stat-value" id="os-ck" style="color:var(--orange);">0 đ</div></div></div>
            <div class="stat-card"><div class="stat-icon">💰</div><div><div class="stat-label">Tổng HH Shopee</div><div class="stat-value" id="os-hh" style="color:var(--green);">0 đ</div></div></div>
            <div class="stat-card"><div class="stat-icon">✅</div><div><div class="stat-label">Tổng TT (Đã trả)</div><div class="stat-value" id="os-paid">0 đ</div></div></div>
            <div class="stat-card"><div class="stat-icon">📈</div><div><div class="stat-label">Lợi nhuận</div><div class="stat-value" id="os-profit" style="color:#007bff;">0 đ</div></div></div>
            <div class="stat-card"><div class="stat-icon">🔍</div><div><div class="stat-label">Kiểm tra gian lận</div><div class="stat-value" id="os-fraud" style="font-size:13px">–</div></div></div>
          </div>
          <div class="panel">
            <div class="panel-header">
              <h2>📦 Tất cả đơn hàng</h2>
              <div style="display:flex;gap:8px">
                <button class="btn btn-outline btn-sm" onclick="loadOrders(true)">🔄 Làm mới</button>
                <button class="btn btn-red btn-sm" onclick="deleteSelectedOrders()" id="btn-delete-selected" style="display:none;">🗑️ Xóa đã chọn</button>
              </div>
            </div>
            <div class="filter-bar">
              <select id="filter-status" onchange="applyFilter()">
                <option value="">-- Tất cả trạng thái --</option>
                <option value="claimed">Đã gán</option>
                <option value="free">Chưa gán</option>
                <option value="paid">Đã thanh toán</option>
                <option value="no-status">Chưa thanh toán</option>
              </select>
              <select id="filter-user" onchange="applyFilter()"><option value="">-- Lọc theo user --</option></select>
              <input type="text" id="filter-id" placeholder="Tìm ID đơn hàng..." oninput="applyFilter()"/>
              <input type="date" id="filter-date-from" onchange="applyFilter()" title="Từ ngày"/>
              <input type="date" id="filter-date-to" onchange="applyFilter()" title="Đến ngày"/>
              <button id="btn-copy-orders" class="btn btn-blue btn-sm" style="display:none" onclick="copyFilteredOrders()">📋 Copy đơn hàng</button>
            </div>
            <div style="overflow-x:auto">
              <table>
                <thead><tr><th style="width: 40px; text-align: center;"><input type="checkbox" id="chk-all-orders" onchange="toggleAllOrders(this)"></th><th>ID Đơn hàng</th><th>Giá trị (₫)</th><th>Chiết Khấu</th><th>HH Shopee</th><th>Trạng thái đơn hàng</th><th>Trạng thái gán</th><th>Thanh toán</th><th>Người gán</th><th>Thao tác</th></tr></thead>
                <tbody id="orders-tbody"><tr><td colspan="9" style="text-align:center;padding:24px;color:#999"><span class="spinner"></span>Đang tải...</td></tr></tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- USERS -->
        <div id="tab-users" class="tab-content">
          <div class="panel">
            <div class="panel-header">
              <h2>👥 Danh sách Users</h2>
              <button class="btn btn-blue btn-sm" onclick="openAddUser()">+ Tạo User</button>
            </div>
            <div class="filter-bar">
              <input type="text" id="filter-user-search" placeholder="Tìm tên, email..." oninput="renderUsers()"/>
              <select id="filter-user-ref" onchange="renderUsers()">
                <option value="">-- Người giới thiệu --</option>
              </select>
            </div>
            <div style="overflow-x:auto">
              <table>
                <thead><tr><th>Họ tên</th><th>Email</th><th>Zalo ID</th><th>Vai trò</th><th>Đơn đã gán</th><th>TT Ngân hàng</th><th>Ngày tạo</th><th>Người GT</th><th>Thao tác</th></tr></thead>
                <tbody id="users-tbody"><tr><td colspan="8" style="text-align:center;padding:24px;color:#999"><span class="spinner"></span>Đang tải...</td></tr></tbody>
              </table>
            </div>
          </div>

          <!-- ADD USER INLINE -->
          <div class="panel" id="add-user-panel" style="display:none">
            <div class="panel-header"><h2>👤 Tạo User mới</h2><button class="btn btn-outline btn-sm" onclick="document.getElementById('add-user-panel').style.display='none'">✕ Đóng</button></div>
            <div class="panel-body" style="max-width:420px">
              <div class="fg"><label>Họ tên</label><input type="text" id="nu-name" placeholder="Nguyễn Văn A"/></div>
              <div class="fg"><label>Email</label><input type="email" id="nu-email" placeholder="user@example.com"/></div>
              <div class="fg"><label>Mật khẩu</label><input type="password" id="nu-pass" placeholder="Ít nhất 6 ký tự"/></div>
              <button class="btn btn-blue" onclick="createUser()">Tạo tài khoản</button>
              <div id="nu-msg"></div>
            </div>
          </div>
        </div>

        <!-- PAYMENTS -->
        <div id="tab-payments" class="tab-content">
          <div class="panel">
            <div class="panel-header">
              <h2>💳 Danh Sách Yêu Cầu Thanh Toán</h2>
              <button class="btn btn-outline btn-sm" onclick="loadPaymentRequests()">🔄 Làm mới</button>
            </div>
            <div class="filter-bar">
              <select id="filter-pay-status" onchange="renderPaymentRequests()">
                <option value="">-- Tất cả trạng thái --</option>
                <option value="pending">Đang chờ</option>
                <option value="approved">Đã duyệt</option>
              </select>
              <input type="text" id="filter-pay-search" placeholder="Tìm theo Mã YC, User..." oninput="renderPaymentRequests()"/>
            </div>
            <div style="overflow-x:auto">
              <table>
                <thead><tr><th>Mã Yêu Cầu</th><th>User</th><th>Số đơn</th><th>Tổng CK</th><th>Bonus</th><th>Tổng cần trả</th><th>Ngày gửi</th><th>Ngày Thanh Toán</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
                <tbody id="payments-tbody"><tr><td colspan="10" style="text-align:center;padding:24px;color:#999"><span class="spinner"></span>Đang tải...</td></tr></tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- UPLOAD -->
        <div id="tab-upload" class="tab-content">
          <div class="panel">
            <div class="panel-header"><h2>📤 Upload file JSON — Pool đơn hàng chung</h2></div>
            <div class="panel-body">
              <p style="font-size:13px;color:var(--text-light);margin-bottom:16px;line-height:1.6">
                Upload file <code>data.json</code> cùng format cũ. Đơn hàng sẽ vào <b>pool chung</b> — không gán cho ai cả.<br>
                User tự đăng nhập, tìm ID và bấm <b>"Gán cho tôi"</b>. Mỗi đơn chỉ được gán cho 1 người.
              </p>
              <div class="upload-area" id="upload-area"
                onclick="document.getElementById('json-file').click()"
                ondragover="event.preventDefault();this.classList.add('dragover')"
                ondragleave="this.classList.remove('dragover')"
                ondrop="handleDrop(event)">
                <div class="upload-icon">📂</div>
                <p><strong>Click để chọn file</strong> hoặc kéo thả vào đây</p>
                <p style="margin-top:6px;font-size:12px">Chỉ nhận file .json (mảng [])</p>
              </div>
              <input type="file" id="json-file" accept=".json" style="display:none" onchange="handleFile(this.files[0])"/>
              <div id="upload-preview" style="margin-top:14px"></div>
              <div id="upload-msg"></div>
              <div style="margin-top:16px;padding-top:14px;border-top:1px solid #eee">
                <p style="font-size:12px;color:#888;margin-bottom:8px">🔧 Công cụ sửa dữ liệu sai:</p>
                <button class="btn btn-outline" style="font-size:13px;color:var(--orange);border-color:var(--orange)" onclick="fixDraftData()">🧹 Dọn đơn nháp bị tách đôi</button>
              </div>
            </div>
          </div>
        </div>

        <!-- SHORTLINKS -->
        <div id="tab-shortlinks" class="tab-content">
          <div class="panel">
            <div class="panel-header"><h2>🔗 Công cụ Rút gọn Link</h2></div>
            <div class="panel-body" style="max-width:600px">
              <div class="fg">
                <label>Link gốc cần rút gọn</label>
                <input type="url" id="sl-url" placeholder="https://shopee.vn/..." onkeydown="if(event.key==='Enter')createShortLink()"/>
              </div>
              <button class="btn btn-blue" onclick="createShortLink()">Tạo Link Rút Gọn</button>
              <div id="sl-msg"></div>
            </div>
          </div>
          <div class="panel">
            <div class="panel-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
              <h2 style="margin:0">📋 Danh sách Link đã tạo</h2>
              <div style="display:flex;gap:6px">
                <button id="sl-sort-newest" class="btn btn-blue btn-xs active" onclick="window.switchSLSort('newest')">🕐 Mới nhất</button>
                <button id="sl-sort-clicks" class="btn btn-outline btn-xs" onclick="window.switchSLSort('clicks')">🔥 Nhiều click</button>
              </div>
            </div>
            <div style="overflow-x:auto">
              <table>
                <thead><tr><th>Link rút gọn</th><th>Link gốc</th><th>Ngày tạo</th><th>Lượt click</th><th>Thao tác</th></tr></thead>
                <tbody id="shortlinks-tbody"><tr><td colspan="5" style="text-align:center;padding:24px;color:#999"><span class="spinner"></span>Đang tải...</td></tr></tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- BONUS CODES -->
        <div id="tab-bonus" class="tab-content">
          <!-- Inline stat bar -->
          <div style="display:flex;gap:0;background:#fff;border-radius:12px;box-shadow:var(--shadow);overflow:hidden;margin-bottom:16px;flex-wrap:wrap">
            <div style="flex:1;min-width:80px;padding:12px 16px;text-align:center;border-right:1px solid var(--border)">
              <div style="font-size:11px;color:var(--text-light);margin-bottom:4px">Tổng</div>
              <div style="font-size:20px;font-weight:700" id="bonus-stat-total">–</div>
            </div>
            <div style="flex:1;min-width:80px;padding:12px 16px;text-align:center;border-right:1px solid var(--border)">
              <div style="font-size:11px;color:var(--text-light);margin-bottom:4px">Chờ KH</div>
              <div style="font-size:20px;font-weight:700;color:var(--orange)" id="bonus-stat-pending">–</div>
            </div>
            <div style="flex:1;min-width:80px;padding:12px 16px;text-align:center;border-right:1px solid var(--border)">
              <div style="font-size:11px;color:var(--text-light);margin-bottom:4px">Active</div>
              <div style="font-size:20px;font-weight:700;color:var(--green)" id="bonus-stat-active">–</div>
            </div>
            <div style="flex:1;min-width:80px;padding:12px 16px;text-align:center;border-right:1px solid var(--border)">
              <div style="font-size:11px;color:var(--text-light);margin-bottom:4px">Đã dùng</div>
              <div style="font-size:20px;font-weight:700;color:var(--blue)" id="bonus-stat-used">–</div>
            </div>
            <div style="flex:1;min-width:80px;padding:12px 16px;text-align:center">
              <div style="font-size:11px;color:var(--text-light);margin-bottom:4px">Hết hạn</div>
              <div style="font-size:20px;font-weight:700;color:#999" id="bonus-stat-expired">–</div>
            </div>
          </div>
          <div class="panel" style="margin-bottom:16px">
            <div class="panel-header"><h2>➕ Cấp mã bonus thủ công</h2></div>
            <div class="panel-body">
              <div style="position:relative;margin-bottom:12px">
                <label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px">Tìm user (tên hoặc email)</label>
                <input type="text" id="grant-bonus-search" placeholder="Gõ tên hoặc email để tìm user..." oninput="searchGrantUser()" autocomplete="off"
                  style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;outline:none"/>
                <div id="grant-user-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--border);border-radius:8px;box-shadow:var(--shadow-lg);z-index:100;max-height:200px;overflow-y:auto"></div>
              </div>
              <div style="display:flex;gap:10px;align-items:center;background:#f7f7f7;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:13px">
                <span style="color:var(--text-light)">Đã chọn:</span>
                <span id="grant-selected-name" style="font-weight:600;color:var(--text)">–</span>
                <span id="grant-selected-email" style="color:var(--text-light)"></span>
                <input type="hidden" id="grant-bonus-user" />
                <input type="hidden" id="grant-bonus-zalo" />
              </div>
              <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px">
                <div>
                  <label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px">% Bonus</label>
                  <div style="display:flex;align-items:center;gap:6px">
                    <input type="number" id="grant-bonus-percent" value="10" min="1" max="100"
                      style="width:80px;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;outline:none;color:var(--text);text-align:center" />
                    <span style="font-size:14px;color:#888">%</span>
                  </div>
                </div>
                <div>
                  <label style="font-size:13px;font-weight:600;display:block;margin-bottom:6px">Ngày hết hạn code <span style="color:#aaa;font-weight:400">(để trống = không hết hạn)</span></label>
                  <input type="date" id="grant-bonus-expire"
                    style="padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;outline:none;color:var(--text)" />
                </div>
              </div>
              <button class="btn btn-blue" onclick="grantBonus()">🎁 Cấp mã bonus</button>
            </div>
          </div>
          <div class="panel">
            <div class="panel-header">
              <h2>📋 Danh sách Bonus Code</h2>
              <button class="btn btn-outline btn-sm" onclick="loadBonusCodes()">🔄 Làm mới</button>
            </div>
            <div class="filter-bar">
              <select id="filter-bonus-status" onchange="renderBonusCodes()">
                <option value="">-- Tất cả --</option>
                <option value="pending">Chờ kích hoạt</option>
                <option value="active">Đang active</option>
                <option value="used">Đã dùng</option>
                <option value="expired">Hết hạn</option>
                <option value="revoked">Đã thu hồi</option>
              </select>
              <input type="text" id="filter-bonus-search" placeholder="Tìm theo mã, user, Zalo ID..." oninput="renderBonusCodes()" />
            </div>
            <div style="overflow-x:auto">
              <table>
                <thead><tr><th>Mã</th><th>User</th><th>Zalo ID</th><th>Trạng thái</th><th>Bonus</th><th>Ngày tạo / Active / Hết hạn</th><th>Số tiền bonus / Ngày dùng</th><th>Thao tác</th></tr></thead>
                <tbody id="bonus-tbody"><tr><td colspan="8" style="text-align:center;padding:24px;color:#999"><span class="spinner"></span>Đang tải...</td></tr></tbody>
              </table>
            </div>
          </div>
        </div>

      </div>
    </main>
  </div>
</div>

  <!-- MODAL EDIT BANK -->
  <div class="overlay" id="edit-bank-modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:9999; align-items:center; justify-content:center;">
    <div class="panel" style="background:#fff; width:400px; padding:20px; border-radius:12px; box-shadow:0 10px 25px rgba(0,0,0,0.2);">
      <h3 style="margin-top:0;">💳 Cập nhật TT Thanh toán</h3>
      <input type="hidden" id="eb-uid" />
      <div class="fg">
        <label>Họ và Tên</label>
        <input type="text" id="eb-name" placeholder="VD: NGUYEN VAN A" style="text-transform: uppercase;" />
      </div>
      <div class="fg">
        <label>Ngân hàng nhận tiền</label>
        <input type="text" id="eb-bank" placeholder="VD: Vietcombank" />
      </div>
      <div class="fg">
        <label>Số tài khoản</label>
        <input type="text" id="eb-account" placeholder="Nhập số tài khoản" />
      </div>
      <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:20px;">
        <button class="btn btn-outline" onclick="document.getElementById('edit-bank-modal').style.display='none'">Hủy</button>
        <button class="btn btn-green" onclick="saveUserBank()">💾 Lưu thay đổi</button>
      </div>
    </div>
  </div>

  <!-- MODAL VIEW QR -->
  <div class="overlay" id="qr-modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:9999; align-items:center; justify-content:center;" onclick="this.style.display='none'">
    <div class="panel" style="background:#fff; width:auto; padding:24px; border-radius:12px; box-shadow:0 10px 25px rgba(0,0,0,0.3); text-align:center;" onclick="event.stopPropagation()">
      <h3 style="margin:0 0 16px 0;">📷 Quét mã chuyển khoản</h3>
      <img id="qr-img-preview" src="" style="max-width:350px; border-radius:8px; display:block; margin:0 auto;" />
      <div id="qr-info" style="margin-top: 16px; text-align: left; font-size: 14px; background: #f9f9f9; padding: 12px; border-radius: 8px;">
        <p style="margin-bottom:6px"><strong>Tên User:</strong> <span id="qr-username"></span></p>
        <p style="margin-bottom:6px"><strong>Chủ tài khoản:</strong> <span id="qr-bank-fullname"></span></p>
        <p style="margin-bottom:6px"><strong>Ngân hàng:</strong> <span id="qr-bank-name"></span></p>
        <p style="margin-bottom:0"><strong>Số tài khoản:</strong> <span id="qr-bank-account"></span></p>
      </div>
      <button class="btn btn-outline" style="margin-top:20px;" onclick="document.getElementById('qr-modal').style.display='none'">Đóng lại</button>
    </div>
  </div>

` }} />
    </>
  );
}
