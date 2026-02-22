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
                ],
            },
        ];
    },
}

module.exports = withBundleAnalyzer(nextConfig)
