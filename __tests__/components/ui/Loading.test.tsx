import React from 'react';
import { render, screen } from '@testing-library/react';
import Loading, {
    PageLoading,
    TableRowSkeleton,
    CardSkeleton,
    ButtonLoading,
} from '@/components/ui/Loading';

// lucide-react のモック
jest.mock('lucide-react', () => ({
    Loader2: ({ className }: { className?: string }) => (
        <svg data-testid="loader-icon" className={className} />
    ),
}));

describe('Loading', () => {
    describe('基本レンダリング', () => {
        it('ローディングアイコンを表示する', () => {
            render(<Loading />);
            expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
        });

        it('デフォルトでmdサイズが適用される', () => {
            render(<Loading />);
            expect(screen.getByTestId('loader-icon')).toHaveClass('w-8', 'h-8');
        });
    });

    describe('サイズ', () => {
        it('smサイズが正しく適用される', () => {
            render(<Loading size="sm" />);
            expect(screen.getByTestId('loader-icon')).toHaveClass('w-4', 'h-4');
        });

        it('lgサイズが正しく適用される', () => {
            render(<Loading size="lg" />);
            expect(screen.getByTestId('loader-icon')).toHaveClass('w-12', 'h-12');
        });
    });

    describe('テキスト表示', () => {
        it('textプロパティが渡された時テキストを表示する', () => {
            render(<Loading text="読み込み中..." />);
            expect(screen.getByText('読み込み中...')).toBeInTheDocument();
        });

        it('textがない時はテキストを表示しない', () => {
            const { container } = render(<Loading />);
            expect(container.querySelector('p')).not.toBeInTheDocument();
        });
    });

    describe('オーバーレイ表示', () => {
        it('overlayがtrueの時オーバーレイ要素を表示する', () => {
            const { container } = render(<Loading overlay />);
            expect(container.querySelector('.fixed.inset-0')).toBeInTheDocument();
            expect(container.querySelector('.bg-black\\/50')).toBeInTheDocument();
        });
    });

    describe('フルスクリーン表示', () => {
        it('fullScreenがtrueの時フルスクリーン要素を表示する', () => {
            const { container } = render(<Loading fullScreen />);
            expect(container.querySelector('.fixed.inset-0')).toBeInTheDocument();
        });

        it('fullScreenでtextが表示される', () => {
            render(<Loading fullScreen text="データを取得中..." />);
            expect(screen.getByText('データを取得中...')).toBeInTheDocument();
        });
    });

    describe('カスタムクラス', () => {
        it('classNameが正しく適用される', () => {
            const { container } = render(<Loading className="custom-class" />);
            expect(container.firstChild).toHaveClass('custom-class');
        });
    });
});

describe('PageLoading', () => {
    it('デフォルトテキストを表示する', () => {
        render(<PageLoading />);
        expect(screen.getByText('読み込み中...')).toBeInTheDocument();
    });

    it('カスタムテキストを表示する', () => {
        render(<PageLoading text="ページを準備中..." />);
        expect(screen.getByText('ページを準備中...')).toBeInTheDocument();
    });

    it('lgサイズのローダーを表示する', () => {
        render(<PageLoading />);
        expect(screen.getByTestId('loader-icon')).toHaveClass('w-12', 'h-12');
    });
});

describe('TableRowSkeleton', () => {
    it('デフォルトで5列のスケルトンを表示する', () => {
        const { container } = render(
            <table>
                <tbody>
                    <TableRowSkeleton />
                </tbody>
            </table>
        );
        const cells = container.querySelectorAll('td');
        expect(cells).toHaveLength(5);
    });

    it('指定した列数のスケルトンを表示する', () => {
        const { container } = render(
            <table>
                <tbody>
                    <TableRowSkeleton columns={3} />
                </tbody>
            </table>
        );
        const cells = container.querySelectorAll('td');
        expect(cells).toHaveLength(3);
    });

    it('animate-pulseクラスが適用される', () => {
        const { container } = render(
            <table>
                <tbody>
                    <TableRowSkeleton />
                </tbody>
            </table>
        );
        expect(container.querySelector('tr')).toHaveClass('animate-pulse');
    });
});

describe('CardSkeleton', () => {
    it('スケルトンカードを表示する', () => {
        const { container } = render(<CardSkeleton />);
        expect(container.firstChild).toHaveClass('animate-pulse');
    });

    it('スケルトンラインを表示する', () => {
        const { container } = render(<CardSkeleton />);
        const skeletonLines = container.querySelectorAll('.bg-slate-200');
        expect(skeletonLines.length).toBeGreaterThan(0);
    });
});

describe('ButtonLoading', () => {
    it('smサイズがデフォルトで適用される', () => {
        render(<ButtonLoading />);
        expect(screen.getByTestId('loader-icon')).toHaveClass('w-4', 'h-4');
    });

    it('mdサイズが正しく適用される', () => {
        render(<ButtonLoading size="md" />);
        expect(screen.getByTestId('loader-icon')).toHaveClass('w-5', 'h-5');
    });

    it('animate-spinクラスが適用される', () => {
        render(<ButtonLoading />);
        expect(screen.getByTestId('loader-icon')).toHaveClass('animate-spin');
    });
});
