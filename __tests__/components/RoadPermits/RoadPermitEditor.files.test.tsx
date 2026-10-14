/**
 * 道路申請の編集画面「添付・提出」タブの「許可書（スキャン）」（docs/指示書_道路申請_許可書を見ての修正.md §4）。
 *
 * いちばん守りたい約束:
 *   A. 様式ごとに付けたファイルの一覧が出て、名前のリンクは /api/road-permits/<id>/files/<fileId>（新しいタブ）
 *   B. 付ける → formId と file を入れて POST。戻った申請の一覧が出る。入力中の値は消えず「保存していない変更」にもならない
 *   C. 状態が「提出済み」なら「許可済みにしますか？」と聞く（はい＝許可済み・いいえ＝そのまま）
 *   D. 413 は「4.5MB まで」の文言
 *   E. 消す → 確認 → DELETE
 *
 * PDF プレビュー・図面タブ（konva）は読み込まない。本物の API にはつながない（fetch を差し替える）。
 */
import React from 'react';
import { render, screen, within, fireEvent, cleanup, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';
import RoadPermitEditor from '@/components/RoadPermits/RoadPermitEditor';
import { buildDefaultRoadPermitDocuments, buildDefaultRoadPermitValues } from '@/lib/roadPermit/defaults';
import type { RoadPermitDocuments, RoadPermitDto, RoadPermitPermitFile, RoadPermitStatus } from '@/types/roadPermit';

// ---------------------------------------------------------------- モック

jest.mock('react-hot-toast', () => {
    const t = Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() });
    return { __esModule: true, default: t };
});
jest.mock('@/lib/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));
jest.mock('@/lib/broadcastChannel', () => ({ initBroadcastChannel: jest.fn(), sendBroadcast: jest.fn(), onBroadcast: jest.fn(() => () => {}) }));
// 図面タブ（konva）は読み込まない
jest.mock('next/dynamic', () => ({
    __esModule: true,
    default: () => {
        const Dummy = () => null;
        return Dummy;
    },
}));
// PDF プレビューは描かない
jest.mock('@/components/ui/LivePdfPreview', () => ({ LivePdfPreview: () => null }));
jest.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }));

// ---------------------------------------------------------------- 材料

const POLICE = '道路使用許可申請書';

const fileOf = (over: Partial<RoadPermitPermitFile> = {}): RoadPermitPermitFile => ({
    id: 'f1',
    fileName: '許可証のスキャン.pdf',
    storagePath: 'road-permits/rp1/f1.pdf',
    mimeType: 'application/pdf',
    size: 2.5 * 1024 * 1024,
    uploadedAt: '2026-10-14T01:00:00.000Z',
    uploadedBy: 'u1',
    uploadedByName: '担当A',
    ...over,
});

function docsWith(policeFiles: RoadPermitPermitFile[]): RoadPermitDocuments {
    const d = buildDefaultRoadPermitDocuments();
    d.forms = d.forms.map((f) => (f.formId === 'police-road-use' ? { ...f, permitFiles: policeFiles } : f));
    return d;
}

function permitWith(status: RoadPermitStatus, policeFiles: RoadPermitPermitFile[] = []): RoadPermitDto {
    return {
        id: 'rp1',
        projectMasterId: 'pm1',
        projectTitle: '案件',
        title: '申請',
        status,
        values: buildDefaultRoadPermitValues({ company: null, project: null, previous: null }),
        documents: docsWith(policeFiles),
        drawing: null,
        createdBy: 'u1',
        updatedBy: 'u1',
        createdAt: '2026-10-13T00:00:00.000Z',
        updatedAt: '2026-10-13T00:00:00.000Z',
    };
}

const jsonRes = (status: number, body: unknown) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

/** fetch の差し替え。記号の一覧は空、許可書の API は handler に任せる */
function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
    const fn = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith('/api/road-permits/symbols')) return jsonRes(200, { symbols: [] });
        return handler(url, init);
    });
    global.fetch = fn as unknown as typeof fetch;
    return fn;
}

function renderEditor(permit: RoadPermitDto) {
    const onClose = jest.fn();
    render(<RoadPermitEditor permit={permit} company={null} contacts={[]} onClose={onClose} onSaved={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '添付・提出' }));
    return { onClose };
}

/** 様式の区画（見出し h3 の文字から） */
function sectionOf(title: string): HTMLElement {
    const h = screen.getByText(title, { selector: 'h3' });
    const section = h.closest('section');
    if (!section) throw new Error(`section not found: ${title}`);
    return section;
}

const pickFiles = (files: File[]) => {
    const input = screen.getByTestId('permit-file-input-police-road-use') as HTMLInputElement;
    fireEvent.change(input, { target: { files } });
};

const statusSelect = () => screen.getAllByRole('combobox').find((el) => el.closest('label')?.textContent?.includes('状態')) as HTMLSelectElement;

const originalFetch = global.fetch;
let confirmSpy: jest.SpyInstance;

beforeEach(() => {
    jest.clearAllMocks();
    confirmSpy = jest.spyOn(window, 'confirm');
});
afterEach(() => {
    cleanup();
    confirmSpy.mockRestore();
    global.fetch = originalFetch;
});

// ---------------------------------------------------------------- A. 一覧

