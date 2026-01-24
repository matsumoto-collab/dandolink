const withBundleAnalyzer = require('@next/bundle-analyzer')({
    enabled: process.env.ANALYZE === 'true',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    images: {
        formats: ['image/avif', 'image/webp'],
    },
    // 本番ビルド時のソースマップを無効化してバンドルサイズを削減
    productionBrowserSourceMaps: false,
    // SWC minifyはNext.js 14ではデフォルトで有効
    // ESMパッケージの対応
    transpilePackages: ['@react-pdf/renderer'],
    experimental: {
        esmExternals: 'loose',
    },
}

module.exports = withBundleAnalyzer(nextConfig)
