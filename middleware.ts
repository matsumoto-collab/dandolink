export { default } from 'next-auth/middleware';

export const config = {
    matcher: [
        // 認証不要なパスを除外
        // - api/auth: ログインAPI等
        // - api/init-db: 初期化API等(後で固有の保護を追加)
        // - login: ログインページ
        // - _next/static, _next/image, favicon.ico: 静的ファイル群
        // - manifest.json, 各種画像ファイル: PWAやアセット用
        '/((?!api/auth|api/init-db|login|_next/static|_next/image|favicon.ico|manifest\\.json|.*\\.png|.*\\.jpg|.*\\.svg|.*\\.ico).*)',
    ],
};
