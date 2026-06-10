import { CalendarSlice, CalendarActions, CalendarState, DateKeyRange, mergeRangeFetchedMap } from './types';
import { sendBroadcast } from '@/lib/broadcastChannel';
import { logger } from '@/lib/logger';

interface MemberAdjustmentSlice extends
    Pick<CalendarState, 'memberAdjustments' | 'memberAdjustmentsInitialized'>,
    Pick<CalendarActions, 'fetchMemberAdjustments' | 'getMemberAdjustment' | 'setMemberAdjustment'> { }

export const createMemberAdjustmentSlice: CalendarSlice<MemberAdjustmentSlice> = (set, get) => ({
    memberAdjustments: {},
    memberAdjustmentsInitialized: false,

    fetchMemberAdjustments: async (range?: DateKeyRange) => {
        try {
            const url = range
                ? `/api/calendar/member-adjustments?from=${range.from}&to=${range.to}`
                : '/api/calendar/member-adjustments';
            const response = await fetch(url, { cache: 'no-store' });
            if (response.ok) {
                const data = await response.json();
                if (range) {
                    // 範囲内キーのみ差し替え（範囲外のキャッシュは保持）
                    set((state) => ({
                        memberAdjustments: mergeRangeFetchedMap(state.memberAdjustments, data, range),
                        memberAdjustmentsInitialized: true,
                    }));
                } else {
                    set({ memberAdjustments: data, memberAdjustmentsInitialized: true });
                }
            } else {
                // 失敗時もinitializedを立ててUIをアンブロック（調整0として扱う）
                set({ memberAdjustmentsInitialized: true });
            }
        } catch (error) {
            logger.error('Failed to fetch member adjustments:', error);
            set({ memberAdjustmentsInitialized: true });
        }
    },

    getMemberAdjustment: (dateKey: string) => {
        return get().memberAdjustments[dateKey] || 0;
    },

    setMemberAdjustment: async (dateKey: string, adjustment: number) => {
        // Optimistic update
        set((state) => ({
            memberAdjustments: {
                ...state.memberAdjustments,
                [dateKey]: adjustment,
            },
        }));

        try {
            await fetch('/api/calendar/member-adjustments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateKey, adjustment }),
            });
            sendBroadcast('member_adjustment_updated', { dateKey });
        } catch (error) {
            logger.error('Failed to set member adjustment:', error);
            get().fetchMemberAdjustments();
        }
    },
});
