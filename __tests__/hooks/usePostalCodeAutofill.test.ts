/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react';
import { usePostalCodeAutofill } from '@/hooks/usePostalCodeAutofill';

// global.fetch をモック化
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('usePostalCodeAutofill', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('正常系: 7桁の郵便番号で住所情報を返す', async () => {
        mockFetch.mockResolvedValue({
            json: async () => ({
                results: [{
                    address1: '東京都',
                    address2: '千代田区',
                    address3: '丸の内',
                }],
            }),
        });

        const { result } = renderHook(() => usePostalCodeAutofill());
        let address: any;

        await act(async () => {
            address = await result.current.fetchAddress('1000005');
        });

        expect(address).toEqual({
            prefecture: '東京都',
            city: '千代田区丸の内',
        });
        expect(mockFetch).toHaveBeenCalledWith(
            'https://zipcloud.ibsnet.co.jp/api/search?zipcode=1000005'
        );
    });

    it('ハイフン付き郵便番号でも動作する', async () => {
        mockFetch.mockResolvedValue({
            json: async () => ({
                results: [{
                    address1: '大阪府',
                    address2: '大阪市北区',
                    address3: '梅田',
                }],
            }),
        });

        const { result } = renderHook(() => usePostalCodeAutofill());
        let address: any;

        await act(async () => {
            address = await result.current.fetchAddress('530-0001');
        });

        expect(address).toEqual({
            prefecture: '大阪府',
            city: '大阪市北区梅田',
        });
    });

    it('7桁未満の場合は null を返す', async () => {
        const { result } = renderHook(() => usePostalCodeAutofill());
        let address: any;

        await act(async () => {
            address = await result.current.fetchAddress('123');
        });

        expect(address).toBeNull();
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('空文字の場合は null を返す', async () => {
        const { result } = renderHook(() => usePostalCodeAutofill());
        let address: any;

        await act(async () => {
            address = await result.current.fetchAddress('');
        });

        expect(address).toBeNull();
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('APIがデータなし (results: null) の場合は null を返す', async () => {
        mockFetch.mockResolvedValue({
            json: async () => ({ results: null }),
        });

        const { result } = renderHook(() => usePostalCodeAutofill());
        let address: any;

        await act(async () => {
            address = await result.current.fetchAddress('0000000');
        });

        expect(address).toBeNull();
    });

    it('fetch失敗時は null を返しエラーをログ', async () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
        mockFetch.mockRejectedValue(new Error('Network error'));

        const { result } = renderHook(() => usePostalCodeAutofill());
        let address: any;

        await act(async () => {
            address = await result.current.fetchAddress('1000005');
        });

        expect(address).toBeNull();
        expect(consoleSpy).toHaveBeenCalledWith(
            'Failed to fetch address:',
            expect.any(Error)
        );
        consoleSpy.mockRestore();
    });
});
