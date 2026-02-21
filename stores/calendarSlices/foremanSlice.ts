import { CalendarSlice, CalendarActions, CalendarState, ForemanUser } from './types';
import { sendBroadcast } from '@/lib/broadcastChannel';

type ForemanSlice = Pick<CalendarState, 'displayedForemanIds' | 'allForemen' | 'foremanSettingsLoading' | 'foremanSettingsInitialized'> &
    Pick<CalendarActions, 'fetchForemen' | 'fetchForemanSettings' | 'addForeman' | 'removeForeman' | 'moveForeman' | 'getAvailableForemen' | 'getForemanName' | 'initializeForemenFromAll'>;

export const createForemanSlice: CalendarSlice<ForemanSlice> = (set, get) => ({
    displayedForemanIds: [],
    allForemen: [],
    foremanSettingsLoading: false,
    foremanSettingsInitialized: false,

    fetchForemen: async () => {
        try {
            const response = await fetch('/api/dispatch/foremen', { cache: 'no-store' });
            if (response.ok) {
                const data: ForemanUser[] = await response.json();
                set({ allForemen: data });
            }
        } catch (error) {
            console.error('Failed to fetch foremen:', error);
        }
    },

    fetchForemanSettings: async () => {
        set({ foremanSettingsLoading: true });
        try {
            const response = await fetch('/api/system-settings/foremen', { cache: 'no-store' });
            if (response.ok) {
                const data = await response.json();
                if (data.displayedForemanIds && data.displayedForemanIds.length > 0) {
                    set({ displayedForemanIds: data.displayedForemanIds });
                }
            }
        } catch (error) {
            console.error('Failed to fetch user settings:', error);
        } finally {
            set({ foremanSettingsLoading: false, foremanSettingsInitialized: true });
        }
    },

    addForeman: async (employeeId) => {
        const { displayedForemanIds } = get();
        if (!displayedForemanIds.includes(employeeId)) {
            const newIds = [...displayedForemanIds, employeeId];
            set({ displayedForemanIds: newIds });
            await fetch('/api/system-settings/foremen', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ displayedForemanIds: newIds }),
            });
            sendBroadcast('foreman_settings_updated', {});
        }
    },

    removeForeman: async (employeeId) => {
        const newIds = get().displayedForemanIds.filter((id) => id !== employeeId);
        set({ displayedForemanIds: newIds });
        await fetch('/api/system-settings/foremen', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayedForemanIds: newIds }),
        });
        sendBroadcast('foreman_settings_updated', {});
    },

    moveForeman: async (employeeId, direction) => {
        const { displayedForemanIds } = get();
        const currentIndex = displayedForemanIds.indexOf(employeeId);
        if (currentIndex === -1) return;

        const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (newIndex < 0 || newIndex >= displayedForemanIds.length) return;

        const newIds = [...displayedForemanIds];
        [newIds[currentIndex], newIds[newIndex]] = [newIds[newIndex], newIds[currentIndex]];
        set({ displayedForemanIds: newIds });
        await fetch('/api/system-settings/foremen', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayedForemanIds: newIds }),
        });
        sendBroadcast('foreman_settings_updated', {});
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
