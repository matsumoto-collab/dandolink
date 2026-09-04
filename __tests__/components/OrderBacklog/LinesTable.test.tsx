import React, { useCallback, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LinesTable from '@/components/OrderBacklog/LinesTable';
import { monthColumns } from '@/lib/orderBacklog/render';
import type { OrderBacklogLineInput } from '@/lib/orderBacklog/types';

const line = (over: Partial<OrderBacklogLineInput> = {}): OrderBacklogLineInput => ({
    id: 'l1',
    projectMasterId: 'pm1',
    customerName: '得意先',
    projectName: '工事',
    workKind: 'temp',
    siteKind: 'other',
    contractAmount: 0,
    startYm: null,
    endYm: null,
    progressRate: 0,
    receivedAmount: 0,
    schedule: {},
    excluded: false,
    isManual: false,
    sortOrder: 0,
    ...over,
});

/** page.tsx の changeLine と同じ更新のしかたで、表だけを組み立てる。 */
function Harness({ initial, onLines }: { initial: OrderBacklogLineInput[]; onLines?: (l: OrderBacklogLineInput[]) => void }) {
    const [lines, setLines] = useState(initial);
    const columns = monthColumns('2026-09-04');
    const changeLine = useCallback((index: number, patch: Partial<OrderBacklogLineInput>) => {
        setLines((prev) => {
            const next = prev.slice();
            next[index] = { ...next[index], ...patch };
            onLines?.(next);
            return next;
        });
    }, [onLines]);
    return (
        <LinesTable
            lines={lines}
            columns={columns}
            warningsByProject={{}}
            individualThreshold={1000000}
            unreceivedMode="remaining"
            onChangeLine={changeLine}
            onRemoveLine={() => undefined}
            onReproposeSchedule={() => undefined}
            reproposingIndex={null}
        />
    );
}

describe('LinesTable: 契約額の入力', () => {
    it('契約額 0 の行に金額を打つと行の値が更新され、赤の注意が消える', async () => {
        const user = userEvent.setup();
        const seen: OrderBacklogLineInput[][] = [];
        render(<Harness initial={[line()]} onLines={(l) => seen.push(l)} />);

        expect(screen.getByText('契約額が 0 のため出力に含まれません')).toBeInTheDocument();

        const input = screen.getByLabelText('契約額') as HTMLInputElement;
        await user.click(input);
        await user.keyboard('500000');
        expect(input.value).toBe('500000');
        expect(seen.at(-1)?.[0].contractAmount).toBe(500000);

        await user.tab();
        expect(input.value).toBe('500,000');
        expect(screen.queryByText('契約額が 0 のため出力に含まれません')).not.toBeInTheDocument();
        // 100万未満なので集約先の区分が案内される
        expect(screen.getByText('→ その他仮設工事（50万～100万の工事）')).toBeInTheDocument();
    });

    it('日本語入力がオンのまま全角で打っても金額として受け付ける（実機で「入力しても 0 に戻る」原因）', async () => {
        const user = userEvent.setup();
        const seen: OrderBacklogLineInput[][] = [];
        render(<Harness initial={[line()]} onLines={(l) => seen.push(l)} />);
        const input = screen.getByLabelText('契約額') as HTMLInputElement;
        await user.click(input);
        await user.keyboard('５００，０００');
        expect(seen.at(-1)?.[0].contractAmount).toBe(500000);
        await user.tab();
        expect(input.value).toBe('500,000');
    });

    it('3桁区切りの表示中に続けて打っても桁が崩れない', async () => {
        const user = userEvent.setup();
        render(<Harness initial={[line({ contractAmount: 1200000 })]} />);
        const input = screen.getByLabelText('契約額') as HTMLInputElement;
        expect(input.value).toBe('1,200,000');
        await user.click(input);
        await user.keyboard('{End}5');
        expect(input.value).toBe('1,200,0005');
        await user.tab();
        expect(input.value).toBe('12,000,005');
    });
});
