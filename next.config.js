/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    images: {
        formats: ['image/avif', 'image/webp'],
    },
    // 本番ビルド時のソースマップを無効化してバンドルサイズを削減
    productionBrowserSourceMaps: false,
    // SWC minifyはNext.js 14ではデフォルトで有効
}

module.exports = nextConfig
