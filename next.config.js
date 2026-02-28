const { withSentryConfig } = require('@sentry/nextjs');
const withBundleAnalyzer = require('@next/bundle-analyzer')({
    enabled: process.env.ANALYZE === 'true',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    images: {
        formats: ['image/avif', 'image/webp'],
        remotePatterns: [
            {
                protocol: 'https',
                hostname: '**.supabase.co',
                pathname: '/storage/v1/**',
            },
        ],
    },
    // 本番ビルド時のソースマップを無効化してバンドルサイズを削減
    productionBrowserSourceMaps: false,
    // SWC minifyはNext.js 14ではデフォルトで有効
    // ESMパッケージの対応
    transpilePackages: ['@react-pdf/renderer'],
    experimental: {
        esmExternals: 'loose',
        // pdfjs-dist はブラウザ専用 API (DOMMatrix 等) を使うため SSR バンドルから除外
        serverComponentsExternalPackages: ['pdfjs-dist', 'react-pdf'],
    },
    webpack: (config) => {
        config.resolve.alias.canvas = false;
        return config;
    },
    // セキュリティヘッダー
    async headers() {
        return [
            {
                source: '/(.*)',
                headers: [
                    { key: 'X-Content-Type-Options', value: 'nosniff' },
                    { key: 'X-Frame-Options', value: 'DENY' },
                    { key: 'X-XSS-Protection', value: '1; mode=block' },
                    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
                    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
                    { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://maps.googleapis.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' blob: data: https://maps.googleapis.com https://maps.gstatic.com https://*.supabase.co; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://maps.googleapis.com wss://*.supabase.co https://*.supabase.co https://cdn.jsdelivr.net https://zipcloud.ibsnet.co.jp https://nominatim.openstreetmap.org https://*.ingest.us.sentry.io; worker-src 'self' blob:; child-src 'self' blob:; object-src 'none'; frame-src 'self' blob: https://www.google.com https://maps.google.com https://maps.googleapis.com;" },
                ],
            },
            // PDF workerは変更頻度が低い静的ファイルなので長期キャッシュ
            {
                source: '/pdf.worker.min.mjs',
                headers: [
                    { key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=86400' },
                ],
            },
        ];
    },
}

module.exports = withSentryConfig(withBundleAnalyzer(nextConfig), {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    silent: !process.env.CI,
    widenClientFileUpload: true,
    disableLogger: true,
    automaticVercelMonitors: true,
})
