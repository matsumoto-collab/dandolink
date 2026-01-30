import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectForm from '@/components/Projects/ProjectForm';

// lucide-react のモック
jest.mock('lucide-react', () => ({
    Plus: () => <svg data-testid="plus-icon" />,
    User: () => <svg data-testid="user-icon" />,
    Search: () => <svg data-testid="search-icon" />,
    Loader2: ({ className }: { className?: string }) => (
        <svg data-testid="loader-icon" className={className} />
    ),
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
const mockToast = jest.requireMock('react-hot-toast').default;

// uuid モック
jest.mock('uuid', () => ({
    v4: () => 'test-uuid-1234',
}));

// hooks のモック
jest.mock('@/hooks/useMasterData', () => ({
    useMasterData: () => ({
        vehicles: [
            { id: '1', name: '2tトラック' },
            { id: '2', name: '4tトラック' },
        ],
        totalMembers: 10,
    }),
}));

jest.mock('@/hooks/useProjects', () => ({
    useProjects: () => ({
        projects: [],
    }),
}));

// fetch モック
global.fetch = jest.fn(() =>
    Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
    })
) as jest.Mock;

describe('ProjectForm', () => {
    const mockOnSubmit = jest.fn();
    const mockOnCancel = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        (global.fetch as jest.Mock).mockClear();
        (global.fetch as jest.Mock).mockImplementation(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve([]),
            })
        );
    });

    // ヘルパー関数: APIロード完了を待つ
    const waitForApiLoad = async () => {
        await waitFor(() => {
            expect(screen.queryByText('担当者を読み込み中...')).not.toBeInTheDocument();
        });
    };

    describe('基本レンダリング', () => {
        it('必須フィールドが表示される', async () => {
            render(<ProjectForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
            await waitForApiLoad();

            expect(screen.getByText(/現場名/)).toBeInTheDocument();
            expect(screen.getByPlaceholderText('例: 帝人')).toBeInTheDocument();
        });

        it('工事種別チェックボックスが表示される', async () => {
            render(<ProjectForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
            await waitForApiLoad();

            expect(screen.getByText('組立')).toBeInTheDocument();
            expect(screen.getByText('解体')).toBeInTheDocument();
            // 「その他」はカテゴリーにもあるのでテキストチェックを調整
            expect(screen.getAllByText('その他').length).toBeGreaterThanOrEqual(1);
        });

        it('ステータス選択が表示される', async () => {
            render(<ProjectForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
            await waitForApiLoad();

            expect(screen.getByText('ステータス')).toBeInTheDocument();
            expect(screen.getByRole('option', { name: '保留' })).toBeInTheDocument();
            expect(screen.getByRole('option', { name: '確定' })).toBeInTheDocument();
        });

        it('保存とキャンセルボタンが表示される', async () => {
            render(<ProjectForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
            await waitForApiLoad();

            expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'キャンセル' })).toBeInTheDocument();
        });
    });

    describe('バリデーション', () => {
        it('工事種別が未選択の時エラーを表示する', async () => {
            const user = userEvent.setup();
            render(<ProjectForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
            await waitForApiLoad();

            await user.type(screen.getByPlaceholderText('例: 帝人'), 'テスト現場');
            await user.click(screen.getByRole('button', { name: '保存' }));

            expect(mockToast.error).toHaveBeenCalledWith(
                '組立、解体、その他のいずれかを選択してください'
            );
            expect(mockOnSubmit).not.toHaveBeenCalled();
        });
    });

    describe('工事種別選択', () => {
        it('組立をチェックすると日付入力が表示される', async () => {
            const user = userEvent.setup();
            render(<ProjectForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
            await waitForApiLoad();

            const assemblyCheckbox = screen.getByRole('checkbox', { name: /組立/ });
            await user.click(assemblyCheckbox);

            expect(screen.getByText('開始日')).toBeInTheDocument();
            expect(screen.getByText('終了日')).toBeInTheDocument();
        });

        it('解体をチェックすると日付入力が表示される', async () => {
            const user = userEvent.setup();
            render(<ProjectForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
            await waitForApiLoad();

            const demolitionCheckbox = screen.getByRole('checkbox', { name: /解体/ });
            await user.click(demolitionCheckbox);

            expect(screen.getByText('開始日')).toBeInTheDocument();
        });
    });

    describe('車両選択', () => {
        it('車両一覧が表示される', async () => {
            render(<ProjectForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
            await waitForApiLoad();

            expect(screen.getByText('2tトラック')).toBeInTheDocument();
            expect(screen.getByText('4tトラック')).toBeInTheDocument();
        });

        it('車両をチェックできる', async () => {
            const user = userEvent.setup();
            render(<ProjectForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
            await waitForApiLoad();

            const truckCheckbox = screen.getByRole('checkbox', { name: '2tトラック' });
            await user.click(truckCheckbox);

            expect(truckCheckbox).toBeChecked();
            expect(screen.getByText('選択中: 1台')).toBeInTheDocument();
        });
    });

    describe('メンバー数選択', () => {
        it('メンバー数セクションが表示される', async () => {
            render(<ProjectForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
            await waitForApiLoad();

            expect(screen.getByText('メンバー数')).toBeInTheDocument();
            // 0人〜の選択肢が存在することを確認
            expect(screen.getByRole('option', { name: '0人' })).toBeInTheDocument();
        });
    });

    describe('フォーム送信', () => {
        it('有効なデータでonSubmitが呼ばれる', async () => {
            const user = userEvent.setup();
            render(<ProjectForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
            await waitForApiLoad();

            await user.type(screen.getByPlaceholderText('例: 帝人'), 'テスト現場');

            // 組立をチェック
            const assemblyCheckbox = screen.getByRole('checkbox', { name: /組立/ });
            await user.click(assemblyCheckbox);

            await user.click(screen.getByRole('button', { name: '保存' }));

            expect(mockOnSubmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'テスト現場',
                    constructionType: 'assembly',
                })
            );
        });
    });

    describe('キャンセル', () => {
        it('キャンセルボタンでonCancelが呼ばれる', async () => {
            const user = userEvent.setup();
            render(<ProjectForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
            await waitForApiLoad();

            await user.click(screen.getByRole('button', { name: 'キャンセル' }));

            expect(mockOnCancel).toHaveBeenCalledTimes(1);
        });
    });

    describe('複数日スケジュール', () => {
        it('複数日スケジュールのトグルが表示される', async () => {
            render(<ProjectForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
            await waitForApiLoad();

            expect(screen.getByText('複数日の作業を登録')).toBeInTheDocument();
        });
    });

    describe('初期値', () => {
        it('initialDataが渡された時フォームに値がセットされる', async () => {
            const initialData = {
                title: '既存案件',
                customer: 'テスト顧客',
                status: 'confirmed' as const,
            };

            render(
                <ProjectForm
                    initialData={initialData}
                    onSubmit={mockOnSubmit}
                    onCancel={mockOnCancel}
                />
            );
            await waitForApiLoad();

            expect(screen.getByDisplayValue('既存案件')).toBeInTheDocument();
        });
    });
});
