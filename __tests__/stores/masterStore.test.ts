/**
 * stores/masterStore.ts のテスト
 */

import { act } from '@testing-library/react';
import { useMasterStore } from '@/stores/masterStore';

// fetchをモック
const mockFetch = jest.fn();
global.fetch = mockFetch;
// デフォルトの実装を追加（Promise.allで複数回呼ばれるため）
mockFetch.mockResolvedValue({
    ok: true,
    json: async () => [],
});

// Supabaseをモック
jest.mock('@/lib/supabase', () => ({
    supabase: {
        channel: jest.fn(() => ({
            on: jest.fn().mockReturnThis(),
            subscribe: jest.fn(),
        })),
        removeChannel: jest.fn(),
    },
}));

describe('masterStore', () => {
    beforeEach(() => {
        // Storeをリセット
        useMasterStore.getState().reset();
        jest.clearAllMocks();
    });

    describe('初期状態', () => {
        it('should have correct initial state', () => {
            const state = useMasterStore.getState();

            expect(state.vehicles).toEqual([]);
            expect(state.workers).toEqual([]);
            expect(state.managers).toEqual([]);
            expect(state.totalMembers).toBe(20);
            expect(state.isLoading).toBe(false);
            expect(state.isInitialized).toBe(false);
        });
    });

    describe('fetchMasterData', () => {
        it('should fetch and set master data', async () => {
            const mockData = {
                vehicles: [{ id: 'v1', name: 'トラック1' }],
                workers: [{ id: 'w1', name: '作業員1' }],
                managers: [{ id: 'm1', name: '職長1' }],
                totalMembers: 25,
            };

            mockFetch
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve(mockData),
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve([]), // constructionTypes
                });

            await act(async () => {
                await useMasterStore.getState().fetchMasterData();
            });

            const state = useMasterStore.getState();
            expect(state.vehicles).toEqual(mockData.vehicles);
            expect(state.workers).toEqual(mockData.workers);
            expect(state.managers).toEqual(mockData.managers);
            expect(state.totalMembers).toBe(25);
            expect(state.isInitialized).toBe(true);
            expect(state.isLoading).toBe(false);
        });

        it('should not fetch when already loading', async () => {
            // 最初のfetchをセット
            mockFetch.mockImplementation(() => new Promise(() => { })); // 永久にpending

            // 非同期で開始（awaitしない）
            const fetchPromise = useMasterStore.getState().fetchMasterData();

            // もう一度呼び出し
            await useMasterStore.getState().fetchMasterData();

            // fetchは1回だけ呼ばれるべき
            expect(mockFetch).toHaveBeenCalledTimes(2);

            // クリーンアップのためリセット
            useMasterStore.getState().reset();
        });

        it('should handle fetch error', async () => {
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

            mockFetch
                .mockRejectedValueOnce(new Error('Network error'))
                .mockResolvedValueOnce({ ok: true, json: async () => [] });

            await act(async () => {
                await useMasterStore.getState().fetchMasterData();
            });

            expect(consoleSpy).toHaveBeenCalled();
            expect(useMasterStore.getState().isLoading).toBe(false);

            consoleSpy.mockRestore();
        });
    });

    describe('Vehicle operations', () => {
        it('should add vehicle', async () => {
            const newVehicle = { id: 'v-new', name: '新しいトラック' };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(newVehicle),
            });

            await act(async () => {
                await useMasterStore.getState().addVehicle('新しいトラック');
            });

            expect(mockFetch).toHaveBeenCalledWith('/api/master-data/vehicles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: '新しいトラック' }),
            });

            expect(useMasterStore.getState().vehicles).toContainEqual(newVehicle);
        });

        it('should update vehicle', async () => {
            // 初期データをセット
            useMasterStore.setState({
                vehicles: [{ id: 'v1', name: '古い名前' }],
            });

            mockFetch.mockResolvedValueOnce({ ok: true });

            await act(async () => {
                await useMasterStore.getState().updateVehicle('v1', '新しい名前');
            });

            expect(mockFetch).toHaveBeenCalledWith('/api/master-data/vehicles/v1', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: '新しい名前' }),
            });

            expect(useMasterStore.getState().vehicles[0].name).toBe('新しい名前');
        });

        it('should delete vehicle', async () => {
            useMasterStore.setState({
                vehicles: [
                    { id: 'v1', name: 'トラック1' },
                    { id: 'v2', name: 'トラック2' },
                ],
            });

            mockFetch.mockResolvedValueOnce({ ok: true });

            await act(async () => {
                await useMasterStore.getState().deleteVehicle('v1');
            });

            expect(mockFetch).toHaveBeenCalledWith('/api/master-data/vehicles/v1', {
                method: 'DELETE',
            });

            const vehicles = useMasterStore.getState().vehicles;
            expect(vehicles).toHaveLength(1);
            expect(vehicles[0].id).toBe('v2');
        });
    });

    describe('Worker operations', () => {
        it('should add worker', async () => {
            const newWorker = { id: 'w-new', name: '新しい作業員' };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(newWorker),
            });

            await act(async () => {
                await useMasterStore.getState().addWorker('新しい作業員');
            });

            expect(mockFetch).toHaveBeenCalledWith('/api/master-data/workers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: '新しい作業員' }),
            });

            expect(useMasterStore.getState().workers).toContainEqual(newWorker);
        });

        it('should update worker', async () => {
            useMasterStore.setState({
                workers: [{ id: 'w1', name: '古い名前' }],
            });

            mockFetch.mockResolvedValueOnce({ ok: true });

            await act(async () => {
                await useMasterStore.getState().updateWorker('w1', '新しい名前');
            });

            expect(useMasterStore.getState().workers[0].name).toBe('新しい名前');
        });

        it('should delete worker', async () => {
            useMasterStore.setState({
                workers: [
                    { id: 'w1', name: '作業員1' },
                    { id: 'w2', name: '作業員2' },
                ],
            });

            mockFetch.mockResolvedValueOnce({ ok: true });

            await act(async () => {
                await useMasterStore.getState().deleteWorker('w1');
            });

            expect(useMasterStore.getState().workers).toHaveLength(1);
            expect(useMasterStore.getState().workers[0].id).toBe('w2');
        });
    });

    describe('Manager operations', () => {
        it('should add manager', async () => {
            const newManager = { id: 'm-new', name: '新しい職長' };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(newManager),
            });

            await act(async () => {
                await useMasterStore.getState().addManager('新しい職長');
            });

            expect(useMasterStore.getState().managers).toContainEqual(newManager);
        });

        it('should update manager', async () => {
            useMasterStore.setState({
                managers: [{ id: 'm1', name: '古い名前' }],
            });

            mockFetch.mockResolvedValueOnce({ ok: true });

            await act(async () => {
                await useMasterStore.getState().updateManager('m1', '新しい名前');
            });

            expect(useMasterStore.getState().managers[0].name).toBe('新しい名前');
        });

        it('should delete manager', async () => {
            useMasterStore.setState({
                managers: [
                    { id: 'm1', name: '職長1' },
                    { id: 'm2', name: '職長2' },
                ],
            });

            mockFetch.mockResolvedValueOnce({ ok: true });

            await act(async () => {
                await useMasterStore.getState().deleteManager('m1');
            });

            expect(useMasterStore.getState().managers).toHaveLength(1);
            expect(useMasterStore.getState().managers[0].id).toBe('m2');
        });
    });

    describe('updateTotalMembers', () => {
        it('should update total members', async () => {
            mockFetch.mockResolvedValueOnce({ ok: true });

            await act(async () => {
                await useMasterStore.getState().updateTotalMembers(30);
            });

            expect(mockFetch).toHaveBeenCalledWith('/api/master-data/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ totalMembers: 30 }),
            });

            expect(useMasterStore.getState().totalMembers).toBe(30);
        });
    });

    describe('reset', () => {
        it('should reset to initial state', () => {
            // 状態を変更
            useMasterStore.setState({
                vehicles: [{ id: 'v1', name: 'test' }],
                workers: [{ id: 'w1', name: 'test' }],
                managers: [{ id: 'm1', name: 'test' }],
                totalMembers: 100,
                isInitialized: true,
            });

            // リセット
            useMasterStore.getState().reset();

            const state = useMasterStore.getState();
            expect(state.vehicles).toEqual([]);
            expect(state.workers).toEqual([]);
            expect(state.managers).toEqual([]);
            expect(state.totalMembers).toBe(20);
            expect(state.isInitialized).toBe(false);
        });
    });

    describe('Selectors', () => {
        it('should select vehicles correctly', async () => {
            const { selectVehicles } = await import('@/stores/masterStore');

            useMasterStore.setState({
                vehicles: [{ id: 'v1', name: 'トラック' }],
            });

            const vehicles = selectVehicles(useMasterStore.getState());
            expect(vehicles).toEqual([{ id: 'v1', name: 'トラック' }]);
        });

        it('should select workers correctly', async () => {
            const { selectWorkers } = await import('@/stores/masterStore');

            useMasterStore.setState({
                workers: [{ id: 'w1', name: '作業員' }],
            });

            const workers = selectWorkers(useMasterStore.getState());
            expect(workers).toEqual([{ id: 'w1', name: '作業員' }]);
        });
    });

    describe('Realtime & Refresh', () => {
        it('refreshMasterData: should force fetch', async () => {
            mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
            await act(async () => {
                await useMasterStore.getState().refreshMasterData();
            });
            // Should be called 2 times (master-data, construction-types)
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });

        it('setupRealtimeSubscription: should create channels', async () => {
            await act(async () => {
                await useMasterStore.getState().setupRealtimeSubscription();
            });

            const state = useMasterStore.getState();
            expect(state._realtimeChannels).toHaveLength(5); // 5 tables
        });

        it('cleanupRealtimeSubscription: should remove channels', async () => {
            // First setup
            await act(async () => {
                await useMasterStore.getState().setupRealtimeSubscription();
            });

            await act(async () => {
                useMasterStore.getState().cleanupRealtimeSubscription();
            });

            const state = useMasterStore.getState();
            expect(state._realtimeChannels).toHaveLength(0);
        });
    });
});
