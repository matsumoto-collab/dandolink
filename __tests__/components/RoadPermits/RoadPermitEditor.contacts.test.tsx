/**
 * 道路申請の編集画面「基本」タブの 担当者・現場責任者 の「選ぶ」欄（docs/指示書_道路申請_担当者の選択と住所.md §3.3）。
 *
 * いちばん守りたい約束:
 *   A. 候補が 0 件なら「選ぶ」欄を出さない（今までの画面のまま）
 *   B. 候補を選ぶと氏名・電話が入る。手で直すと「自由入力」の表示になる。「自由入力」を選ぶと氏名・電話が空になる
 *   C. 現場責任者の「担当者と同じ」はそのとき写すだけ（あとで担当者を変えても追いかけない）。住所は触らない
 *   D. 既にある申請（候補と合わない値）を開いても、値が勝手に変わらない
 *
 * PDF プレビュー・図面タブ（konva）は読み込まない。本物の API にはつながない（保存はしない）。
 */
import React from 'react';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import RoadPermitEditor from '@/components/RoadPermits/RoadPermitEditor';
import { buildDefaultRoadPermitDocuments, buildDefaultRoadPermitValues } from '@/lib/roadPermit/defaults';
import type { RoadPermitContactPreset, RoadPermitDto } from '@/types/roadPermit';

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

const contacts: RoadPermitContactPreset[] = [
    { name: '今井　公一郎', phone: '089-000-0000' },
    { name: '三生　浩人', phone: '090-1111-2222' },
];

function permitWith(values: Partial<RoadPermitDto['values']> = {}): RoadPermitDto {
    const base = buildDefaultRoadPermitValues({ company: null, project: null, previous: null });
    return {
        id: 'rp1',
        projectMasterId: 'pm1',
        projectTitle: '北井門様邸 足場工事',
        title: '北井門様邸 足場工事',
        status: 'draft',
        values: { ...base, ...values },
        documents: buildDefaultRoadPermitDocuments(),
        drawing: null,
        createdBy: 'u1',
        updatedBy: 'u1',
        createdAt: '2026-10-13T00:00:00.000Z',
        updatedAt: '2026-10-13T00:00:00.000Z',
    };
}

function renderEditor(permit: RoadPermitDto, presets: RoadPermitContactPreset[]) {
    return render(<RoadPermitEditor permit={permit} company={null} contacts={presets} onClose={jest.fn()} onSaved={jest.fn()} />);
}

/** 見出しの文字から、その区画（section）を取る */
function sectionOf(title: string): HTMLElement {
    const h = screen.getByText(title, { selector: 'h3' });
    const section = h.closest('section');
    if (!section) throw new Error(`section not found: ${title}`);
    return section;
}

const contactSection = () => sectionOf('担当者');
const managerSection = () => sectionOf('現場責任者（警察）');
const selectIn = (section: HTMLElement) => within(section).getByRole('combobox') as HTMLSelectElement;
const inputIn = (section: HTMLElement, label: string) => within(section).getByLabelText(label) as HTMLInputElement;
const optionLabels = (select: HTMLSelectElement) => Array.from(select.options).map((o) => o.text);
const selectedLabel = (select: HTMLSelectElement) => select.options[select.selectedIndex]?.text;

afterEach(() => cleanup());

// ---------------------------------------------------------------- A. 候補が 0 件

describe('候補が 0 件', () => {
    it('担当者・現場責任者とも「選ぶ」欄を出さない（今までの画面のまま）', () => {
        renderEditor(permitWith(), []);
        expect(within(contactSection()).queryByRole('combobox')).toBeNull();
        expect(within(managerSection()).queryByRole('combobox')).toBeNull();
        expect(inputIn(contactSection(), '氏名')).toBeInTheDocument();
        expect(inputIn(managerSection(), '住所')).toBeInTheDocument();
    });
});

// ---------------------------------------------------------------- B. 担当者

describe('担当者の「選ぶ」欄', () => {
    it('中身は 候補の名前（登録順）＋「自由入力」。値が空なら「自由入力」の表示', () => {
        renderEditor(permitWith(), contacts);
        const select = selectIn(contactSection());
        expect(optionLabels(select)).toEqual(['今井　公一郎', '三生　浩人', '自由入力']);
        expect(selectedLabel(select)).toBe('自由入力');
    });

    it('候補を選ぶと氏名・連絡先に入り、表示もその候補になる', () => {
        renderEditor(permitWith(), contacts);
        const section = contactSection();
        fireEvent.change(selectIn(section), { target: { value: '1' } });
        expect(inputIn(section, '氏名').value).toBe('三生　浩人');
        expect(inputIn(section, '連絡先').value).toBe('090-1111-2222');
        expect(selectedLabel(selectIn(section))).toBe('三生　浩人');
    });

    it('入ったあと手で直すと「自由入力」の表示になる。候補と同じ値に戻せばまた候補の表示', () => {
        renderEditor(permitWith(), contacts);
        const section = contactSection();
        fireEvent.change(selectIn(section), { target: { value: '0' } });
        fireEvent.change(inputIn(section, '連絡先'), { target: { value: '089-999-9999' } });
        expect(selectedLabel(selectIn(section))).toBe('自由入力');
        // 氏名はそのまま残っている（手で直した分だけ変わる）
        expect(inputIn(section, '氏名').value).toBe('今井　公一郎');
        fireEvent.change(inputIn(section, '連絡先'), { target: { value: '089-000-0000' } });
        expect(selectedLabel(selectIn(section))).toBe('今井　公一郎');
    });

    it('「自由入力」を選ぶと氏名・連絡先が空になり、手で入れられる', () => {
        renderEditor(permitWith(), contacts);
        const section = contactSection();
        fireEvent.change(selectIn(section), { target: { value: '0' } });
        fireEvent.change(selectIn(section), { target: { value: 'free' } });
        expect(inputIn(section, '氏名').value).toBe('');
        expect(inputIn(section, '連絡先').value).toBe('');
        expect(selectedLabel(selectIn(section))).toBe('自由入力');
        fireEvent.change(inputIn(section, '氏名'), { target: { value: '別の人' } });
        fireEvent.change(inputIn(section, '連絡先'), { target: { value: '080-0000-0000' } });
        expect(selectedLabel(selectIn(section))).toBe('自由入力');
        expect(inputIn(section, '氏名').value).toBe('別の人');
    });
});

