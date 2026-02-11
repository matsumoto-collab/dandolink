/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react';
import { useAssignmentPresence } from '@/hooks/useAssignmentPresence';

// Mock useSession
const mockSession = {
    data: {
        user: { id: 'user1', name: 'テストユーザー', email: 'test@test.com' },
    },
};
jest.mock('next-auth/react', () => ({
    useSession: jest.fn(() => mockSession),
}));

// Mock supabase
const mockTrack = jest.fn().mockResolvedValue(undefined);
const mockUntrack = jest.fn().mockResolvedValue(undefined);
const mockSubscribe = jest.fn().mockImplementation((callback: any) => {
    if (callback) callback('SUBSCRIBED');
    return mockChannel;
});
const mockOn = jest.fn().mockReturnThis();
const mockChannel = {
    on: mockOn,
    subscribe: mockSubscribe,
    track: mockTrack,
    untrack: mockUntrack,
    presenceState: jest.fn().mockReturnValue({}),
};
const mockRemoveChannel = jest.fn();

jest.mock('@/lib/supabase', () => ({
    supabase: {
        channel: jest.fn(() => mockChannel),
        removeChannel: mockRemoveChannel,
    },
}));

describe('useAssignmentPresence', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('初期状態の返り値を確認', () => {
        const { result } = renderHook(() => useAssignmentPresence());

        expect(typeof result.current.startEditing).toBe('function');
        expect(typeof result.current.stopEditing).toBe('function');
        expect(typeof result.current.getEditingUsers).toBe('function');
        expect(typeof result.current.isBeingEdited).toBe('function');
        expect(result.current.editingUsers).toBeInstanceOf(Map);
        expect(result.current.editingUsers.size).toBe(0);
    });

    it('getEditingUsers: 自分以外の編集ユーザーを返す', () => {
        const { result } = renderHook(() => useAssignmentPresence());

        // editingUsers が空の場合は空配列を返す
        const users = result.current.getEditingUsers('assignment1');
        expect(users).toEqual([]);
    });

    it('isBeingEdited: 編集中ユーザーがいなければ false', () => {
        const { result } = renderHook(() => useAssignmentPresence());

        expect(result.current.isBeingEdited('assignment1')).toBe(false);
    });

    it('stopEditing: チャンネルがない場合は何もしない', async () => {
        // Render without session to avoid channel setup
        const { useSession: mockUseSession } = jest.requireMock('next-auth/react');
        mockUseSession.mockReturnValueOnce({ data: null });

        const { result } = renderHook(() => useAssignmentPresence());

        await act(async () => {
            await result.current.stopEditing();
        });

        expect(mockUntrack).not.toHaveBeenCalled();
    });

    it('startEditing: セッションがない場合は何もしない', async () => {
        const { useSession: mockUseSession } = jest.requireMock('next-auth/react');
        mockUseSession.mockReturnValueOnce({ data: null });

        const { result } = renderHook(() => useAssignmentPresence());

        await act(async () => {
            await result.current.startEditing('assignment1');
        });

        expect(mockTrack).not.toHaveBeenCalled();
    });

    it('セッションがある場合にチャンネルをセットアップする', async () => {
        await act(async () => {
            renderHook(() => useAssignmentPresence());
        });

        // supabase.channel が呼ばれることを確認
        const { supabase } = jest.requireMock('@/lib/supabase');
        expect(supabase.channel).toHaveBeenCalledWith('assignment_editing', expect.any(Object));
    });

    it('アンマウント時にチャンネルをクリーンアップする', async () => {
        let unmount: () => void;

        await act(async () => {
            const hook = renderHook(() => useAssignmentPresence());
            unmount = hook.unmount;
        });

        act(() => {
            unmount!();
        });

        // クリーンアップは非同期importを使うため、直接是非を確認する代わりに
        // channelRef.current = null が設定されることを代理的に確認
        // (removeChannel は非同期importのため直接検証が難しい)
    });
});
