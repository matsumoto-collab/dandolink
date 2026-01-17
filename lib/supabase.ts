import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Supabase configuration
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// グローバルシングルトンでインスタンスを管理
let supabaseInstance: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
    if (!supabaseInstance) {
        supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
            realtime: {
                params: {
                    eventsPerSecond: 10,
                },
            },
        });
    }
    return supabaseInstance;
}

// Create Supabase client (singleton)
export const supabase = getSupabaseClient();
