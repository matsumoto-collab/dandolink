import { Estimate, EstimateInput } from '@/types/estimate';
import { logger } from '@/lib/logger';
import { FinanceSlice, FinanceState, FinanceActions } from './types';

type EstimateApiResponse = Omit<Estimate, 'validUntil' | 'createdAt' | 'updatedAt' | 'projectId'> & {
    projectId?: string;
    projectMasterId?: string;
    validUntil: string;
    createdAt: string;
    updatedAt: string;
};

function parseEstimateDates(estimate: EstimateApiResponse): Estimate {
    return {
        ...estimate,
        projectId: estimate.projectId ?? estimate.projectMasterId ?? undefined,
        costTotal: estimate.costTotal ?? null,
        validUntil: new Date(estimate.validUntil),
        createdAt: new Date(estimate.createdAt),
        updatedAt: new Date(estimate.updatedAt),
    };
}

function toEstimateApiPayload(data: Partial<EstimateInput>): Record<string, unknown> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { projectId, ...rest } = data;
    return {
        ...rest,
        projectMasterId: projectId,
        costTotal: rest.costTotal ?? null,
    };
}

type EstimateSlice = Pick<FinanceState, 'estimates' | 'estimatesLoading' | 'estimatesInitialized'> &
    Pick<FinanceActions, 'fetchEstimates' | 'addEstimate' | 'updateEstimate' | 'deleteEstimate' | 'getEstimate' | 'getEstimatesByProject'>;

export const createEstimateSlice: FinanceSlice<EstimateSlice> = (set, get) => ({
    estimates: [],
    estimatesLoading: false,
    estimatesInitialized: false,

    fetchEstimates: async () => {
        if (get().estimatesLoading) return;

        set({ estimatesLoading: true });
        try {
            const response = await fetch('/api/estimates');
            if (response.ok) {
                const data = await response.json();
                set({
                    estimates: data.map(parseEstimateDates),
                    estimatesInitialized: true,
                });
            }
        } catch (error) {
            logger.error('Failed to fetch estimates:', error);
        } finally {
            set({ estimatesLoading: false });
        }
    },

    addEstimate: async (data: EstimateInput) => {
        const response = await fetch('/api/estimates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(toEstimateApiPayload(data)),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '見積の追加に失敗しました');
        }

        const newEstimate = await response.json();
        const parsed = parseEstimateDates(newEstimate);
        set((state) => ({
            estimates: [...state.estimates, parsed],
        }));
        return parsed;
    },

    updateEstimate: async (id: string, data: Partial<EstimateInput>) => {
        const response = await fetch(`/api/estimates/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(toEstimateApiPayload(data)),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '見積の更新に失敗しました');
        }

        const updated = await response.json();
        set((state) => ({
            estimates: state.estimates.map((e) => (e.id === id ? parseEstimateDates(updated) : e)),
        }));
    },

    deleteEstimate: async (id: string) => {
        const response = await fetch(`/api/estimates/${id}`, { method: 'DELETE' });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '見積の削除に失敗しました');
        }

        set((state) => ({
            estimates: state.estimates.filter((e) => e.id !== id),
        }));
    },

    getEstimate: (id: string) => get().estimates.find((e) => e.id === id),

    getEstimatesByProject: (projectId: string) =>
        get().estimates.filter((e) => e.projectId === projectId),
});
