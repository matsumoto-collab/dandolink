import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { ConstructionTypeMaster } from '@/types/calendar';
import { initBroadcastChannel, onBroadcast, sendBroadcast } from '@/lib/broadcastChannel';
import { Vehicle, MemberCountHistoryEntry, ScheduleTool, ToolCategoryOption } from '@/types/master';
import { logger } from '@/lib/logger';

/**
 * マスタ（車両・電動工具・総メンバー数）の変更を他端末へ知らせる broadcast イベント。
 *
 * postgres_changes（WAL購読）は使わない: マスタ系のテーブルは Supabase の
 * supabase_realtime パブリケーションに入っておらず、さらに Vehicle は RLS 有効で
 * ポリシーが無いため、購読しても変更が届かない（2026-09-02 本番確認）。
 * 配置・日報などと同じ broadcast に揃えることで、DB 側の設定を変えずに即時反映できる。
 */
export const MASTER_DATA_UPDATED = 'master_data_updated';

/** 連続登録で再取得が何度も走らないようにするデバウンス（配置・日報と同じ 500ms） */
const REFRESH_DEBOUNCE_MS = 500;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

// Re-export types for backward compatibility
export type { Vehicle, Manager, MemberCountHistoryEntry, MasterData, ScheduleTool, ToolCategoryOption } from '@/types/master';

interface MasterState {
    // Data
    vehicles: Vehicle[];
    /** 電動工具（機材台帳の Tool）。スケジュールの選択と、ID→名前の解決に使う */
    tools: ScheduleTool[];
    /** 電動工具の分類（設定画面のセレクト用） */
    toolCategories: ToolCategoryOption[];
    constructionTypes: ConstructionTypeMaster[];
    totalMembers: number;
    memberCountHistory: MemberCountHistoryEntry[];

    // Status
    isLoading: boolean;
    isInitialized: boolean;

    // Realtime（broadcast のリスナー解除関数）
    _realtimeUnsubs: (() => void)[];
}

interface MasterActions {
    // Fetch
    fetchMasterData: () => Promise<void>;
    refreshMasterData: () => Promise<void>;

    // Vehicle operations
    addVehicle: (name: string, dailyRate?: number | null) => Promise<void>;
    updateVehicle: (id: string, name: string, dailyRate?: number | null) => Promise<void>;
    deleteVehicle: (id: string) => Promise<void>;

    // Tool operations（実体は機材台帳の Tool。設定画面から追加・改名・削除する）
    fetchTools: () => Promise<void>;
    /**
     * この store を経由しない画面（機材台帳など）がマスタを変えたときに呼ぶ。
     * 自分の画面は再取得し、他の端末へは broadcast で知らせる
     * （broadcast は self:false なので送信者自身には届かない）。
     */
    notifyMasterDataChanged: (kind: 'vehicle' | 'tool' | 'memberCount') => Promise<void>;
    addTool: (name: string, categoryId?: string | null) => Promise<void>;
    updateTool: (id: string, name: string, categoryId?: string | null) => Promise<void>;
    deleteTool: (id: string) => Promise<void>;

    // Member count history
    fetchMemberCountHistory: () => Promise<void>;
    addMemberCountEntry: (startDate: string, count: number) => Promise<void>;
    updateMemberCountEntry: (id: string, startDate: string, count: number) => Promise<void>;
    deleteMemberCountEntry: (id: string) => Promise<void>;
    getTotalMembersForDate: (dateStr: string) => number;

    // Realtime
    setupRealtimeSubscription: () => Promise<void>;
    cleanupRealtimeSubscription: () => void;

    // Reset
    reset: () => void;
}

type MasterStore = MasterState & MasterActions;

const initialState: MasterState = {
    vehicles: [],
    tools: [],
    toolCategories: [],
    constructionTypes: [],
    totalMembers: 20,
    memberCountHistory: [],
    isLoading: false,
    isInitialized: false,
    _realtimeUnsubs: [],
};

