import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EstimateForm from '@/components/Estimates/EstimateForm';

// lucide-react のモック


jest.mock('react-hot-toast', () => ({
    __esModule: true,
    default: {
        error: jest.fn(),
        success: jest.fn(),
    },
}));

jest.mock('@/hooks/useProjects', () => ({
    useProjects: () => ({
        projects: [],
    }),
}));

jest.mock('@/hooks/useProjectMasters', () => ({
    useProjectMasters: () => ({
        projectMasters: [],
        fetchProjectMasters: jest.fn(),
    }),
}));

jest.mock('@/hooks/useCustomers', () => ({
    useCustomers: () => ({
        customers: [],
        addCustomer: jest.fn(),
        ensureDataLoaded: jest.fn(),
    }),
}));

jest.mock('@/hooks/useUnitPriceMaster', () => ({
    useUnitPriceMaster: () => ({
        unitPrices: [],
        unitPriceSpecifications: [],
        ensureDataLoaded: jest.fn(),
    }),
}));

jest.mock('@/components/Customers/CustomerModal', () => ({
    __esModule: true,
    default: ({ isOpen }: { isOpen: boolean }) =>
        isOpen ? <div data-testid="customer-modal">Customer Modal</div> : null,
}));

jest.mock('@/components/Estimates/UnitPriceMasterModal', () => ({
    __esModule: true,
    default: ({ isOpen }: { isOpen: boolean }) =>
        isOpen ? <div data-testid="unit-price-modal">Unit Price Modal</div> : null,
}));

// 合計エリアのコンテナを取得するヘルパー
function getSummarySection() {
    const subtotalLabel = screen.getByText('小計');
    // The summary footer parent contains 小計, 消費税, 合計
    return subtotalLabel.closest('[class*="grid"]')?.parentElement as HTMLElement;
}

describe('EstimateForm 金額計算', () => {
    const mockOnSubmit = jest.fn();
    const mockOnCancel = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    async function enterItemValues(quantity: string, unitPrice: string) {
        const user = userEvent.setup();
        render(<EstimateForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

        // デフォルト行が無いので項目行を追加
        await user.click(screen.getByText('項目行を追加'));

        // Quantity input has placeholder="数量", unit price has placeholder="単価"
        const quantityInput = screen.getAllByPlaceholderText('数量')[0];
        const unitPriceInput = screen.getAllByPlaceholderText('単価')[0];

        await user.clear(quantityInput);
        await user.type(quantityInput, quantity);
        await user.clear(unitPriceInput);
        await user.type(unitPriceInput, unitPrice);

        return { user };
    }

    it('整数 × 整数 = 正しい金額 (2 × 500 = 1,000)', async () => {
        await enterItemValues('2', '500');

        // 明細行と小計の両方に ¥1,000 が表示される
        const matches = screen.getAllByText('¥1,000');
        expect(matches.length).toBeGreaterThanOrEqual(1);

        // 合計セクション
        const summary = getSummarySection();
        expect(within(summary).getByText('¥1,000')).toBeInTheDocument();
    });

    it('小数 × 整数 = 丸められた金額 (0.1 × 100 = 10)', async () => {
        await enterItemValues('0.1', '100');

        const matches = screen.getAllByText('¥10');
        expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it('浮動小数点精度の問題が発生しない (0.3 × 100 = 30)', async () => {
        await enterItemValues('0.3', '100');

        // 0.3 * 100 = 30.000000000000004 をMath.roundで30に丸める
        const matches = screen.getAllByText('¥30');
        expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it('消費税が正しく計算される (小計1000 → 税100 → 合計1100)', async () => {
        await enterItemValues('1', '1000');

        const summary = getSummarySection();
        // 消費税: ¥100
        expect(within(summary).getByText('¥100')).toBeInTheDocument();
        // 合計: ¥1,100
        expect(within(summary).getByText('¥1,100')).toBeInTheDocument();
    });

    it('消費税の端数が切り捨てされる (小計333 → 税33 → 合計366)', async () => {
        await enterItemValues('1', '333');

        const summary = getSummarySection();
        // 消費税: Math.floor(333 * 0.1) = Math.floor(33.3) = 33
        expect(within(summary).getByText('¥33')).toBeInTheDocument();
        // 合計: 333 + 33 = 366
        expect(within(summary).getByText('¥366')).toBeInTheDocument();
    });
});
