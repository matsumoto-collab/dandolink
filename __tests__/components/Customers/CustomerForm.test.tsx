import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CustomerForm from '@/components/Customers/CustomerForm';

// lucide-react のモック
jest.mock('lucide-react', () => ({
    Plus: () => <svg data-testid="plus-icon" />,
    Trash2: () => <svg data-testid="trash-icon" />,
}));

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

describe('CustomerForm', () => {
    const mockOnSubmit = jest.fn();
    const mockOnCancel = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('基本レンダリング', () => {
        it('必須フィールドが表示される', () => {
            render(<CustomerForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

            expect(screen.getByText(/会社名/)).toBeInTheDocument();
            expect(screen.getByPlaceholderText('例: ○○建設株式会社')).toBeInTheDocument();
        });

        it('オプションフィールドが表示される', () => {
            render(<CustomerForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

            expect(screen.getByPlaceholderText('例: ○○建設')).toBeInTheDocument();
            expect(screen.getByPlaceholderText('例: info@example.com')).toBeInTheDocument();
            expect(screen.getByPlaceholderText('例: 03-1234-5678')).toBeInTheDocument();
        });

        it('保存とキャンセルボタンが表示される', () => {
            render(<CustomerForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

            expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'キャンセル' })).toBeInTheDocument();
        });
    });

    describe('初期値', () => {
        it('initialDataが渡された時フォームに値がセットされる', () => {
            const initialData = {
                name: '株式会社テスト',
                shortName: 'テスト',
                email: 'test@example.com',
                phone: '03-1111-2222',
            };

            render(
                <CustomerForm
                    initialData={initialData}
                    onSubmit={mockOnSubmit}
                    onCancel={mockOnCancel}
                />
            );

            expect(screen.getByDisplayValue('株式会社テスト')).toBeInTheDocument();
            expect(screen.getByDisplayValue('テスト')).toBeInTheDocument();
            expect(screen.getByDisplayValue('test@example.com')).toBeInTheDocument();
            expect(screen.getByDisplayValue('03-1111-2222')).toBeInTheDocument();
        });
    });

    describe('担当者管理', () => {
        it('担当者追加ボタンをクリックすると担当者フォームが追加される', async () => {
            const user = userEvent.setup();
            render(<CustomerForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

            expect(screen.getByText('担当者が登録されていません')).toBeInTheDocument();

            await user.click(screen.getByRole('button', { name: /担当者追加/ }));

            expect(screen.queryByText('担当者が登録されていません')).not.toBeInTheDocument();
            expect(screen.getByText('担当者 1')).toBeInTheDocument();
        });

        it('複数の担当者を追加できる', async () => {
            const user = userEvent.setup();
            render(<CustomerForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

            await user.click(screen.getByRole('button', { name: /担当者追加/ }));
            await user.click(screen.getByRole('button', { name: /担当者追加/ }));

            expect(screen.getByText('担当者 1')).toBeInTheDocument();
            expect(screen.getByText('担当者 2')).toBeInTheDocument();
        });

        it('担当者を削除できる', async () => {
            const user = userEvent.setup();
            render(<CustomerForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

            await user.click(screen.getByRole('button', { name: /担当者追加/ }));
            expect(screen.getByText('担当者 1')).toBeInTheDocument();

            await user.click(screen.getByTestId('trash-icon').closest('button')!);
            expect(screen.getByText('担当者が登録されていません')).toBeInTheDocument();
        });

        it('担当者の情報を入力できる', async () => {
            const user = userEvent.setup();
            render(<CustomerForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

            await user.click(screen.getByRole('button', { name: /担当者追加/ }));

            const nameInput = screen.getByPlaceholderText('氏名');
            await user.type(nameInput, '山田太郎');

            expect(screen.getByDisplayValue('山田太郎')).toBeInTheDocument();
        });
    });

    describe('フォーム送信', () => {
        it('会社名が空の時はHTML5バリデーションでブロックされる', async () => {
            render(<CustomerForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

            // 会社名フィールドにrequired属性があることを確認
            const nameInput = screen.getByPlaceholderText('例: ○○建設株式会社');
            expect(nameInput).toBeRequired();
        });

        it('有効なデータでonSubmitが呼ばれる', async () => {
            const user = userEvent.setup();
            render(<CustomerForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

            await user.type(screen.getByPlaceholderText('例: ○○建設株式会社'), '株式会社サンプル');
            await user.click(screen.getByRole('button', { name: '保存' }));

            expect(mockOnSubmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: '株式会社サンプル',
                })
            );
        });

        it('全フィールドを入力して送信できる', async () => {
            const user = userEvent.setup();
            render(<CustomerForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

            await user.type(screen.getByPlaceholderText('例: ○○建設株式会社'), '株式会社テスト');
            await user.type(screen.getByPlaceholderText('例: ○○建設'), 'テスト');
            await user.type(screen.getByPlaceholderText('例: info@example.com'), 'info@test.com');
            await user.type(screen.getByPlaceholderText('例: 03-1234-5678'), '03-9999-8888');

            await user.click(screen.getByRole('button', { name: '保存' }));

            expect(mockOnSubmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: '株式会社テスト',
                    shortName: 'テスト',
                    email: 'info@test.com',
                    phone: '03-9999-8888',
                })
            );
        });
    });

    describe('キャンセル', () => {
        it('キャンセルボタンでonCancelが呼ばれる', async () => {
            const user = userEvent.setup();
            render(<CustomerForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

            await user.click(screen.getByRole('button', { name: 'キャンセル' }));

            expect(mockOnCancel).toHaveBeenCalledTimes(1);
        });
    });

    describe('地図プレビュー', () => {
        it('住所入力時に地図プレビューが表示される', async () => {
            const user = userEvent.setup();
            render(<CustomerForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

            await user.type(
                screen.getByPlaceholderText('例: 東京都○○区○○1-2-3'),
                '東京都渋谷区'
            );

            expect(screen.getByTitle('地図プレビュー')).toBeInTheDocument();
        });
    });
});