export const useMasterStore = create<MasterStore>()(
    subscribeWithSelector((set, get) => ({
        ...initialState,

        fetchMasterData: async () => {
            if (get().isLoading) return;

            set({ isLoading: true });
            try {
                // Fetch master data and construction types in parallel
                // 初回はブラウザHTTPキャッシュ(private, max-age=10〜30)を活用してラウンドトリップを削減
                const [masterResponse, constructionTypesResponse, historyResponse] = await Promise.all([
                    fetch('/api/master-data'),
                    fetch('/api/master-data/construction-types'),
                    fetch('/api/master-data/member-count-history'),
                ]);

                let constructionTypes: ConstructionTypeMaster[] = [];
                if (constructionTypesResponse.ok) {
                    constructionTypes = await constructionTypesResponse.json();
                }

                let memberCountHistory: MemberCountHistoryEntry[] = [];
                if (historyResponse.ok) {
                    memberCountHistory = await historyResponse.json();
                }

                if (masterResponse.ok) {
                    const data = await masterResponse.json();
                    set({
                        vehicles: data.vehicles || [],
                        tools: data.tools || [],
                        constructionTypes,
                        totalMembers: data.totalMembers || 20,
                        memberCountHistory,
                        isInitialized: true,
                    });
                }
            } catch (error) {
                logger.error('Failed to fetch master data:', error);
            } finally {
                set({ isLoading: false });
            }
        },

        refreshMasterData: async () => {
            // Realtime通知後の強制再フェッチなのでキャッシュをバイパスする
            try {
                const [masterResponse, constructionTypesResponse, historyResponse] = await Promise.all([
                    fetch('/api/master-data', { cache: 'no-store' }),
                    fetch('/api/master-data/construction-types', { cache: 'no-store' }),
                    fetch('/api/master-data/member-count-history', { cache: 'no-store' }),
                ]);

                let constructionTypes: ConstructionTypeMaster[] = [];
                if (constructionTypesResponse.ok) {
                    constructionTypes = await constructionTypesResponse.json();
                }

                let memberCountHistory: MemberCountHistoryEntry[] = [];
                if (historyResponse.ok) {
                    memberCountHistory = await historyResponse.json();
                }

                if (masterResponse.ok) {
                    const data = await masterResponse.json();
                    set({
                        vehicles: data.vehicles || [],
                        tools: data.tools || [],
                        constructionTypes,
                        totalMembers: data.totalMembers || 20,
                        memberCountHistory,
                        isInitialized: true,
                    });
                }
            } catch (error) {
                logger.error('Failed to refresh master data:', error);
            }
        },

        // Vehicle operations
        // dailyRate は常に送信する（編集UIが名前と日額を同時に保存するため）。
        addVehicle: async (name: string, dailyRate: number | null = null) => {
            const response = await fetch('/api/master-data/vehicles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, dailyRate }),
            });
            if (response.ok) {
                const newVehicle = await response.json();
                set((state) => ({ vehicles: [...state.vehicles, newVehicle] }));
                sendBroadcast(MASTER_DATA_UPDATED, { kind: 'vehicle' });
            }
        },

        updateVehicle: async (id: string, name: string, dailyRate: number | null = null) => {
            const response = await fetch(`/api/master-data/vehicles/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, dailyRate }),
            });
            if (response.ok) {
                set((state) => ({
                    vehicles: state.vehicles.map((v) => (v.id === id ? { ...v, name, dailyRate } : v)),
                }));
                sendBroadcast(MASTER_DATA_UPDATED, { kind: 'vehicle' });
            }
        },

        deleteVehicle: async (id: string) => {
            const response = await fetch(`/api/master-data/vehicles/${id}`, {
                method: 'DELETE',
            });
            if (response.ok) {
                set((state) => ({
                    vehicles: state.vehicles.filter((v) => v.id !== id),
                }));
                sendBroadcast(MASTER_DATA_UPDATED, { kind: 'vehicle' });
            }
        },

        // Tool operations
        // 設定画面（マスター・設定 ＞ 電動工具）の追加・改名・削除。
        // 実体は機材台帳の Tool なので、ここでの変更はそのまま台帳にも出る。
        fetchTools: async () => {
            try {
                const res = await fetch('/api/master-data/tools', { cache: 'no-store' });
                if (!res.ok) return;
                const data = await res.json();
                set({ tools: data.tools || [], toolCategories: data.categories || [] });
            } catch (error) {
                logger.error('Failed to fetch tools:', error);
            }
        },

        notifyMasterDataChanged: async (kind) => {
            await get().refreshMasterData();
            sendBroadcast(MASTER_DATA_UPDATED, { kind });
        },

        addTool: async (name: string, categoryId: string | null = null) => {
            const response = await fetch('/api/master-data/tools', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, categoryId }),
            });
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err?.error || '電動工具の追加に失敗しました');
            }
            // 分類が自動作成される場合があるので一覧ごと取り直す
            await get().fetchTools();
            sendBroadcast(MASTER_DATA_UPDATED, { kind: 'tool' });
        },

        updateTool: async (id: string, name: string, categoryId: string | null = null) => {
            const response = await fetch(`/api/master-data/tools/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(categoryId ? { name, categoryId } : { name }),
            });
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err?.error || '電動工具の更新に失敗しました');
            }
            const updated: ScheduleTool = await response.json();
            set((state) => ({ tools: state.tools.map((t) => (t.id === id ? updated : t)) }));
            sendBroadcast(MASTER_DATA_UPDATED, { kind: 'tool' });
        },

        deleteTool: async (id: string) => {
            const response = await fetch(`/api/master-data/tools/${id}`, { method: 'DELETE' });
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err?.error || '電動工具の削除に失敗しました');
            }
            // 一覧からは消さず isActive=false にする（過去の配置に残る工具名を解決するため）
            set((state) => ({
                tools: state.tools.map((t) => (t.id === id ? { ...t, isActive: false } : t)),
            }));
            sendBroadcast(MASTER_DATA_UPDATED, { kind: 'tool' });
        },

        // Member count history
        fetchMemberCountHistory: async () => {
            try {
                const res = await fetch('/api/master-data/member-count-history');
                if (res.ok) {
                    const history: MemberCountHistoryEntry[] = await res.json();
                    set({ memberCountHistory: history });
                }
            } catch (error) {
                logger.error('Failed to fetch member count history:', error);
            }
        },

        addMemberCountEntry: async (startDate: string, count: number) => {
            const res = await fetch('/api/master-data/member-count-history', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ startDate, count }),
            });
            if (res.ok) {
                await get().fetchMemberCountHistory();
                sendBroadcast(MASTER_DATA_UPDATED, { kind: 'memberCount' });
            }
        },

        updateMemberCountEntry: async (id: string, startDate: string, count: number) => {
            const res = await fetch('/api/master-data/member-count-history', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, startDate, count }),
            });
            if (res.ok) {
                await get().fetchMemberCountHistory();
                sendBroadcast(MASTER_DATA_UPDATED, { kind: 'memberCount' });
            }
        },

        deleteMemberCountEntry: async (id: string) => {
            const res = await fetch('/api/master-data/member-count-history', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id }),
            });
            if (res.ok) {
                await get().fetchMemberCountHistory();
                sendBroadcast(MASTER_DATA_UPDATED, { kind: 'memberCount' });
            }
        },

        getTotalMembersForDate: (dateStr: string) => {
            const history = get().memberCountHistory;
            if (history.length === 0) return get().totalMembers;
            // history is sorted by startDate asc
            // Find the latest entry whose startDate <= dateStr
            let result = history[0].count;
            for (const entry of history) {
                const entryDate = entry.startDate.slice(0, 10);
                if (entryDate <= dateStr) {
                    result = entry.count;
                } else {
                    break;
                }
            }
            return result;
        },

        // Realtime subscription（broadcast）
        // 他端末がマスタを変えたら再取得する。postgres_changes ではなく broadcast を使う理由は
        // MASTER_DATA_UPDATED のコメントを参照（マスタ系はパブリケーションに入っていない）。
        setupRealtimeSubscription: async () => {
            if (get()._realtimeUnsubs.length > 0) return;

            try {
                initBroadcastChannel();
                const off = onBroadcast(MASTER_DATA_UPDATED, () => {
                    if (refreshTimer) clearTimeout(refreshTimer);
                    refreshTimer = setTimeout(() => {
                        refreshTimer = null;
                        get().refreshMasterData();
                    }, REFRESH_DEBOUNCE_MS);
                });
                set({ _realtimeUnsubs: [off] });
            } catch (error) {
                logger.error('[Zustand] Failed to setup master data broadcast subscription:', error);
            }
        },

        cleanupRealtimeSubscription: () => {
            const unsubs = get()._realtimeUnsubs;
            if (unsubs.length === 0) return;
            unsubs.forEach((off) => off());
            if (refreshTimer) {
                clearTimeout(refreshTimer);
                refreshTimer = null;
            }
            set({ _realtimeUnsubs: [] });
        },

        reset: () => {
            get().cleanupRealtimeSubscription();
            set(initialState);
        },
    }))
);

// Selectors for optimized re-renders
export const selectVehicles = (state: MasterStore) => state.vehicles;
export const selectTools = (state: MasterStore) => state.tools;
export const selectToolCategories = (state: MasterStore) => state.toolCategories;
export const selectConstructionTypes = (state: MasterStore) => state.constructionTypes;
export const selectTotalMembers = (state: MasterStore) => state.totalMembers;
export const selectMemberCountHistory = (state: MasterStore) => state.memberCountHistory;
export const selectGetTotalMembersForDate = (state: MasterStore) => state.getTotalMembersForDate;
export const selectIsLoading = (state: MasterStore) => state.isLoading;
export const selectIsInitialized = (state: MasterStore) => state.isInitialized;
