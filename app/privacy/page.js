export const metadata = {
  title: "Chính sách bảo mật – Sdeal.vn",
  description: "Chính sách bảo mật và quyền riêng tư của ứng dụng Sdeal.vn",
};

export default function PrivacyPage() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px 80px', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#1c1e21', lineHeight: 1.7 }}>
      <div style={{ marginBottom: 32 }}>
        <a href="/" style={{ color: '#EE4D2D', textDecoration: 'none', fontSize: 14, fontWeight: 600 }}>← Về trang chủ</a>
      </div>

      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Chính sách bảo mật</h1>
      <p style={{ color: '#65676b', fontSize: 14, marginBottom: 40 }}>Cập nhật lần cuối: 15/07/2026</p>

      <section style={{ marginBottom: 32 }}>
        <h2 style={h2}>1. Giới thiệu</h2>
        <p>Sdeal.vn ("chúng tôi") tôn trọng quyền riêng tư của bạn. Chính sách này mô tả cách chúng tôi thu thập, sử dụng và bảo vệ thông tin cá nhân khi bạn sử dụng ứng dụng và dịch vụ của chúng tôi.</p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={h2}>2. Thông tin chúng tôi thu thập</h2>
        <p>Chúng tôi có thể thu thập các thông tin sau:</p>
        <ul style={ul}>
          <li><strong>Thông tin tài khoản:</strong> Tên, địa chỉ email khi bạn đăng ký tài khoản.</li>
          <li><strong>Thông tin Zalo:</strong> ID Zalo, tên hiển thị, ảnh đại diện khi bạn đăng nhập qua Zalo.</li>
          <li><strong>Thông tin Google:</strong> Email, tên hiển thị, ảnh đại diện khi bạn đăng nhập qua Google.</li>
          <li><strong>Thông tin ngân hàng:</strong> Số tài khoản, tên ngân hàng phục vụ việc thanh toán hoàn tiền (được mã hóa và bảo mật).</li>
          <li><strong>Dữ liệu sử dụng:</strong> Thông tin về các đơn hàng bạn đã gán, lịch sử hoạt động trong ứng dụng.</li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={h2}>3. Mục đích sử dụng thông tin</h2>
        <p>Thông tin thu thập được dùng để:</p>
        <ul style={ul}>
          <li>Xác thực danh tính và quản lý tài khoản người dùng.</li>
          <li>Xử lý và theo dõi các đơn hàng hoàn tiền Shopee.</li>
          <li>Thanh toán tiền hoàn về tài khoản ngân hàng của bạn.</li>
          <li>Gửi thông báo liên quan đến dịch vụ.</li>
          <li>Cải thiện trải nghiệm và tính năng của ứng dụng.</li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={h2}>4. Chia sẻ thông tin</h2>
        <p>Chúng tôi <strong>không bán, cho thuê hoặc chia sẻ</strong> thông tin cá nhân của bạn với bên thứ ba, ngoại trừ:</p>
        <ul style={ul}>
          <li>Khi có yêu cầu từ cơ quan pháp luật có thẩm quyền.</li>
          <li>Các nhà cung cấp dịch vụ kỹ thuật (Firebase, Vercel) hỗ trợ vận hành hệ thống — các bên này có chính sách bảo mật riêng.</li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={h2}>5. Bảo mật dữ liệu</h2>
        <p>Chúng tôi áp dụng các biện pháp bảo mật phù hợp để bảo vệ thông tin của bạn, bao gồm mã hóa dữ liệu truyền tải (HTTPS) và kiểm soát quyền truy cập nghiêm ngặt qua Firebase Security Rules.</p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={h2}>6. Quyền của bạn</h2>
        <p>Bạn có quyền:</p>
        <ul style={ul}>
          <li>Yêu cầu xem, chỉnh sửa hoặc xóa thông tin cá nhân của mình.</li>
          <li>Ngừng sử dụng dịch vụ bất kỳ lúc nào.</li>
          <li>Liên hệ với chúng tôi để được hỗ trợ về quyền riêng tư.</li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={h2}>7. Cookie và lưu trữ cục bộ</h2>
        <p>Ứng dụng sử dụng <strong>localStorage</strong> và <strong>sessionStorage</strong> của trình duyệt để lưu trữ dữ liệu tạm thời nhằm cải thiện tốc độ tải trang. Không có cookie theo dõi quảng cáo được sử dụng.</p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={h2}>8. Thay đổi chính sách</h2>
        <p>Chúng tôi có thể cập nhật chính sách này theo thời gian. Mọi thay đổi sẽ được đăng tải tại trang này với ngày cập nhật mới nhất.</p>
      </section>

      <section>
        <h2 style={h2}>9. Liên hệ</h2>
        <p>Nếu bạn có câu hỏi về chính sách bảo mật, vui lòng liên hệ qua:</p>
        <ul style={ul}>
          <li>Fanpage Facebook: <a href="https://www.facebook.com/TODO_FANPAGE_MOI" target="_blank" rel="noopener noreferrer" style={{ color: '#EE4D2D' }}>Sdeal.vn</a></li>
          <li>Website: <a href="https://sdeal.vn" style={{ color: '#EE4D2D' }}>sdeal.vn</a></li>
        </ul>
      </section>
    </div>
  );
}

const h2 = {
  fontSize: 18,
  fontWeight: 700,
  marginBottom: 10,
  marginTop: 0,
  color: '#EE4D2D',
};

const ul = {
  paddingLeft: 20,
  marginTop: 8,
};
