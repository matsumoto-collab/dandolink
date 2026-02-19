import { createClient } from '@supabase/supabase-js';

// サービスロールキーを使うサーバー専用クライアント（RLSをバイパス）
// このファイルはサーバーサイド（API Route等）でのみ使用すること
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const STORAGE_BUCKET = 'project-master-files';
