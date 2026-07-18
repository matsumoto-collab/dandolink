import { CalendarSlice, CalendarActions, CalendarState, ForemanUser, MemberUser } from './types';
import { sendBroadcast } from '@/lib/broadcastChannel';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { logger } from '@/lib/logger';

type ForemanSlice = Pick<CalendarState, 'displayedForemanIds' | 'allForemen' | 'foremanSettingsLoading' | 'foremanSettingsInitialized' | 'allMembers' | 'allMembersInitialized'> &
    Pick<CalendarActions, 'fetchForemen' | 'fetchForemanSettings' | 'fetchAllMembers' | 'addForeman' | 'removeForeman' | 'moveForeman' | 'getAvailableForemen' | 'getForemanName' | 'initializeForemenFromAll'>;

// 同時マウント時の重複fetch排除（同一Promise共有）
let allMembersFetchPromise: Promise<void> | null = null;

export const createForemanSlice: CalendarSlice<ForemanSlice> = (set, get) => ({
    displayedForemanIds: [],
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
                    set({ displayedForemanIds: data.displayedForemanIds });
                }
            }
        } catch (error) {
            logger.error('Failed to fetch user settings:', error);
        } finally {
            set({ foremanSettingsLoading: false, foremanSettingsInitialized: true });
        }
    },

    addForeman: async (employeeId) => {
        const { displayedForemanIds } = get();
        if (!displayedForemanIds.includes(employeeId)) {
            const previousIds = [...displayedForemanIds];
            const newIds = [...displayedForemanIds, employeeId];
            set({ displayedForemanIds: newIds });
            try {
                const res = await fetch('/api/system-settings/foremen', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ displayedForemanIds: newIds }),
                });
                if (!res.ok) throw new Error('Failed to add foreman');
                sendBroadcast('foreman_settings_updated', {});
            } catch (error) {
                set({ displayedForemanIds: previousIds });
                logger.error('Failed to add foreman:', error);
            }
        }
    },

    removeForeman: async (employeeId) => {
        const previousIds = [...get().displayedForemanIds];
        const newIds = previousIds.filter((id) => id !== employeeId);
        set({ displayedForemanIds: newIds });
        try {
            const res = await fetch('/api/system-settings/foremen', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ displayedForemanIds: newIds }),
            });
            if (!res.ok) throw new Error('Failed to remove foreman');
            sendBroadcast('foreman_settings_updated', {});
        } catch (error) {
            set({ displayedForemanIds: previousIds });
            logger.error('Failed to remove foreman:', error);
        }
    },

    moveForeman: async (employeeId, direction) => {
        const { displayedForemanIds } = get();
        const currentIndex = displayedForemanIds.indexOf(employeeId);
        if (currentIndex === -1) return;

        const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (newIndex < 0 || newIndex >= displayedForemanIds.length) return;

        const previousIds = [...displayedForemanIds];
        const newIds = [...displayedForemanIds];
        [newIds[currentIndex], newIds[newIndex]] = [newIds[newIndex], newIds[currentIndex]];
        set({ displayedForemanIds: newIds });
        try {
            const res = await fetch('/api/system-settings/foremen', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ displayedForemanIds: newIds }),
            });
            if (!res.ok) throw new Error('Failed to move foreman');
            sendBroadcast('foreman_settings_updated', {});
        } catch (error) {
            set({ displayedForemanIds: previousIds });
            logger.error('Failed to move foreman:', error);
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
