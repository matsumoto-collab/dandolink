import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import InvoiceHeader from '@/components/Invoices/InvoiceHeader';
import type { BillingStatus } from '@/lib/billing/billingStatus';

/**
 * 案件チェックリストの請求ステータス絞り込み（未請求／一部請求／請求済）。
 * 判定そのものは lib/billing/billingStatus のテストに任せ、ここは渡された
 * billingStatus でバッジと絞り込みが正しく動くかだけを見る。
 */
const customers = [{ id: 'c1', name: 'A建設' }, { id: 'c2', name: 'B工務店' }];

const projects: Array<{ id: string; title: string; billingStatus: BillingStatus }> = [
    { id: 'p1', title: '案件アルファ', billingStatus: 'unbilled' },
    { id: 'p2', title: '案件ブラボー', billingStatus: 'partial' },
    { id: 'p3', title: '案件チャーリー', billingStatus: 'full' },
];

function renderHeader(overrides: Record<string, unknown> = {}) {
    const props = {
        customerId: 'c1',
        setCustomerId: jest.fn(),
        invoiceNumber: 'INV-1',
        setInvoiceNumber: jest.fn(),
        title: '請求書',
        setTitle: jest.fn(),
        dueDate: '2026-10-31',
        setDueDate: jest.fn(),
        issueDate: '2026-09-30',
        setIssueDate: jest.fn(),
        status: 'draft',
        setStatus: jest.fn(),
        paidDate: '',
        setPaidDate: jest.fn(),
        customers: customers as never,
        onOpenCustomerModal: jest.fn(),
        selectedProjectIds: [] as string[],
        onToggleProject: jest.fn(),
        customerProjects: projects,
        ...overrides,
    };
    return render(<InvoiceHeader {...props} />);
}

/** 表示されている案件名（チェックボックス付きカード）の一覧 */
function visibleProjectTitles(): string[] {
    return projects.filter(p => screen.queryByText(p.title)).map(p => p.title);
}

describe('InvoiceHeader 案件の請求ステータス絞り込み', () => {
    it('案件ごとに請求ステータスのバッジを表示する', () => {
        renderHeader();
        const card = screen.getByText('案件チャーリー').closest('label');
        expect(card).not.toBeNull();
        expect(card!.textContent).toContain('請求済');

        const partialCard = screen.getByText('案件ブラボー').closest('label');
        expect(partialCard!.textContent).toContain('一部請求');
    });

    it('絞り込みボタンに件数が出る', () => {
        renderHeader();
        expect(screen.getByRole('button', { name: /すべて\s*3/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /未請求\s*1/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /一部請求\s*1/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /請求済\s*1/ })).toBeInTheDocument();
    });

    it('「請求済」を押すと請求済の案件だけになる', () => {
        renderHeader();
        fireEvent.click(screen.getByRole('button', { name: /^請求済/ }));
        expect(visibleProjectTitles()).toEqual(['案件チャーリー']);
    });

    it('絞り込み中でも選択済みの案件は残す（チェックを外せなくなるのを防ぐ）', () => {
        renderHeader({ selectedProjectIds: ['p1'] });
        fireEvent.click(screen.getByRole('button', { name: /^請求済/ }));
        expect(visibleProjectTitles()).toEqual(['案件アルファ', '案件チャーリー']);
    });

    it('請求先を切り替えたら絞り込みは解除される', () => {
        const { rerender } = renderHeader();
        fireEvent.click(screen.getByRole('button', { name: /^請求済/ }));
        expect(visibleProjectTitles()).toEqual(['案件チャーリー']);

        rerender(
            <InvoiceHeader
                customerId="c2"
                setCustomerId={jest.fn()}
                invoiceNumber="INV-1"
                setInvoiceNumber={jest.fn()}
                title="請求書"
                setTitle={jest.fn()}
                dueDate="2026-10-31"
                setDueDate={jest.fn()}
                issueDate="2026-09-30"
                setIssueDate={jest.fn()}
                status="draft"
                setStatus={jest.fn()}
                paidDate=""
                setPaidDate={jest.fn()}
                customers={customers as never}
                onOpenCustomerModal={jest.fn()}
                selectedProjectIds={[]}
                onToggleProject={jest.fn()}
                customerProjects={projects}
            />,
        );
        expect(visibleProjectTitles()).toEqual(['案件アルファ', '案件ブラボー', '案件チャーリー']);
    });

    it('「契約未設定」は該当がある場合だけボタンを出す', () => {
        renderHeader();
        expect(screen.queryByRole('button', { name: /契約未設定/ })).not.toBeInTheDocument();

        renderHeader({
            customerProjects: [...projects, { id: 'p4', title: '案件デルタ', billingStatus: 'none' as BillingStatus }],
        });
        expect(screen.getAllByRole('button', { name: /契約未設定\s*1/ }).length).toBeGreaterThan(0);
    });
});
