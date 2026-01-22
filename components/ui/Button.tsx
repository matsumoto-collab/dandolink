'use client';

import React, { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** ボタンのバリアント */
  variant?: ButtonVariant;
  /** ボタンのサイズ */
  size?: ButtonSize;
  /** ローディング状態 */
  isLoading?: boolean;
  /** アイコン（左側） */
  leftIcon?: React.ReactNode;
  /** アイコン（右側） */
  rightIcon?: React.ReactNode;
  /** 幅を100%にする */
  fullWidth?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: `
    bg-gradient-to-r from-slate-700 to-slate-800
    text-white
    hover:from-slate-800 hover:to-slate-900
    focus:ring-slate-500
    shadow-md hover:shadow-lg
  `,
  secondary: `
    bg-gray-100
    text-gray-700
    hover:bg-gray-200
    focus:ring-gray-400
    border border-gray-200
  `,
  danger: `
    bg-red-600
    text-white
    hover:bg-red-700
    focus:ring-red-500
    shadow-md hover:shadow-lg
  `,
  outline: `
    bg-transparent
    text-slate-700
    border border-slate-300
    hover:bg-slate-50
    focus:ring-slate-400
  `,
  ghost: `
    bg-transparent
    text-slate-600
    hover:bg-slate-100
    focus:ring-slate-400
  `,
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2.5',
  icon: 'h-10 w-10 p-0',
};

const iconSizeStyles: Record<ButtonSize, string> = {
  sm: 'w-4 h-4',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
  icon: 'w-5 h-5',
};

/**
 * 統一されたボタンコンポーネント
 *
 * @example
 * // プライマリボタン
 * <Button>保存</Button>
 *
 * // アイコン付きボタン
 * <Button leftIcon={<Plus className="w-4 h-4" />}>新規作成</Button>
 *
 * // ローディング状態
 * <Button isLoading>送信中...</Button>
 *
 * // アイコンボタン
 * <Button variant="ghost" size="icon" aria-label="編集">
 *   <Edit className="w-4 h-4" />
 * </Button>
 *
 * // デンジャーボタン
 * <Button variant="danger">削除</Button>
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      disabled,
      className = '',
      children,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || isLoading;

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={`
          inline-flex items-center justify-center
          rounded-lg font-medium
          transition-all duration-200
          focus:outline-none focus:ring-2 focus:ring-offset-2
          disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none
          active:scale-[0.98]
          ${variantStyles[variant]}
          ${sizeStyles[size]}
          ${fullWidth ? 'w-full' : ''}
          ${className}
        `}
        {...props}
      >
        {isLoading ? (
          <>
            <Loader2 className={`animate-spin ${iconSizeStyles[size]}`} />
            {size !== 'icon' && children && (
              <span className="ml-2">{children}</span>
            )}
          </>
        ) : (
          <>
            {leftIcon && (
              <span className={iconSizeStyles[size]}>{leftIcon}</span>
            )}
            {children}
            {rightIcon && (
              <span className={iconSizeStyles[size]}>{rightIcon}</span>
            )}
          </>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';

/**
 * アイコンボタン用のショートカット
 * aria-labelが必須
 */
interface IconButtonProps extends Omit<ButtonProps, 'size' | 'leftIcon' | 'rightIcon'> {
  'aria-label': string;
  size?: 'sm' | 'md' | 'lg';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ size = 'md', variant = 'ghost', className = '', children, ...props }, ref) => {
    const sizeMap = {
      sm: 'h-8 w-8 min-h-[32px] min-w-[32px]',
      md: 'h-10 w-10 min-h-[40px] min-w-[40px]',
      lg: 'h-12 w-12 min-h-[48px] min-w-[48px]',
    };

    return (
      <Button
        ref={ref}
        variant={variant}
        size="icon"
        className={`${sizeMap[size]} ${className}`}
        {...props}
      >
        {children}
      </Button>
    );
  }
);

IconButton.displayName = 'IconButton';

/**
 * ボタングループ（ボタンを横並びに配置）
 */
interface ButtonGroupProps {
  children: React.ReactNode;
  className?: string;
}

export function ButtonGroup({ children, className = '' }: ButtonGroupProps) {
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      {children}
    </div>
  );
}

export default Button;
