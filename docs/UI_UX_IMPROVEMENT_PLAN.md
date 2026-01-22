# YuSystem UI/UX 改善計画書

> 作成日: 2026-01-22
> 対象システム: YuSystem（工事案件管理システム）

---

## 目次

1. [現状分析サマリー](#1-現状分析サマリー)
2. [改善項目一覧](#2-改善項目一覧)
3. [優先度1: 即座に対応すべき課題](#3-優先度1-即座に対応すべき課題)
4. [優先度2: 短期的に対応すべき課題](#4-優先度2-短期的に対応すべき課題)
5. [優先度3: 長期的な改善](#5-優先度3-長期的な改善)
6. [実装ガイドライン](#6-実装ガイドライン)
7. [進捗チェックリスト](#7-進捗チェックリスト)

---

## 1. 現状分析サマリー

### 技術スタック

| 項目 | 使用技術 |
|------|----------|
| フレームワーク | Next.js 14.2.0 (App Router) |
| スタイリング | Tailwind CSS 3.4.1 |
| アイコン | lucide-react 0.344.0 |
| ドラッグ&ドロップ | @dnd-kit/core, @dnd-kit/sortable |
| 認証 | next-auth 4.24.5 |
| 通知 | react-hot-toast 2.6.0 |
| ORM | Prisma 5.8.0 |
| 言語 | TypeScript 5.3.3 |

### 現状の強み

- モダンな Tailwind CSS によるスタイリング
- Next.js App Router を活用した構造
- ドラッグ&ドロップ機能の充実（dnd-kit）
- ロール別アクセス制御の実装
- 日本語対応

### 改善が必要な領域

- デザイン一貫性の不足
- アクセシビリティ対応の不十分さ
- モバイル UI の最適化不足
- フォーム管理の複雑性
- エラーハンドリング・ローディング状態の統一不足

---

## 2. 改善項目一覧

| 優先度 | カテゴリ | 項目 | 影響範囲 |
|--------|----------|------|----------|
| 1 | デザイン | デザインシステムの確立 | 全体 |
| 1 | デザイン | ボタン・入力フィールドの統一 | 全体 |
| 1 | アクセシビリティ | aria属性の追加 | 全体 |
| 1 | アクセシビリティ | キーボードナビゲーション | 全体 |
| 2 | モバイル | タッチターゲットサイズ最適化 | 全体 |
| 2 | モバイル | タブレット対応（mdブレークポイント） | 全体 |
| 2 | UX | ローディング状態の統一 | 全体 |
| 2 | UX | エラーハンドリングの統一 | 全体 |
| 3 | フォーム | React Hook Form + Zod 導入 | フォーム全体 |
| 3 | 状態管理 | Context Provider の最適化 | 全体 |
| 3 | 機能 | 検索・フィルター機能の強化 | 一覧ページ |

---

## 3. 優先度1: 即座に対応すべき課題

### 3.1 デザインシステムの確立

#### 現状の問題

```tsx
// ボタンスタイルが場所によって異なる
// Sidebar
className="w-full flex items-center gap-3 px-3 py-3 rounded-xl..."

// Calendar Header
className="px-4 py-2 text-xs font-semibold..."

// ProjectMasterListPage
className="px-4 py-2 bg-blue-600 text-white..."
```

#### 対応方針

**ファイル作成**: `components/ui/Button.tsx`

```tsx
import { cva, type VariantProps } from 'class-variance-authority';

const buttonVariants = cva(
  // 基本スタイル
  'inline-flex items-center justify-center rounded-lg font-medium transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary: 'bg-slate-700 text-white hover:bg-slate-600 focus:ring-slate-500',
        secondary: 'bg-gray-100 text-gray-700 hover:bg-gray-200 focus:ring-gray-400',
        danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
        outline: 'border border-gray-300 bg-transparent hover:bg-gray-50 focus:ring-gray-400',
        ghost: 'hover:bg-gray-100 focus:ring-gray-400',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  isLoading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  isLoading,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={buttonVariants({ variant, size, className })}
      disabled={isLoading}
      {...props}
    >
      {isLoading && <Spinner className="mr-2 h-4 w-4" />}
      {children}
    </button>
  );
}
```

**ファイル作成**: `components/ui/Input.tsx`

```tsx
import { forwardRef } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  required?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, required, className, ...props }, ref) => {
    return (
      <div className="space-y-1">
        {label && (
          <label className="block text-sm font-medium text-gray-700">
            {label}
            {required && <span className="text-red-500 ml-1">*</span>}
          </label>
        )}
        <input
          ref={ref}
          className={`
            w-full px-3 py-2
            border rounded-lg
            transition-colors
            focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent
            ${error ? 'border-red-500' : 'border-gray-300'}
            ${className}
          `}
          {...props}
        />
        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}
      </div>
    );
  }
);
```

#### Tailwind Config 拡張

**ファイル**: `tailwind.config.ts`

```typescript
// spacing の標準化を追加
theme: {
  extend: {
    spacing: {
      '4.5': '1.125rem',  // 18px
      '13': '3.25rem',    // 52px
      '15': '3.75rem',    // 60px
    },
    // タッチターゲット用の最小サイズ
    minWidth: {
      'touch': '44px',
    },
    minHeight: {
      'touch': '44px',
    },
  },
},
```

---

### 3.2 アクセシビリティ基本対応

#### 3.2.1 aria属性の追加

**対象ファイル一覧**:
- `components/Calendar/CalendarHeader.tsx`
- `components/Calendar/WeeklyCalendar.tsx`
- `components/Calendar/DraggableEventCard.tsx`
- `components/Sidebar.tsx`
- 全てのモーダルコンポーネント

**修正例**: `CalendarHeader.tsx`

```tsx
// Before
<button onClick={onPreviousWeek} className="...">
  <ChevronLeft className="w-5 h-5" />
</button>

// After
<button
  onClick={onPreviousWeek}
  className="..."
  aria-label="前の週へ移動"
  title="前の週"
>
  <ChevronLeft className="w-5 h-5" aria-hidden="true" />
</button>
```

**修正例**: モーダルコンポーネント

```tsx
// Before
<div className="fixed inset-0 bg-black/50">
  <div className="bg-white rounded-lg">
    ...
  </div>
</div>

// After
<div
  className="fixed inset-0 bg-black/50"
  role="dialog"
  aria-modal="true"
  aria-labelledby="modal-title"
>
  <div className="bg-white rounded-lg">
    <h2 id="modal-title">モーダルタイトル</h2>
    ...
  </div>
</div>
```

#### 3.2.2 キーボードナビゲーション

**共通フック作成**: `hooks/useKeyboardNavigation.ts`

```typescript
import { useEffect, useCallback } from 'react';

interface KeyboardNavigationOptions {
  onEscape?: () => void;
  onEnter?: () => void;
  onArrowUp?: () => void;
  onArrowDown?: () => void;
  enabled?: boolean;
}

export function useKeyboardNavigation({
  onEscape,
  onEnter,
  onArrowUp,
  onArrowDown,
  enabled = true,
}: KeyboardNavigationOptions) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!enabled) return;

    switch (e.key) {
      case 'Escape':
        onEscape?.();
        break;
      case 'Enter':
        if (!e.shiftKey) onEnter?.();
        break;
      case 'ArrowUp':
        e.preventDefault();
        onArrowUp?.();
        break;
      case 'ArrowDown':
        e.preventDefault();
        onArrowDown?.();
        break;
    }
  }, [enabled, onEscape, onEnter, onArrowUp, onArrowDown]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
```

#### 3.2.3 色以外での情報表現

**現状の問題**:
```tsx
// ステータスが色のみで判別
const statusConfig = {
  confirmed: { label: '確定', color: 'bg-green-100 text-green-700' },
  pending: { label: '保留', color: 'bg-yellow-100 text-yellow-700' },
};
```

**改善案**:
```tsx
const statusConfig = {
  confirmed: {
    label: '確定',
    color: 'bg-green-100 text-green-700',
    icon: CheckCircle,  // アイコンを追加
  },
  pending: {
    label: '保留',
    color: 'bg-yellow-100 text-yellow-700',
    icon: Clock,
  },
};

// 使用時
<span className={statusConfig[status].color}>
  <StatusIcon className="w-4 h-4 mr-1 inline" aria-hidden="true" />
  {statusConfig[status].label}
</span>
```

---

## 4. 優先度2: 短期的に対応すべき課題

### 4.1 モバイルUI最適化

#### 4.1.1 タッチターゲットサイズ

**最小サイズ**: 44x44px（Apple Human Interface Guidelines準拠）

**対象ファイル**:
- 全てのボタンコンポーネント
- ナビゲーションリンク
- フォーム要素

```tsx
// Before
<button className="px-2.5 py-2">...</button>

// After
<button className="min-w-touch min-h-touch px-3 py-2">...</button>
```

#### 4.1.2 タブレット対応（mdブレークポイント追加）

**対象ファイル**: `components/MainContent.tsx`

```tsx
// Before
className="left-0 right-0 pt-16 lg:left-64 lg:pt-0"

// After
className="
  left-0 right-0 pt-16
  md:left-48 md:pt-0    // タブレット: 狭いサイドバー
  lg:left-64 lg:pt-0    // デスクトップ: フルサイドバー
"
```

**対象ファイル**: `components/Sidebar.tsx`

```tsx
// タブレット時は狭いサイドバーを表示
className="
  w-64
  md:w-48              // タブレット時は狭く
  lg:w-64              // デスクトップ時は通常幅
"
```

#### 4.1.3 WeeklyCalendar のレスポンシブ対応

```tsx
// 画面幅に応じて表示日数を変更
const visibleDays = useBreakpointValue({
  base: 1,    // モバイル: 1日
  sm: 3,      // 小タブレット: 3日
  md: 5,      // タブレット: 5日
  lg: 7,      // デスクトップ: 7日
});
```

---

### 4.2 ローディング状態の統一

#### 4.2.1 ローディングスケルトンの活用

**ファイル**: `components/ui/Loading.tsx` （既存を拡張）

```tsx
// ページローディング
export function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-4 p-6">
      <div className="h-8 bg-gray-200 rounded w-1/4"></div>
      <div className="space-y-3">
        <div className="h-4 bg-gray-200 rounded"></div>
        <div className="h-4 bg-gray-200 rounded w-5/6"></div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-24 bg-gray-200 rounded"></div>
        ))}
      </div>
    </div>
  );
}

// カレンダーローディング
export function CalendarSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-12 bg-gray-200 rounded mb-4"></div>
      <div className="grid grid-cols-7 gap-2">
        {[...Array(35)].map((_, i) => (
          <div key={i} className="h-20 bg-gray-200 rounded"></div>
        ))}
      </div>
    </div>
  );
}
```

#### 4.2.2 Suspense境界の設定

```tsx
// app/page.tsx または各ページ
import { Suspense } from 'react';
import { CalendarSkeleton } from '@/components/ui/Loading';

export default function Page() {
  return (
    <Suspense fallback={<CalendarSkeleton />}>
      <WeeklyCalendar />
    </Suspense>
  );
}
```

---

### 4.3 エラーハンドリングの統一

#### 4.3.1 APIエラーユーティリティ

**ファイル作成**: `lib/api-error.ts`

```typescript
export class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string
  ) {
    super(message);
    this.name = 'APIError';
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof APIError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return '予期しないエラーが発生しました';
}

export async function handleAPIResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new APIError(
      errorData.message || 'APIエラーが発生しました',
      response.status,
      errorData.code
    );
  }
  return response.json();
}
```

#### 4.3.2 統一されたエラーハンドリング

**各ページでの使用例**:

```typescript
import { getErrorMessage, handleAPIResponse } from '@/lib/api-error';
import toast from 'react-hot-toast';

const handleCreate = async (data: FormData) => {
  try {
    const response = await fetch('/api/customers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    const result = await handleAPIResponse<Customer>(response);
    toast.success('顧客を追加しました');
    return result;
  } catch (error) {
    toast.error(getErrorMessage(error));
    throw error;
  }
};
```

#### 4.3.3 Error Boundary コンポーネント

**ファイル作成**: `components/ErrorBoundary.tsx`

```tsx
'use client';

import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-6 text-center">
          <h2 className="text-xl font-bold text-red-600 mb-2">
            エラーが発生しました
          </h2>
          <p className="text-gray-600 mb-4">
            {this.state.error?.message || '予期しないエラーです'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="px-4 py-2 bg-slate-700 text-white rounded-lg"
          >
            再試行
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
```

---

## 5. 優先度3: 長期的な改善

### 5.1 フォーム管理ライブラリ導入

#### 必要パッケージ

```bash
npm install react-hook-form zod @hookform/resolvers
```

#### スキーマ定義例

**ファイル作成**: `lib/validations/project.ts`

```typescript
import { z } from 'zod';

export const projectSchema = z.object({
  title: z.string().min(1, '現場名は必須です'),
  customer: z.string().optional(),
  customerId: z.string().optional(),
  selectedManagers: z.array(z.string()).min(1, '案件責任者は必須です'),
  memberCount: z.number().min(0),
  selectedVehicles: z.array(z.string()),
  hasAssembly: z.boolean(),
  hasDemolition: z.boolean(),
  hasOther: z.boolean(),
  assemblyStartDate: z.string().optional(),
  assemblyEndDate: z.string().optional(),
  demolitionStartDate: z.string().optional(),
  demolitionEndDate: z.string().optional(),
  otherStartDate: z.string().optional(),
  otherEndDate: z.string().optional(),
  status: z.enum(['pending', 'confirmed', 'cancelled']),
  category: z.enum(['construction', 'maintenance', 'other']),
  remarks: z.string().optional(),
});

export type ProjectFormData = z.infer<typeof projectSchema>;
```

#### フォームコンポーネント例

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { projectSchema, ProjectFormData } from '@/lib/validations/project';

export function ProjectForm({ onSubmit, initialData }: Props) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProjectFormData>({
    resolver: zodResolver(projectSchema),
    defaultValues: initialData,
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <Input
        label="現場名"
        required
        error={errors.title?.message}
        {...register('title')}
      />
      {/* 他のフィールド */}
      <Button type="submit" isLoading={isSubmitting}>
        保存
      </Button>
    </form>
  );
}
```

---

### 5.2 Context Provider の最適化

#### 現状の問題

`app/layout.tsx` で13個のプロバイダーがネストしており、以下の問題がある:
- デバッグが困難
- 不要な再レンダリングの可能性
- コードの可読性低下

#### 解決案1: 複合プロバイダーの作成

**ファイル作成**: `providers/AppProviders.tsx`

```tsx
import { ReactNode } from 'react';
// 各プロバイダーをimport

const providers = [
  AuthProvider,
  NavigationProvider,
  MasterDataProvider,
  ProjectProvider,
  ProjectMasterProvider,
  AssignmentProvider,
  // ... 他のプロバイダー
];

export function AppProviders({ children }: { children: ReactNode }) {
  return providers.reduceRight(
    (acc, Provider) => <Provider>{acc}</Provider>,
    children
  );
}
```

#### 解決案2: Zustand への移行検討

状態管理の一部をZustandに移行することで、Context地獄を回避:

```typescript
// store/useProjectStore.ts
import { create } from 'zustand';

interface ProjectState {
  projects: Project[];
  isLoading: boolean;
  fetchProjects: () => Promise<void>;
  addProject: (project: Project) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  isLoading: false,
  fetchProjects: async () => {
    set({ isLoading: true });
    const res = await fetch('/api/projects');
    const data = await res.json();
    set({ projects: data, isLoading: false });
  },
  addProject: (project) =>
    set((state) => ({ projects: [...state.projects, project] })),
}));
```

---

### 5.3 検索・フィルター機能の強化

#### ページネーション実装

**ファイル作成**: `components/ui/Pagination.tsx`

```tsx
interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ currentPage, totalPages, onPageChange }: PaginationProps) {
  return (
    <nav aria-label="ページナビゲーション" className="flex justify-center gap-2">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        aria-label="前のページ"
        className="px-3 py-2 rounded-lg border disabled:opacity-50"
      >
        前へ
      </button>

      {/* ページ番号 */}
      {[...Array(totalPages)].map((_, i) => (
        <button
          key={i + 1}
          onClick={() => onPageChange(i + 1)}
          aria-current={currentPage === i + 1 ? 'page' : undefined}
          className={`px-3 py-2 rounded-lg border ${
            currentPage === i + 1 ? 'bg-slate-700 text-white' : ''
          }`}
        >
          {i + 1}
        </button>
      ))}

      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        aria-label="次のページ"
        className="px-3 py-2 rounded-lg border disabled:opacity-50"
      >
        次へ
      </button>
    </nav>
  );
}
```

#### 高度なフィルター UI

**ファイル作成**: `components/ui/FilterPanel.tsx`

```tsx
interface FilterOption {
  id: string;
  label: string;
  type: 'select' | 'date' | 'checkbox' | 'search';
  options?: { value: string; label: string }[];
}

interface FilterPanelProps {
  filters: FilterOption[];
  values: Record<string, any>;
  onChange: (key: string, value: any) => void;
  onReset: () => void;
}

export function FilterPanel({ filters, values, onChange, onReset }: FilterPanelProps) {
  return (
    <div className="bg-gray-50 p-4 rounded-lg space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">フィルター</h3>
        <button onClick={onReset} className="text-sm text-slate-600 hover:underline">
          リセット
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {filters.map((filter) => (
          <FilterField
            key={filter.id}
            filter={filter}
            value={values[filter.id]}
            onChange={(v) => onChange(filter.id, v)}
          />
        ))}
      </div>
    </div>
  );
}
```

---

## 6. 実装ガイドライン

### コーディング規約

#### コンポーネント命名

```
components/
├── ui/              # 汎用UIコンポーネント（Button, Input, Modal等）
├── Calendar/        # カレンダー機能専用
├── Projects/        # プロジェクト機能専用
└── [Feature]/       # 機能ごとにグループ化
```

#### ファイル命名

- コンポーネント: `PascalCase.tsx`
- フック: `useCamelCase.ts`
- ユーティリティ: `kebab-case.ts`
- 型定義: `camelCase.ts`（types/ 配下）

#### Tailwind クラス順序

```tsx
className="
  // 1. レイアウト（display, position）
  flex items-center justify-center
  // 2. サイズ
  w-full h-10
  // 3. スペーシング
  px-4 py-2 gap-2
  // 4. 背景・ボーダー
  bg-white border border-gray-300 rounded-lg
  // 5. テキスト
  text-sm font-medium text-gray-700
  // 6. エフェクト
  shadow-md
  // 7. トランジション
  transition-all duration-200
  // 8. インタラクティブ状態
  hover:bg-gray-50 focus:ring-2 disabled:opacity-50
"
```

### テスト方針

優先してテストを書くべき箇所:
1. フォームバリデーションロジック
2. APIエラーハンドリング
3. アクセシビリティ（キーボードナビゲーション）
4. ドラッグ&ドロップ操作

---

## 7. 進捗チェックリスト

### 優先度1（即座に対応）

- [ ] **デザインシステム**
  - [ ] `components/ui/Button.tsx` 作成
  - [ ] `components/ui/Input.tsx` 作成
  - [ ] `components/ui/Select.tsx` 作成
  - [ ] `components/ui/Modal.tsx` 作成（共通化）
  - [ ] `tailwind.config.ts` 拡張（spacing, colors）
  - [ ] 既存コンポーネントを新UIコンポーネントに置換

- [ ] **アクセシビリティ**
  - [ ] `CalendarHeader.tsx` - aria属性追加
  - [ ] `WeeklyCalendar.tsx` - aria属性追加
  - [ ] `Sidebar.tsx` - aria属性追加
  - [ ] 全モーダル - role="dialog" 追加
  - [ ] `hooks/useKeyboardNavigation.ts` 作成
  - [ ] ステータス表示にアイコン追加

### 優先度2（短期）

- [ ] **モバイル最適化**
  - [ ] 全ボタンのタッチターゲットサイズ確認・修正
  - [ ] `MainContent.tsx` - mdブレークポイント追加
  - [ ] `Sidebar.tsx` - タブレット対応
  - [ ] `WeeklyCalendar.tsx` - レスポンシブ表示日数

- [ ] **ローディング・エラー**
  - [ ] `Loading.tsx` 拡張（スケルトン追加）
  - [ ] 各ページにSuspense境界設定
  - [ ] `lib/api-error.ts` 作成
  - [ ] `components/ErrorBoundary.tsx` 作成
  - [ ] 既存エラーハンドリングを統一

### 優先度3（長期）

- [ ] **フォーム管理**
  - [ ] react-hook-form, zod インストール
  - [ ] `lib/validations/` スキーマ作成
  - [ ] `ProjectForm.tsx` リファクタリング
  - [ ] `CustomerForm.tsx` リファクタリング
  - [ ] `EstimateForm.tsx` リファクタリング

- [ ] **状態管理**
  - [ ] `providers/AppProviders.tsx` 作成
  - [ ] Zustand 検討・導入

- [ ] **検索・フィルター**
  - [ ] `components/ui/Pagination.tsx` 作成
  - [ ] `components/ui/FilterPanel.tsx` 作成
  - [ ] 一覧ページにページネーション追加

---

## 付録: 参考リソース

- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [React Hook Form](https://react-hook-form.com/)
- [Zod](https://zod.dev/)
- [dnd-kit](https://dndkit.com/)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)

---

> **Note**: この文書は定期的に更新し、完了した項目にチェックを入れてください。
