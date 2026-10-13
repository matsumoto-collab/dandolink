/**
 * 「記号の登録」画面（RoadPermitSymbolsModal）のテスト。
 * 本物の API にはつながない（fetch をモックにする）。見るのは
 *   - 一覧が出る（名前・分類・数量の数え方・大きさ）
 *   - 使う／使わない が PUT で保存され、保存後に road_permit_symbols_updated を送る
 *   - 取り込みの流れ: ファイルを選ぶ → 候補が並ぶ → チェック → 入力（コーンバーの初期値）→「登録」で POST
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import RoadPermitSymbolsModal from '@/components/RoadPermits/RoadPermitSymbolsModal';
import { sendBroadcast } from '@/lib/broadcastChannel';
import type { ParseJwwResponse, RoadPermitSymbolDto } from '@/types/roadPermitSymbol';

jest.mock('react-hot-toast', () => {
    const t = Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() });
    return { __esModule: true, default: t };
});
jest.mock('@/lib/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));
jest.mock('@/lib/broadcastChannel', () => ({ initBroadcastChannel: jest.fn(), sendBroadcast: jest.fn(), onBroadcast: jest.fn(() => () => {}) }));

// ---------------------------------------------------------------- 材料

const geometry = { lines: [-100, -100, 100, 100], circles: [], arcs: [], polylines: [] };

const symbol = (patch: Partial<RoadPermitSymbolDto> = {}): RoadPermitSymbolDto => ({
    id: 's1',
    name: 'カラーコーン',
    category: 'cone',
    countLabel: 'カラーコーン',
    countUnit: '個',
    countNote: '',
    geometry,
    lengthMm: 390,
    widthMm: 390,
    barPitchMm: null,
    sourceFile: 'cone.jww',
    sourceBlock: '*U54',
    sourceNote: '配布元',
    sortOrder: 0,
    isActive: true,
    createdAt: '2026-10-13T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z',
    ...patch,
});

const parseResponse: ParseJwwResponse = {
    fileName: 'cone.jww',
    blocks: [
        {
            key: '24',
            name: 'コーンバー1500p',
            rawName: 'コーンバー1500p@@SfigorgFlag@@4',
            geometry: { lines: [-750, -48.5, 750, 48.5], circles: [], arcs: [], polylines: [] },
            lengthMm: 1500,
            widthMm: 97,
            primitiveCount: 312,
            scaleApplied: 1,
            simplified: null,
            nearbyTexts: ['コーンバー'],
        },
        {
            key: '6',
            name: '*U54',
            rawName: '*U54@@SfigorgFlag@@4',
            geometry,
            lengthMm: 390,
            widthMm: 390,
            primitiveCount: 28,
            scaleApplied: 1,
            simplified: { before: 2500, after: 1800 },
            nearbyTexts: [],
        },
    ],
    warnings: ['A: 倍率 0.4 を掛けました'],
};

const jsonRes = (body: unknown, status = 200) =>
    Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response);

let fetchMock: jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    fetchMock = jest.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (url === '/api/road-permits/symbols' && method === 'GET') {
            return jsonRes({ symbols: [symbol(), symbol({ id: 'v1', name: 'エルフ2t平4', category: 'vehicle', countLabel: '', lengthMm: 6295.68, widthMm: 2166.03 })] });
        }
        if (url === '/api/road-permits/symbols/parse') return jsonRes(parseResponse);
        if (url === '/api/road-permits/symbols' && method === 'POST') {
            const body = JSON.parse(String(init?.body));
            return jsonRes(symbol({ ...body, id: 'new1', sortOrder: 1 }), 201);
        }
        if (url.startsWith('/api/road-permits/symbols/') && method === 'PUT') {
            const body = JSON.parse(String(init?.body));
            return jsonRes(symbol({ ...body }));
        }
        return jsonRes({ error: 'not found' }, 404);
    });
    global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(cleanup);

describe('RoadPermitSymbolsModal', () => {
    it('一覧: 名前・分類・数量の数え方・大きさ・出どころが出る', async () => {
        render(<RoadPermitSymbolsModal onClose={jest.fn()} />);
        const rows = await screen.findAllByTestId('symbol-row');
        expect(rows).toHaveLength(2);
        const cone = within(rows[0]);
        expect(cone.getByText('カラーコーン', { selector: 'div' })).toBeTruthy();
        expect(cone.getByText('コーン類')).toBeTruthy();
        expect(cone.getByText('カラーコーン ／個')).toBeTruthy();
        expect(cone.getByText('390×390')).toBeTruthy();
        expect(cone.getByText('出どころ: 配布元')).toBeTruthy();
        const truck = within(rows[1]);
        expect(truck.getByText('車両')).toBeTruthy();
        expect(truck.getByText('数えない')).toBeTruthy();
        expect(truck.getByText('6,296×2,166')).toBeTruthy();
    });

    it('使う／使わない を切り替えると PUT で保存し、road_permit_symbols_updated を送る', async () => {
        const onChanged = jest.fn();
        render(<RoadPermitSymbolsModal onClose={jest.fn()} onChanged={onChanged} />);
        const rows = await screen.findAllByTestId('symbol-row');
        fireEvent.click(within(rows[0]).getByRole('checkbox'));
        await waitFor(() => expect(sendBroadcast).toHaveBeenCalledWith('road_permit_symbols_updated', { id: 's1' }));
        const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
        expect(put[0]).toBe('/api/road-permits/symbols/s1');
        expect(JSON.parse(put[1].body)).toEqual({ isActive: false });
        expect(onChanged).toHaveBeenCalled();
    });

    it('取り込み: ファイルを選ぶ → 候補 → チェック → コーンバーとして使う → 登録（POST）', async () => {
        render(<RoadPermitSymbolsModal onClose={jest.fn()} />);
        await screen.findAllByTestId('symbol-row');
        fireEvent.click(screen.getByRole('tab', { name: 'JWW から取り込む' }));
        expect(screen.getByText(/大きさが図に書かれた寸法と合っているか確かめてください（トラックの幅はミラーのぶん大きく出ます）/)).toBeTruthy();

        const file = new File([new Uint8Array(4)], 'cone.jww');
        fireEvent.change(screen.getByTestId('symbol-file-input'), { target: { files: [file] } });

        const cards = await screen.findAllByTestId('import-block');
        expect(cards).toHaveLength(2);
        expect(screen.getByText('A: 倍率 0.4 を掛けました')).toBeTruthy();
        expect(within(cards[0]).getByText('大きさ 1,500×97')).toBeTruthy();
        expect(within(cards[0]).getByText('線の本数 312')).toBeTruthy();
        expect(within(cards[1]).getByText(/簡略化しました（2,500 → 1,800 本）/)).toBeTruthy();
        const parseCall = fetchMock.mock.calls.find(([url]) => url === '/api/road-permits/symbols/parse');
        expect(parseCall[1].method).toBe('POST');
        expect(parseCall[1].body).toBeInstanceOf(FormData);

        // チェック → 入力欄（名前の初期値＝掃除した名前・出どころは空）
        fireEvent.click(within(cards[0]).getByRole('checkbox', { name: 'コーンバー1500pを登録する' }));
        const card = within(screen.getAllByTestId('import-block')[0]);
        expect((card.getByLabelText('名前（図面・凡例に出る）') as HTMLInputElement).value).toBe('コーンバー1500p');
        expect((card.getByLabelText('出どころ（一覧にだけ出る）') as HTMLInputElement).value).toBe('');
        fireEvent.change(card.getByLabelText('分類'), { target: { value: 'cone' } });
        fireEvent.change(card.getByLabelText('数量の名前（空なら数えない）'), { target: { value: 'コーンバー' } });
        fireEvent.change(card.getByLabelText('単位'), { target: { value: '本' } });

        // コーンバーとして使う → 間隔の初期値 1,403（長さ − 幅）・添え字 1.5m
        fireEvent.click(card.getByLabelText('コーンバーとして使う'));
        expect((card.getByLabelText('コーンの間隔（mm）') as HTMLInputElement).value).toBe('1403');
        expect((card.getByLabelText('添え字（数量の文の括弧）') as HTMLInputElement).value).toBe('1.5m');

        fireEvent.click(card.getByRole('button', { name: '登録' }));
        await waitFor(() => expect(within(screen.getAllByTestId('import-block')[0]).getByText('登録しました')).toBeTruthy());

        const post = fetchMock.mock.calls.find(([url, init]) => url === '/api/road-permits/symbols' && init?.method === 'POST');
        expect(JSON.parse(post[1].body)).toEqual({
            name: 'コーンバー1500p',
            category: 'cone',
            countLabel: 'コーンバー',
            countUnit: '本',
            countNote: '1.5m',
            geometry: parseResponse.blocks[0].geometry,
            lengthMm: 1500,
            widthMm: 97,
            barPitchMm: 1403,
            sourceFile: 'cone.jww',
            sourceBlock: 'コーンバー1500p@@SfigorgFlag@@4',
            sourceNote: '',
        });
        expect(sendBroadcast).toHaveBeenCalledWith('road_permit_symbols_updated', { id: 'new1' });
        // 一覧の数も増える
        expect(screen.getByRole('tab', { name: '一覧（3）' })).toBeTruthy();
    });

    it('一覧が読めなければ断りの文と「読み直す」', async () => {
        fetchMock.mockImplementationOnce(() => jsonRes({ error: '記号の取得に失敗しました' }, 500));
        render(<RoadPermitSymbolsModal onClose={jest.fn()} />);
        expect(await screen.findByText('記号の取得に失敗しました')).toBeTruthy();
        expect(screen.getByRole('button', { name: '読み直す' })).toBeTruthy();
    });
});
