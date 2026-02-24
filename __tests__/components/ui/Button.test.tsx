import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button, IconButton, ButtonGroup } from '@/components/ui/Button';

// lucide-react のモック
jest.mock('lucide-react', () => ({
    Loader2: ({ className }: { className?: string }) => (
        <svg data-testid="loader-icon" className={className} />
    ),
}));

describe('Button', () => {
    describe('基本レンダリング', () => {
        it('子要素を正しく表示する', () => {
            render(<Button>保存</Button>);
            expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
        });

        it('デフォルトでprimaryバリアントが適用される', () => {
            render(<Button>保存</Button>);
            const button = screen.getByRole('button');
            expect(button).toHaveClass('bg-slate-800');
            expect(button).toHaveClass('text-white');
        });

        it('デフォルトでmdサイズが適用される', () => {
            render(<Button>保存</Button>);
            const button = screen.getByRole('button');
            expect(button).toHaveClass('h-10');
        });
    });

    describe('バリアント', () => {
        it('secondaryバリアントが正しく適用される', () => {
            render(<Button variant="secondary">キャンセル</Button>);
            const button = screen.getByRole('button');
            expect(button).toHaveClass('bg-slate-100');
        });

        it('dangerバリアントが正しく適用される', () => {
            render(<Button variant="danger">削除</Button>);
            const button = screen.getByRole('button');
            expect(button).toHaveClass('bg-slate-700');
        });

        it('outlineバリアントが正しく適用される', () => {
            render(<Button variant="outline">詳細</Button>);
            const button = screen.getByRole('button');
            expect(button).toHaveClass('bg-transparent');
            expect(button).toHaveClass('border-slate-300');
        });

        it('ghostバリアントが正しく適用される', () => {
            render(<Button variant="ghost">閉じる</Button>);
            const button = screen.getByRole('button');
            expect(button).toHaveClass('bg-transparent');
            expect(button).toHaveClass('text-slate-600');
        });
    });

    describe('サイズ', () => {
        it('smサイズが正しく適用される', () => {
            render(<Button size="sm">小</Button>);
            expect(screen.getByRole('button')).toHaveClass('h-8');
        });

        it('lgサイズが正しく適用される', () => {
            render(<Button size="lg">大</Button>);
            expect(screen.getByRole('button')).toHaveClass('h-12');
        });

        it('iconサイズが正しく適用される', () => {
            render(<Button size="icon">+</Button>);
            expect(screen.getByRole('button')).toHaveClass('w-10');
        });
    });

    describe('ローディング状態', () => {
        it('isLoadingがtrueの時ローディングアイコンを表示する', () => {
            render(<Button isLoading>送信中</Button>);
            expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
        });

        it('isLoadingがtrueの時ボタンがdisabledになる', () => {
            render(<Button isLoading>送信中</Button>);
            expect(screen.getByRole('button')).toBeDisabled();
        });

        it('isLoadingがtrueの時もテキストは表示される', () => {
            render(<Button isLoading>送信中</Button>);
            expect(screen.getByText('送信中')).toBeInTheDocument();
        });
    });

    describe('disabled状態', () => {
        it('disabledがtrueの時ボタンがdisabledになる', () => {
            render(<Button disabled>保存</Button>);
            expect(screen.getByRole('button')).toBeDisabled();
        });
    });

    describe('アイコン', () => {
        it('leftIconが正しく表示される', () => {
            render(
                <Button leftIcon={<span data-testid="left-icon">L</span>}>
                    追加
                </Button>
            );
            expect(screen.getByTestId('left-icon')).toBeInTheDocument();
        });

        it('rightIconが正しく表示される', () => {
            render(
                <Button rightIcon={<span data-testid="right-icon">R</span>}>
                    次へ
                </Button>
            );
            expect(screen.getByTestId('right-icon')).toBeInTheDocument();
        });
    });

    describe('fullWidth', () => {
        it('fullWidthがtrueの時w-fullクラスが適用される', () => {
            render(<Button fullWidth>送信</Button>);
            expect(screen.getByRole('button')).toHaveClass('w-full');
        });
    });

    describe('イベント', () => {
        it('クリックイベントが発火する', () => {
            const handleClick = jest.fn();
            render(<Button onClick={handleClick}>クリック</Button>);
            fireEvent.click(screen.getByRole('button'));
            expect(handleClick).toHaveBeenCalledTimes(1);
        });

        it('disabledの時クリックイベントが発火しない', () => {
            const handleClick = jest.fn();
            render(<Button disabled onClick={handleClick}>クリック</Button>);
            fireEvent.click(screen.getByRole('button'));
            expect(handleClick).not.toHaveBeenCalled();
        });
    });

    describe('ref転送', () => {
        it('refが正しく転送される', () => {
            const ref = React.createRef<HTMLButtonElement>();
            render(<Button ref={ref}>ボタン</Button>);
            expect(ref.current).toBeInstanceOf(HTMLButtonElement);
        });
    });
});

describe('IconButton', () => {
    it('aria-labelが必須プロパティとして設定される', () => {
        render(
            <IconButton aria-label="編集">
                <span>E</span>
            </IconButton>
        );
        expect(screen.getByRole('button', { name: '編集' })).toBeInTheDocument();
    });

    it('デフォルトでghostバリアントが適用される', () => {
        render(
            <IconButton aria-label="削除">
                <span>D</span>
            </IconButton>
        );
        expect(screen.getByRole('button')).toHaveClass('bg-transparent');
    });

    it('サイズが正しく適用される', () => {
        render(
            <IconButton aria-label="追加" size="lg">
                <span>+</span>
            </IconButton>
        );
        expect(screen.getByRole('button')).toHaveClass('h-12', 'w-12');
    });
});

describe('ButtonGroup', () => {
    it('子要素を横並びで表示する', () => {
        render(
            <ButtonGroup>
                <Button>ボタン1</Button>
                <Button>ボタン2</Button>
            </ButtonGroup>
        );
        expect(screen.getByText('ボタン1')).toBeInTheDocument();
        expect(screen.getByText('ボタン2')).toBeInTheDocument();
    });

    it('inline-flexクラスが適用される', () => {
        const { container } = render(
            <ButtonGroup>
                <Button>ボタン</Button>
            </ButtonGroup>
        );
        expect(container.firstChild).toHaveClass('inline-flex');
    });
});
