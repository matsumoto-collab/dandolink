import { CalendarSlice, CalendarActions, CalendarState, ForemanUser, MemberUser } from './types';
import { sendBroadcast } from '@/lib/broadcastChannel';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { logger } from '@/lib/logger';
import { splitForemanOrder, mergeForemanOrder, clampFloatingLaneIndex, nextFloatingLaneIndex } from '@/lib/floatingLaneOrder';

type ForemanSlice = Pick<CalendarState, 'displayedForemanIds' | 'floatingLaneIndex' | 'allForemen' | 'foremanSettingsLoading' | 'foremanSettingsInitialized' | 'allMembers' | 'allMembersInitialized'> &
    Pick<CalendarActions, 'fetchForemen' | 'fetchForemanSettings' | 'fetchAllMembers' | 'addForeman' | 'removeForeman' | 'moveForeman' | 'moveFloatingLane' | 'getAvailableForemen' | 'getForemanName' | 'initializeForemenFromAll'>;

// 同時マウント時の重複fetch排除（同一Promise共有）
let allMembersFetchPromise: Promise<void> | null = null;

/**
 * 職長の並び順を保存する。浮きレーンの位置（floatingLaneIndex）は同じ配列に
 * 予約ID 'unassigned' として混ぜて送る（lib/floatingLaneOrder.ts）。
 * ストアが持つ displayedForemanIds には予約IDを入れない＝他画面へ漏らさない。
 */
async function persistForemanOrder(ids: string[], floatingLaneIndex: number | null): Promise<void> {
    const res = await fetch('/api/system-settings/foremen', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayedForemanIds: mergeForemanOrder(ids, floatingLaneIndex) }),
    });
    if (!res.ok) throw new Error('Failed to save foreman order');
    sendBroadcast('foreman_settings_updated', {});
}