// ---------------------------------------------------------------- C. 現場責任者

describe('現場責任者の「選ぶ」欄', () => {
    it('中身は「担当者と同じ」＋候補の名前＋「自由入力」。担当者が空なら「担当者と同じ」は選べない', () => {
        renderEditor(permitWith(), contacts);
        const select = selectIn(managerSection());
        expect(optionLabels(select)).toEqual(['担当者と同じ（担当者が空です）', '今井　公一郎', '三生　浩人', '自由入力']);
        expect(select.options[0].disabled).toBe(true);
    });

    it('「担当者と同じ」は担当者の氏名・連絡先をそのとき写す。住所は触らない。あとで担当者を変えても追いかけない', () => {
        renderEditor(permitWith({ siteManager: { address: '愛媛県伊予市上三谷甲3517番地', name: '', phone: '' } }), contacts);
        // 担当者を手で入れる（候補ではない人）
        fireEvent.change(inputIn(contactSection(), '氏名'), { target: { value: '手入力　太郎' } });
        fireEvent.change(inputIn(contactSection(), '連絡先'), { target: { value: '070-0000-0000' } });

        const section = managerSection();
        expect(optionLabels(selectIn(section))[0]).toBe('担当者と同じ');
        fireEvent.change(selectIn(section), { target: { value: 'same' } });
        expect(inputIn(section, '氏名').value).toBe('手入力　太郎');
        expect(inputIn(section, '電話').value).toBe('070-0000-0000');
        expect(inputIn(section, '住所').value).toBe('愛媛県伊予市上三谷甲3517番地');
        expect(selectedLabel(selectIn(section))).toBe('担当者と同じ');

        // 担当者を変えても現場責任者は変わらない（表示は「自由入力」に変わる）
        fireEvent.change(inputIn(contactSection(), '氏名'), { target: { value: '手入力　次郎' } });
        expect(inputIn(section, '氏名').value).toBe('手入力　太郎');
        expect(selectedLabel(selectIn(section))).toBe('自由入力');
    });

    it('候補を選ぶと氏名・電話が入る。住所はそのまま', () => {
        renderEditor(permitWith({ siteManager: { address: '愛媛県伊予市上三谷甲3517番地', name: '', phone: '' } }), contacts);
        const section = managerSection();
        fireEvent.change(selectIn(section), { target: { value: '0' } });
        expect(inputIn(section, '氏名').value).toBe('今井　公一郎');
        expect(inputIn(section, '電話').value).toBe('089-000-0000');
        expect(inputIn(section, '住所').value).toBe('愛媛県伊予市上三谷甲3517番地');
        expect(selectedLabel(selectIn(section))).toBe('今井　公一郎');
    });

    it('「自由入力」を選ぶと氏名・電話だけ空になり、住所は残る', () => {
        renderEditor(
            permitWith({ siteManager: { address: '愛媛県伊予市上三谷甲3517番地', name: '今井　公一郎', phone: '089-000-0000' } }),
            contacts,
        );
        const section = managerSection();
        expect(selectedLabel(selectIn(section))).toBe('今井　公一郎');
        fireEvent.change(selectIn(section), { target: { value: 'free' } });
        expect(inputIn(section, '氏名').value).toBe('');
        expect(inputIn(section, '電話').value).toBe('');
        expect(inputIn(section, '住所').value).toBe('愛媛県伊予市上三谷甲3517番地');
    });
});

// ---------------------------------------------------------------- D. 既にある申請

describe('既にある申請を開く', () => {
    it('候補と合わない値はそのまま（勝手に変えない）。表示は「自由入力」', () => {
        renderEditor(
            permitWith({
                contact: { name: '昔の担当', phone: '090-9999-9999' },
                siteManager: { address: '松山市東町3-3', name: '昔の責任者', phone: '090-8888-8888' },
            }),
            contacts,
        );
        expect(inputIn(contactSection(), '氏名').value).toBe('昔の担当');
        expect(inputIn(contactSection(), '連絡先').value).toBe('090-9999-9999');
        expect(selectedLabel(selectIn(contactSection()))).toBe('自由入力');
        expect(inputIn(managerSection(), '氏名').value).toBe('昔の責任者');
        expect(inputIn(managerSection(), '住所').value).toBe('松山市東町3-3');
        expect(selectedLabel(selectIn(managerSection()))).toBe('自由入力');
        // 「保存していない変更があります」は出ていない（開いただけで直しかけにならない）
        expect(screen.queryByText('保存していない変更があります')).toBeNull();
    });

    it('候補と同じ値なら、その候補が選ばれた表示になる', () => {
        renderEditor(
            permitWith({
                contact: { name: '今井　公一郎', phone: '089-000-0000' },
                siteManager: { address: '愛媛県伊予市上三谷甲3517番地', name: '三生　浩人', phone: '090-1111-2222' },
            }),
            contacts,
        );
        expect(selectedLabel(selectIn(contactSection()))).toBe('今井　公一郎');
        expect(selectedLabel(selectIn(managerSection()))).toBe('三生　浩人');
        expect(screen.queryByText('保存していない変更があります')).toBeNull();
    });
});