describe('一覧', () => {
    it('付けたファイルが出る（名前のリンクは新しいタブで開く・大きさ・付けた人）。無い様式は「まだありません」', () => {
        mockFetch(() => jsonRes(500, {}));
        renderEditor(permitWith('draft', [fileOf()]));
        const section = sectionOf(POLICE);
        const link = within(section).getByRole('link', { name: '許可証のスキャン.pdf' });
        expect(link).toHaveAttribute('href', '/api/road-permits/rp1/files/f1');
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        expect(within(section).getByText('2.5 MB')).toBeInTheDocument();
        expect(within(section).getByText('担当A')).toBeInTheDocument();
        expect(within(sectionOf('道路占用 許可申請書／協議書')).getByText('まだありません')).toBeInTheDocument();
    });
});

// ---------------------------------------------------------------- B・C. 付ける

describe('付ける', () => {
    it('formId と file を入れて POST し、戻った一覧が出る。「提出済み」なら聞いて、はい＝「許可済み」', async () => {
        const added = fileOf({ id: 'f2', fileName: '新しい許可証.pdf', size: 3000 });
        const fetchFn = mockFetch((url, init) => {
            if (url === '/api/road-permits/rp1/files' && init?.method === 'POST') {
                return jsonRes(201, { ...permitWith('submitted'), documents: docsWith([added]) });
            }
            return jsonRes(500, {});
        });
        confirmSpy.mockReturnValue(true);
        renderEditor(permitWith('submitted'));

        pickFiles([new File(['%PDF'], '新しい許可証.pdf', { type: 'application/pdf' })]);

        await waitFor(() => expect(within(sectionOf(POLICE)).getByRole('link', { name: '新しい許可証.pdf' })).toBeInTheDocument());
        const call = fetchFn.mock.calls.find(([u, i]) => String(u) === '/api/road-permits/rp1/files' && i?.method === 'POST')!;
        const body = call[1]!.body as FormData;
        expect(body.get('formId')).toBe('police-road-use');
        expect((body.get('file') as File).name).toBe('新しい許可証.pdf');

        expect(confirmSpy).toHaveBeenCalledWith('許可書を付けました。状態を「許可済み」にしますか？');
        await waitFor(() => expect(statusSelect().value).toBe('permitted'));
    });

    it('「いいえ」なら状態はそのまま。入力中の値は消えず、「保存していない変更」にもならない', async () => {
        const added = fileOf({ id: 'f2', fileName: '新しい許可証.pdf' });
        mockFetch((url, init) =>
            url === '/api/road-permits/rp1/files' && init?.method === 'POST'
                ? jsonRes(201, { ...permitWith('submitted'), documents: docsWith([added]) })
                : jsonRes(500, {}),
        );
        confirmSpy.mockReturnValue(false);
        const { onClose } = renderEditor(permitWith('submitted'));

        pickFiles([new File(['%PDF'], '新しい許可証.pdf', { type: 'application/pdf' })]);
        await waitFor(() => expect(within(sectionOf(POLICE)).getByRole('link', { name: '新しい許可証.pdf' })).toBeInTheDocument());
        expect(statusSelect().value).toBe('submitted');

        // 直しかけでなければ、閉じるときに確認を出さずに閉じる
        confirmSpy.mockClear();
        fireEvent.click(screen.getAllByRole('button', { name: '閉じる' })[0]);
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    it('「下書き」なら聞かない', async () => {
        mockFetch(() => jsonRes(201, { ...permitWith('draft'), documents: docsWith([fileOf({ id: 'f2' })]) }));
        renderEditor(permitWith('draft'));
        pickFiles([new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })]);
        await waitFor(() => expect(toast.success).toHaveBeenCalled());
        expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('413 は「4.5MB まで」の文言を出して止める', async () => {
        const fetchFn = mockFetch(() => jsonRes(413, {}));
        renderEditor(permitWith('submitted'));
        pickFiles([
            new File(['x'], 'big1.pdf', { type: 'application/pdf' }),
            new File(['x'], 'big2.pdf', { type: 'application/pdf' }),
        ]);
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('ファイルが大きすぎて送れませんでした（4.5MB まで）'));
        // 1 つ目で止める（2 つ目は送らない）・状態は聞かない
        expect(fetchFn.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(1);
        expect(confirmSpy).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------- E. 消す

describe('消す', () => {
    it('確認して DELETE し、戻った一覧にする', async () => {
        const fetchFn = mockFetch((url, init) =>
            url === '/api/road-permits/rp1/files/f1' && init?.method === 'DELETE'
                ? jsonRes(200, { ...permitWith('draft'), documents: docsWith([]) })
                : jsonRes(500, {}),
        );
        confirmSpy.mockReturnValue(true);
        renderEditor(permitWith('draft', [fileOf()]));

        fireEvent.click(within(sectionOf(POLICE)).getByRole('button', { name: '消す' }));
        expect(confirmSpy).toHaveBeenCalledWith('「許可証のスキャン.pdf」を消します。よろしいですか？');
        await waitFor(() => expect(within(sectionOf(POLICE)).queryByRole('link', { name: '許可証のスキャン.pdf' })).toBeNull());
        expect(fetchFn.mock.calls.some(([u, i]) => String(u) === '/api/road-permits/rp1/files/f1' && i?.method === 'DELETE')).toBe(true);
    });

    it('確認で「いいえ」なら消さない', () => {
        const fetchFn = mockFetch(() => jsonRes(500, {}));
        confirmSpy.mockReturnValue(false);
        renderEditor(permitWith('draft', [fileOf()]));
        fireEvent.click(within(sectionOf(POLICE)).getByRole('button', { name: '消す' }));
        expect(fetchFn.mock.calls.some(([, i]) => i?.method === 'DELETE')).toBe(false);
    });
});
