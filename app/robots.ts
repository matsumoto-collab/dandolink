import type { MetadataRoute } from 'next';

/**
 * 社内向けSaaS のためクローラー完全拒否。
 * Phase 4 でマルチテナント公開化したときは LP 用に分岐検討。
 */
export default function robots(): MetadataRoute.Robots {
    return {
        rules: [
            {
                userAgent: '*',
                disallow: '/',
            },
        ],
    };
}
