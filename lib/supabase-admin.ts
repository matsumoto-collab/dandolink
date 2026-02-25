import { createClient } from '@supabase/supabase-js';

// サービスロールキーを使うサーバー専用クライアント（RLSをバイパス）
// このファイルはサーバーサイド（API Route等）でのみ使用すること
// クライアントコンポーネントからのインポートは厳禁
if (typeof window !== 'undefined') {
    throw new Error('supabase-admin はサーバーサイドでのみ使用可能です。クライアントコンポーネントからインポートしないでください。');
}
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const STORAGE_BUCKET = 'project-master-files';
