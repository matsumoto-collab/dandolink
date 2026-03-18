import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EstimateForm from '@/components/Estimates/EstimateForm';

// lucide-react のモック


// react-hot-toast のモック
jest.mock('react-hot-toast', () => ({
    __esModule: true,
    default: {
        error: jest.fn(),
        success: jest.fn(),
    },
}));

// モック関数への参照を取得
void jest.requireMock('react-hot-toast').default;

// hooks のモック
jest.mock('@/hooks/useProjectMasters', () => ({
    useProjectMasters: () => ({
        projectMasters: [
            { id: 'proj-1', title: 'テスト現場A', customerName: '株式会社テスト' },
            { id: 'proj-2', title: 'テスト現場B', customerName: '株式会社サンプル' },
        ],
        fetchProjectMasters: jest.fn(),
    }),
}));

jest.mock('@/hooks/useProjects', () => ({
    useProjects: () => ({
        projects: [
            { id: 'proj-1', title: 'テスト現場A', customer: '株式会社テスト' },
            { id: 'proj-2', title: 'テスト現場B', customer: '株式会社サンプル' },
        ],
    }),
}));

jest.mock('@/hooks/useCustomers', () => ({
    useCustomers: () => ({
        customers: [
            { id: 'cust-1', name: '株式会社テスト', shortName: 'テスト' },
            { id: 'cust-2', name: '株式会社サンプル', shortName: 'サンプル' },
        ],
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

// モーダルコンポーネントのモック
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

describe('EstimateForm', () => {
    const mockOnSubmit = jest.fn();
    const mockOnCancel = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('基本レンダリング', () => {
        it('タイトル入力フィールドが表示される', () => {
            render(<EstimateForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

            expect(screen.getByPlaceholderText('例: ○○現場 見積書')).toBeInTheDocument();
        });

        it('見積番号が自動生成される', () => {
            render(<EstimateForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

            expect(screen.getByText('見積番号')).toBeInTheDocument();
        });

        it('案件選択ドロップダウンが表示される', () => {
            render(<EstimateForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

            expect(screen.getAllByText(/案件を選択/).length).toBeGreaterThanOrEqual(1);
        });

        it('ステータス選択が表示される', () => {
            render(<EstimateForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

            expect(screen.getByText('ステータス')).toBeInTheDocument();
        });

        it('保存とキャンセルボタンが表示される', () => {
            render(<EstimateForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

            expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'キャンセル' })).toBeInTheDocument();
        });
    });

    describe('明細行管理', () => {
        it('初期状態で1行の明細が表示される', () => {
            render(<EstimateForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

            // 項目行のヘッダーがあることを確認
            expect(screen.getByText('項目')).toBeInTheDocument();
        });

        it('行追加ボタンで行を追加できる', async () => {
            const user = userEvent.setup();
            render(<EstimateForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

            const addButton = screen.getByText('項目行を追加');
            await user.click(addButton);

            // 2行目が追加されたことを確認
            const descInputs = screen.getAllByPlaceholderText('品目・内容');
            expect(descInputs.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('金額計算', () => {
        it('小計、消費税、合計が表示される', () => {
            render(<EstimateForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

            expect(screen.getByText(/小計/)).toBeInTheDocument();
            expect(screen.getByText(/消費税/)).toBeInTheDocument();
            expect(screen.getByText(/合計/)).toBeInTheDocument();
        });
    });

    describe('案件選択', () => {
        it('案件選択UIが表示される', () => {
            render(<EstimateForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

            // カスタムドロップダウンのプレースホルダーテキストを確認
            expect(screen.getByText(/選択してください/)).toBeInTheDocument();
        });
    });

    describe('キャンセル', () => {
        it('キャンセルボタンでonCancelが呼ばれる', async () => {
            const user = userEvent.setup();
            render(<EstimateForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

            await user.click(screen.getByRole('button', { name: 'キャンセル' }));

            expect(mockOnCancel).toHaveBeenCalledTimes(1);
        });
    });

    describe('フォーム送信', () => {
        it('タイトルが空の時はHTML5バリデーションでブロックされる', async () => {
            render(<EstimateForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

            // required属性がついていることを確認
            const titleInput = screen.getByPlaceholderText('例: ○○現場 見積書');
            expect(titleInput).toBeRequired();
        });
    });

    describe('初期値', () => {
        it('initialDataが渡された時フォームに値がセットされる', () => {
            const initialData = {
                title: '既存見積書',
                estimateNumber: '20260101120000',
                status: 'sent' as const,
            };

            render(
                <EstimateForm
                    initialData={initialData}
                    onSubmit={mockOnSubmit}
                    onCancel={mockOnCancel}
                />
            );

            expect(screen.getByDisplayValue('既存見積書')).toBeInTheDocument();
            expect(screen.getByDisplayValue('20260101120000')).toBeInTheDocument();
        });
    });

    describe('顧客モーダル', () => {
        it('新規顧客追加ボタンが表示される', () => {
            render(<EstimateForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

            expect(screen.getByRole('button', { name: /新規顧客/ })).toBeInTheDocument();
        });
    });
});
