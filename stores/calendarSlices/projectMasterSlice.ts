import { CalendarSlice, CalendarActions, CalendarState, parseProjectMasterDates } from './types';
import { sendBroadcast } from '@/lib/broadcastChannel';

type ProjectMasterSlice = Pick<CalendarState, 'projectMasters' | 'projectMastersLoading' | 'projectMastersError' | 'projectMastersInitialized'> &
    Pick<CalendarActions, 'fetchProjectMasters' | 'createProjectMaster' | 'updateProjectMaster' | 'deleteProjectMaster' | 'getProjectMasterById'>;

export const createProjectMasterSlice: CalendarSlice<ProjectMasterSlice> = (set, get) => ({
    projectMasters: [],
    projectMastersLoading: false,
    projectMastersError: null,
    projectMastersInitialized: false,

    fetchProjectMasters: async (search?: string, status?: string) => {
        set({ projectMastersLoading: true, projectMastersError: null });
        try {
            const params = new URLSearchParams();
            if (search) params.append('search', search);
            if (status) params.append('status', status);

            const url = `/api/project-masters${params.toString() ? `?${params}` : ''}`;
            const res = await fetch(url);

            if (!res.ok) {
                throw new Error('案件マスターの取得に失敗しました');
            }

            const data = await res.json();
            set({
                projectMasters: data.map(parseProjectMasterDates),
                projectMastersInitialized: true,
            });
        } catch (err) {
            console.error('Fetch project masters error:', err);
            set({ projectMastersError: err instanceof Error ? err.message : '不明なエラー' });
        } finally {
            set({ projectMastersLoading: false });
        }
    },

    createProjectMaster: async (data) => {
        const res = await fetch('/api/project-masters', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || '案件マスターの作成に失敗しました');
        }

        const newPm = await res.json();
        const formatted = parseProjectMasterDates(newPm);
        set((state) => ({
            projectMasters: [formatted, ...state.projectMasters],
        }));
        sendBroadcast('project_master_updated', { id: formatted.id });
        return formatted;
    },

    updateProjectMaster: async (id, data) => {
        const res = await fetch(`/api/project-masters/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || '案件マスターの更新に失敗しました');
        }

        const updatedPm = await res.json();
        const formatted = parseProjectMasterDates(updatedPm);
        set((state) => ({
            projectMasters: state.projectMasters.map((pm) => (pm.id === id ? formatted : pm)),
        }));
        sendBroadcast('project_master_updated', { id: formatted.id });
        return formatted;
    },

    deleteProjectMaster: async (id) => {
        const res = await fetch(`/api/project-masters/${id}`, { method: 'DELETE' });

        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.error || '案件マスターの削除に失敗しました');
        }

        set((state) => ({
            projectMasters: state.projectMasters.filter((pm) => pm.id !== id),
        }));
        sendBroadcast('project_master_deleted', { id });
    },

    getProjectMasterById: (id) => get().projectMasters.find((pm) => pm.id === id),
});
