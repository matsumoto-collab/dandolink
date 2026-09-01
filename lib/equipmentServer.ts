import { prisma } from '@/lib/prisma';
import { withFreshFileSignedUrls } from '@/lib/cardStatement';

/**
 * 機材台帳のサーバー専用ヘルパー（prisma / Supabase Storage に触るもの）。
 * 画面からも使う純粋なロジック（区分・権限・期限の判定）は lib/equipment.ts にある
 * ＝クライアントコンポーネントから lib/equipment.ts を import できるようにするための分離。
 */

interface SignableEquipmentFile {
    id: string;
    storagePath: string;
    thumbnailPath: string | null;
    signedUrl: string | null;
    signedUrlExpiresAt: Date | null;
    thumbnailSignedUrl: string | null;
    thumbnailSignedUrlExpiresAt: Date | null;
}

/** 添付ファイルの署名付きURLを必要なら作り直してDBにキャッシュする（レシート類と同じ仕組み）。 */
export function withFreshEquipmentFileSignedUrls<T extends SignableEquipmentFile>(file: T): Promise<T> {
    return withFreshFileSignedUrls(file, (id, data) => prisma.equipmentMaintenanceFile.update({ where: { id }, data }));
}

/** 履歴の取得時に常に同梱する添付ファイルの並び。 */
export const MAINTENANCE_FILE_ORDER = { createdAt: 'asc' } as const;
