import { CalendarSlice, CalendarActions, CalendarState } from './types';
import { sendBroadcast } from '@/lib/broadcastChannel';

interface MemberAdjustmentSlice extends
    Pick<CalendarState, 'memberAdjustments' | 'memberAdjustmentsInitialized'>,
    Pick<CalendarActions, 'fetchMemberAdjustments' | 'getMemberAdjustment' | 'setMemberAdjustment'> { }

export const createMemberAdjustmentSlice: CalendarSlice<MemberAdjustmentSlice> = (set, get) => ({
    memberAdjustments: {},
    memberAdjustmentsInitialized: false,

    fetchMemberAdjustments: async () => {
        try {
            const response = await fetch('/api/calendar/member-adjustments', { cache: 'no-store' });
            if (response.ok) {
                const data = await response.json();
                set({ memberAdjustments: data, memberAdjustmentsInitialized: true });
            }
        } catch (error) {
            console.error('Failed to fetch member adjustments:', error);
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
            console.error('Failed to set member adjustment:', error);
            get().fetchMemberAdjustments();
        }
    },
});
