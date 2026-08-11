import { Be_Vietnam_Pro } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const beVietnamPro = Be_Vietnam_Pro({
  weight: ['400', '600', '700'],
  subsets: ['vietnamese'],
  display: 'swap',
});

export const metadata = {
  title: "App Săn Deal & Hoàn Tiền Shopee",
  description: "App săn deal ngon và mua sắm hoàn tiền shopee dành cho mọi người",
  openGraph: {
    title: "App Săn Deal & Hoàn Tiền Shopee",
    description: "App săn deal ngon và mua sắm hoàn tiền shopee dành cho mọi người",
    type: "website",
    images: [{ url: 'https://sdeal.vn/sandealtim.png' }],
  }
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi" translate="no" suppressHydrationWarning className={beVietnamPro.className}>
      <head>
        <meta name="google" content="notranslate" />
        <link rel="preconnect" href="https://firestore.googleapis.com" />
        <link rel="preconnect" href="https://www.gstatic.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://firebasestorage.googleapis.com" />
        <link rel="preload" href="/logo.png" as="image" />
        {/* PWA: cho phép "Lưu vào màn hình chính" trên Android (qua manifest ở app/manifest.json)
            và hiện đúng như 1 app trên iOS Safari (Apple không có API cài tự động, chỉ hỗ trợ qua các
            meta tag này để khi user tự thêm vào màn hình chính thì mở full-screen không có thanh URL) */}
        <meta name="theme-color" content="#EE4D2D" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Sandeal" />
        <link rel="apple-touch-icon" href="/logo.png" />
      </head>
      <body>
        {children}
        <Script strategy="afterInteractive" src="https://www.googletagmanager.com/gtag/js?id=G-SLLYE9F7EF" />
        <Script strategy="afterInteractive" id="gtag-init" dangerouslySetInnerHTML={{ __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-SLLYE9F7EF');` }} />
      </body>
    </html>
  );
}