export const createForemanSlice: CalendarSlice<ForemanSlice> = (set, get) => ({
    displayedForemanIds: [],
    floatingLaneIndex: null,
    allForemen: [],
    foremanSettingsLoading: false,
    foremanSettingsInitialized: false,
    allMembers: [],
    allMembersInitialized: false,

    fetchForemen: async () => {
        try {
            // ブラウザHTTPキャッシュ(private, max-age=30) を活用。
            // 変更時は Realtime/broadcast 経由で refresh されるため staleness は短時間で解消する
            const response = await fetchWithTimeout('/api/dispatch/foremen?scope=schedule');
            if (response.ok) {
                const data: ForemanUser[] = await response.json();
                set({ allForemen: data });
            }
        } catch (error) {
            logger.error('Failed to fetch foremen:', error);
        }
    },

    fetchAllMembers: async () => {
        if (get().allMembersInitialized) return;
        if (allMembersFetchPromise) return allMembersFetchPromise;
        allMembersFetchPromise = (async () => {
            try {
                const response = await fetch('/api/calendar/members');
                if (response.ok) {
                    const data: MemberUser[] = await response.json();
                    set({ allMembers: data, allMembersInitialized: true });
                } else {
                    set({ allMembersInitialized: true });
                }
            } catch (error) {
                logger.error('Failed to fetch all members:', error);
                set({ allMembersInitialized: true });
            } finally {
                allMembersFetchPromise = null;
            }
        })();
        return allMembersFetchPromise;
    },

    fetchForemanSettings: async () => {
        set({ foremanSettingsLoading: true });
        try {
            // タイムアウト付き: ストールすると初回ロードのスピナーが永久に解除できないため
            const response = await fetchWithTimeout('/api/system-settings/foremen', { cache: 'no-store' });
            if (response.ok) {
                const data = await response.json();
                if (data.displayedForemanIds && data.displayedForemanIds.length > 0) {
                    // 保存配列に混ぜてある浮きレーンの位置をここで切り離す
                    const { foremanIds, floatingLaneIndex } = splitForemanOrder(data.displayedForemanIds);
                    set({ displayedForemanIds: foremanIds, floatingLaneIndex });
                }
            }
        } catch (error) {
            logger.error('Failed to fetch user settings:', error);
        } finally {
            set({ foremanSettingsLoading: false, foremanSettingsInitialized: true });
        }
    },

    addForeman: async (employeeId) => {
        const { displayedForemanIds, floatingLaneIndex } = get();
        if (!displayedForemanIds.includes(employeeId)) {
            const previousIds = [...displayedForemanIds];
            const newIds = [...displayedForemanIds, employeeId];
            // 浮きレーンを一番下に置いていたなら、追加後も一番下のままにする
            const newIndex = floatingLaneIndex != null && floatingLaneIndex >= previousIds.length
                ? newIds.length
                : floatingLaneIndex;
            set({ displayedForemanIds: newIds, floatingLaneIndex: newIndex });
            try {
                await persistForemanOrder(newIds, newIndex);
            } catch (error) {
                set({ displayedForemanIds: previousIds, floatingLaneIndex });
                logger.error('Failed to add foreman:', error);
            }
        }
    },

    removeForeman: async (employeeId) => {
        const { displayedForemanIds, floatingLaneIndex } = get();
        const previousIds = [...displayedForemanIds];
        const newIds = previousIds.filter((id) => id !== employeeId);
        // 職長が減った分だけ位置が溢れることがあるので詰める
        const newIndex = floatingLaneIndex == null ? null : clampFloatingLaneIndex(floatingLaneIndex, newIds.length);
        set({ displayedForemanIds: newIds, floatingLaneIndex: newIndex });
        try {
            await persistForemanOrder(newIds, newIndex);
        } catch (error) {
            set({ displayedForemanIds: previousIds, floatingLaneIndex });
            logger.error('Failed to remove foreman:', error);
        }
    },

    moveForeman: async (employeeId, direction) => {
        const { displayedForemanIds, floatingLaneIndex } = get();
        const currentIndex = displayedForemanIds.indexOf(employeeId);
        if (currentIndex === -1) return;

        const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (newIndex < 0 || newIndex >= displayedForemanIds.length) return;

        const previousIds = [...displayedForemanIds];
        const newIds = [...displayedForemanIds];
        [newIds[currentIndex], newIds[newIndex]] = [newIds[newIndex], newIds[currentIndex]];
        set({ displayedForemanIds: newIds });
        try {
            await persistForemanOrder(newIds, floatingLaneIndex);
        } catch (error) {
            set({ displayedForemanIds: previousIds });
            logger.error('Failed to move foreman:', error);
        }
    },

    moveFloatingLane: async (direction) => {
        const { displayedForemanIds, floatingLaneIndex, allForemen } = get();
        // 画面に出ている職長だけを数える（退職者などが並びに残っていても1段ずつ動かすため）
        const visible = new Set(
            displayedForemanIds.filter((id) => allForemen.some((f) => f.id === id))
        );
        const newIndex = nextFloatingLaneIndex(floatingLaneIndex, direction, displayedForemanIds, visible);
        if (newIndex === clampFloatingLaneIndex(floatingLaneIndex, displayedForemanIds.length)) return;

        set({ floatingLaneIndex: newIndex });
        try {
            await persistForemanOrder(displayedForemanIds, newIndex);
        } catch (error) {
            set({ floatingLaneIndex });
            logger.error('Failed to move floating lane:', error);
        }
    },

    getAvailableForemen: () => {
        const { allForemen, displayedForemanIds } = get();
        return allForemen
            .filter((user) => !displayedForemanIds.includes(user.id))
            .map((user) => ({ id: user.id, name: user.displayName }));
    },

    getForemanName: (id) => {
        const foreman = get().allForemen.find((f) => f.id === id);
        return foreman?.displayName || '不明';
    },

    initializeForemenFromAll: () => {
        const { allForemen, displayedForemanIds } = get();
        if (displayedForemanIds.length === 0 && allForemen.length > 0) {
            set({ displayedForemanIds: allForemen.map((f) => f.id) });
        }
    },
});
