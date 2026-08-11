(function () {
  var ua = navigator.userAgent || "";
  var isFB = /FBAN|FBAV|FB_IAB|FBIOS|FB4A|Instagram/i.test(ua);
  if (!isFB) return;

  var isAndroid = /Android/i.test(ua);
  var isIOS = /iPhone|iPad|iPod/i.test(ua);
  var url = location.href;

  // ── Build overlay ──────────────────────────────────
  var overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed", inset: "0", zIndex: "99999",
    background: "rgba(0,0,0,0.55)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: "24px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
  });

  var card = document.createElement("div");
  Object.assign(card.style, {
    background: "#ffffff", borderRadius: "20px",
    padding: "28px 22px 22px", width: "100%", maxWidth: "360px",
    textAlign: "center", boxShadow: "0 8px 32px rgba(0,0,0,0.22)"
  });

  // Icon
  var icon = document.createElement("div");
  icon.textContent = "🌐";
  Object.assign(icon.style, { fontSize: "44px", marginBottom: "10px" });

  // Title
  var title = document.createElement("h2");
  title.textContent = "Mở bằng trình duyệt ngoài";
  Object.assign(title.style, { fontSize: "18px", fontWeight: "700", color: "#1a1a1a", margin: "0 0 8px" });

  // Desc
  var desc = document.createElement("p");
  desc.textContent = "Sdeal.vn hoạt động tốt nhất trên Chrome hoặc Safari. Vui lòng mở bằng trình duyệt ngoài để trải nghiệm đầy đủ.";
  Object.assign(desc.style, { fontSize: "14px", color: "#666", lineHeight: "1.6", margin: "0 0 18px" });

  // Chrome button (Android only)
  var chromeBtn = null;
  if (isAndroid) {
    var intentUrl = "intent://" + url.replace(new RegExp("^https?://"), "") + "#Intent;scheme=https;package=com.android.chrome;end";
    chromeBtn = document.createElement("a");
    chromeBtn.href = intentUrl;
    chromeBtn.textContent = "🌐 Mở bằng Chrome";
    Object.assign(chromeBtn.style, {
      display: "flex", alignItems: "center", justifyContent: "center",
      width: "100%", padding: "13px 16px", borderRadius: "12px",
      fontSize: "15px", fontWeight: "600", cursor: "pointer",
      border: "none", textDecoration: "none", marginBottom: "10px",
      background: "#1a73e8", color: "#ffffff"
    });
  }

  // Steps
  var steps = document.createElement("div");
  Object.assign(steps.style, {
    background: "#f7f7f7", borderRadius: "10px",
    padding: "12px 14px", textAlign: "left",
    fontSize: "13px", color: "#555", lineHeight: "1.8",
    marginBottom: "14px"
  });
  if (isAndroid) {
    steps.innerHTML = "<b>Hoặc làm thủ công:</b><br>1. Bấm vào <b>⋮</b> (góc trên phải)<br>2. Chọn <b>\"Open in browser\"</b>";
  } else if (isIOS) {
    steps.innerHTML = "<b>Cách mở bằng Safari:</b><br>1. Bấm vào <b>···</b> (góc dưới phải)<br>2. Chọn <b>\"Open in external browser\"</b><br><br><b>Cách mở bằng Chrome:</b><br>1. Bấm <b>Copy link</b> bên dưới<br>2. Mở Chrome → dán vào thanh địa chỉ";
  } else {
    steps.innerHTML = "<b>Hướng dẫn:</b><br>1. Bấm vào <b>⋮</b> hoặc <b>···</b><br>2. Chọn <b>\"Open in browser\"</b> hoặc <b>\"Mở bằng trình duyệt\"</b>";
  }

  // Copy link button
  var copyBtn = document.createElement("button");
  copyBtn.textContent = "📋 Copy link";
  Object.assign(copyBtn.style, {
    display: "flex", alignItems: "center", justifyContent: "center",
    width: "100%", padding: "13px 16px", borderRadius: "12px",
    fontSize: "15px", fontWeight: "600", cursor: "pointer",
    border: "none", background: "#f0f0f0", color: "#333", marginBottom: "10px"
  });
  copyBtn.onclick = function () {
    navigator.clipboard.writeText(url).then(function () {
      copyBtn.textContent = "✅ Đã copy link!";
      setTimeout(function () { copyBtn.textContent = "📋 Copy link"; }, 2000);
    });
  };

  // Dismiss
  var dismiss = document.createElement("button");
  dismiss.textContent = "Bỏ qua, tiếp tục xem";
  Object.assign(dismiss.style, {
    fontSize: "13px", color: "#aaa", cursor: "pointer",
    marginTop: "4px", background: "none", border: "none", padding: "4px 8px"
  });
  dismiss.onclick = function () { overlay.remove(); };

  // ── Assemble ───────────────────────────────────────
  card.appendChild(icon);
  card.appendChild(title);
  card.appendChild(desc);
  if (chromeBtn) card.appendChild(chromeBtn);
  card.appendChild(steps);
  card.appendChild(copyBtn);
  card.appendChild(dismiss);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
})();
