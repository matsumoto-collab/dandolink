/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react';
import { useUnitPriceMaster } from '@/hooks/useUnitPriceMaster';

// Mock useSession
const mockSession = { status: 'authenticated' as const, data: { user: { id: 'u1' } } };
jest.mock('next-auth/react', () => ({
    useSession: jest.fn(() => mockSession),
}));

// Mock useRealtimeSubscription
jest.mock('@/hooks/useRealtimeSubscription', () => ({
    useRealtimeSubscription: jest.fn(),
}));

// Mock financeStore actions
const mockFetchUnitPrices = jest.fn();
const mockAddUnitPrice = jest.fn();
const mockUpdateUnitPrice = jest.fn();
const mockDeleteUnitPrice = jest.fn();
const mockGetUnitPriceById = jest.fn();
const mockGetUnitPricesByTemplate = jest.fn();

jest.mock('@/stores/financeStore', () => ({
    useFinanceStore: jest.fn((selector: any) => {
        const state = {
            unitPrices: [{ id: 'up1', description: 'テスト単価' }],
            unitPricesLoading: false,
            unitPricesInitialized: false,
            fetchUnitPrices: mockFetchUnitPrices,
            addUnitPrice: mockAddUnitPrice,
            updateUnitPrice: mockUpdateUnitPrice,
            deleteUnitPrice: mockDeleteUnitPrice,
            getUnitPriceById: mockGetUnitPriceById,
            getUnitPricesByTemplate: mockGetUnitPricesByTemplate,
        };
        return selector(state);
    }),
}));

import { useSession } from 'next-auth/react';
import { useRealtimeSubscription } from '@/hooks/useRealtimeSubscription';

describe('useUnitPriceMaster', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('初期状態の返り値を確認', () => {
        const { result } = renderHook(() => useUnitPriceMaster());

        expect(result.current.unitPrices).toEqual([{ id: 'up1', description: 'テスト単価' }]);
        expect(result.current.isLoading).toBe(false);
        expect(result.current.isInitialized).toBe(false);
        expect(typeof result.current.ensureDataLoaded).toBe('function');
        expect(typeof result.current.addUnitPrice).toBe('function');
        expect(typeof result.current.updateUnitPrice).toBe('function');
        expect(typeof result.current.deleteUnitPrice).toBe('function');
        expect(typeof result.current.refreshUnitPrices).toBe('function');
    });

    it('ensureDataLoaded: 認証済み＋未初期化時に fetchUnitPrices 呼び出し', async () => {
        const { result } = renderHook(() => useUnitPriceMaster());

        await act(async () => {
            await result.current.ensureDataLoaded();
        });

        expect(mockFetchUnitPrices).toHaveBeenCalledTimes(1);
    });

    it('ensureDataLoaded: 未認証時はフェッチしない', async () => {
        (useSession as jest.Mock).mockReturnValue({ status: 'unauthenticated', data: null });

        const { result } = renderHook(() => useUnitPriceMaster());

        await act(async () => {
            await result.current.ensureDataLoaded();
        });

        expect(mockFetchUnitPrices).not.toHaveBeenCalled();

        // Restore
        (useSession as jest.Mock).mockReturnValue(mockSession);
    });

    it('addUnitPrice: ストアのアクションを呼び出す', async () => {
        const { result } = renderHook(() => useUnitPriceMaster());
        const input = { description: '新しい単価', unitPrice: 1000 } as any;

        await act(async () => {
            await result.current.addUnitPrice(input);
        });

        expect(mockAddUnitPrice).toHaveBeenCalledWith(input);
    });

    it('updateUnitPrice: ストアのアクションを呼び出す', async () => {
        const { result } = renderHook(() => useUnitPriceMaster());

        await act(async () => {
            await result.current.updateUnitPrice('up1', { description: '更新' });
        });

        expect(mockUpdateUnitPrice).toHaveBeenCalledWith('up1', { description: '更新' });
    });

    it('deleteUnitPrice: ストアのアクションを呼び出す', async () => {
        const { result } = renderHook(() => useUnitPriceMaster());

        await act(async () => {
            await result.current.deleteUnitPrice('up1');
        });

        expect(mockDeleteUnitPrice).toHaveBeenCalledWith('up1');
    });

    it('refreshUnitPrices: fetchUnitPrices を直接呼び出す', async () => {
        const { result } = renderHook(() => useUnitPriceMaster());

        await act(async () => {
            await result.current.refreshUnitPrices();
        });

        expect(mockFetchUnitPrices).toHaveBeenCalledTimes(1);
    });

    it('useRealtimeSubscription が正しいオプションで呼ばれる', () => {
        renderHook(() => useUnitPriceMaster());

        expect(useRealtimeSubscription).toHaveBeenCalledWith(
            expect.objectContaining({
                table: 'UnitPriceMaster',
                channelName: 'unit-prices-changes-zustand',
                enabled: false, // authenticated but not initialized
            })
        );
    });
});
