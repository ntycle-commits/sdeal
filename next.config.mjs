/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['firebase-admin', 'jwks-rsa', 'jose'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.zdn.vn' },
      { protocol: 'https', hostname: '**.zadn.vn' },
	  { protocol: 'https', hostname: '*.shopee.vn' },
    ],
  },
  async headers() {
    return [
      {
        // Áp dụng cho tất cả các routes
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval' www.gstatic.com apis.google.com www.googletagmanager.com static.cloudflareinsights.com; connect-src 'self' *.googleapis.com *.firebaseapp.com oauth.zaloapp.com graph.zalo.me *.zalo.me api.vietqr.io www.gstatic.com www.google-analytics.com analytics.google.com www.googletagmanager.com sdeal-post-cache-sync.ntycle.workers.dev cloudflareinsights.com; img-src 'self' data: *.sdeal.vn sdeal.vn *.googleapis.com *.zalo.me *.zadn.vn *.zdn.vn qr.sepay.vn *.shopee.vn www.google-analytics.com www.googletagmanager.com; frame-src *.firebaseapp.com"
          }
        ],
      },
    ];
  },
};

export default nextConfig;
