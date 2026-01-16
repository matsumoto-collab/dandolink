# パフォーマンス改善計画

**作成日**: 2026-01-16
**ステータス**: 完了

---

## 調査結果サマリー

コードベース全体を調査し、以下のパフォーマンス問題を特定しました。

---

## 1. N+1クエリ問題 (重大) ✅ 完了

### 対象ファイル
- `app/api/daily-reports/route.ts` (37-54行目)
  - 深いネストのinclude (workItems → assignment → projectMaster)
  - 100件で300+クエリ発生の可能性

### 対策
```typescript
// Before
include: {
    workItems: {
        include: {
            assignment: {
                include: { projectMaster: true }
            }
        }
    }
}

// After - selectで必要なフィールドのみ取得
select: {
    id: true,
    date: true,
    workItems: {
        select: {
            id: true,
            assignment: {
                select: {
                    id: true,
                    projectMaster: {
                        select: { id: true, projectName: true }
                    }
                }
            }
        }
    }
}
```

---

## 2. ページネーション未実装 (重大) ✅ 完了 (estimates, customers, project-mastersは既に実装済み)

### 対象ファイル
- `app/api/estimates/route.ts` (56-69行目)
- `app/api/customers/route.ts` (54-67行目)
- `app/api/project-masters/route.ts`
- `app/api/assignments/route.ts`
- `app/api/master-data/` 各ルート

### 対策
```typescript
// すべてのGETエンドポイントに追加
const page = parseInt(searchParams.get('page') || '1');
const limit = parseInt(searchParams.get('limit') || '50');
const skip = (page - 1) * limit;

const [data, total] = await Promise.all([
    prisma.model.findMany({ skip, take: limit, ... }),
    prisma.model.count({ where })
]);

return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
```

---

## 3. コンポーネントメモ化不足 (高) ✅ 完了

### 対象ファイル
- `app/daily-reports/page.tsx` - フィルタ処理にuseMemoなし
- `app/invoices/page.tsx` - フィルタ処理にuseMemoなし
- `app/estimates/page.tsx` - 検索処理にuseMemoなし
- `app/project-masters/page.tsx` - 一部のみ対応済み

### 対策
```typescript
// Before
const filteredReports = dailyReports
    .filter(report => /* filtering logic */)
    .sort((a, b) => /* sorting logic */);

// After
const filteredReports = useMemo(() => {
    return dailyReports
        .filter(report => /* filtering logic */)
        .sort((a, b) => /* sorting logic */);
}, [dailyReports, searchTerm, filterStatus]);
```

---

## 4. コード分割・遅延読み込み (高) ✅ 完了

### 対象コンポーネント (大きいもの優先)
- `components/ProjectMasterForm.tsx` (988行)
- `components/EstimateForm.tsx` (620行)
- `components/ProjectForm.tsx` (613行)
- `components/Calendar/WeeklyCalendar.tsx` (559行)
- 各種モーダルコンポーネント

### 対策
```typescript
// Before
import ProjectMasterForm from '@/components/ProjectMasterForm';

// After
import dynamic from 'next/dynamic';
const ProjectMasterForm = dynamic(
    () => import('@/components/ProjectMasterForm'),
    { loading: () => <div>読み込み中...</div> }
);
```

---

## 5. 未使用ライブラリ削除 (中) ⏭️ スキップ (jspdfはPDF生成機能で実際に使用中)

### 対象
- `jspdf` (2MB+) - コードベースで使用箇所なし
- `jspdf-autotable` (300KB+) - コードベースで使用箇所なし

### 対策
```bash
npm uninstall jspdf jspdf-autotable
```

※ 将来使用予定がある場合は、必要になった時点でインストール

---

## 6. 検索デバウンス (中) ✅ 完了

### 対象ファイル
- 検索機能のある全ページ

### 対策
```typescript
// カスタムフック作成
function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState(value);
    useEffect(() => {
        const handler = setTimeout(() => setDebouncedValue(value), delay);
        return () => clearTimeout(handler);
    }, [value, delay]);
    return debouncedValue;
}

// 使用例
const [searchTerm, setSearchTerm] = useState('');
const debouncedSearch = useDebounce(searchTerm, 300);
```

---

## 7. Next.js設定最適化 (中) ✅ 完了

### 対象ファイル
- `next.config.js` (現在空)

### 対策
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    swcMinify: true,
    images: {
        formats: ['image/avif', 'image/webp'],
    },
    experimental: {
        optimizeCss: true,
    },
    // バンドル分析用 (開発時のみ)
    // webpack: (config, { isServer }) => {
    //     if (!isServer) {
    //         config.plugins.push(new BundleAnalyzerPlugin());
    //     }
    //     return config;
    // },
};

module.exports = nextConfig;
```

---

## 8. Context最適化 (中) ✅ 完了

### 対象ファイル
- `contexts/DailyReportContext.tsx`
- その他のContext

### 対策
```typescript
// Before - 毎回新しいオブジェクトが作られる
<Context.Provider value={{ data, isLoading, fetch }}>

// After - useMemoでメモ化
const contextValue = useMemo(() => ({
    data,
    isLoading,
    fetch
}), [data, isLoading, fetch]);

<Context.Provider value={contextValue}>
```

---

## 9. リスト仮想化 (低) ⏭️ スキップ (現状では必要なし)

### 対象
- 50行以上のテーブル/リスト

### 対策
```bash
npm install react-window
```
```typescript
import { FixedSizeList } from 'react-window';

<FixedSizeList
    height={500}
    itemCount={items.length}
    itemSize={50}
    width="100%"
>
    {({ index, style }) => (
        <div style={style}>{items[index].name}</div>
    )}
</FixedSizeList>
```

---

## 作業チェックリスト

- [x] 1. N+1クエリ修正 (daily-reports API) - selectで必要なフィールドのみ取得
- [x] 2. ページネーション実装 (estimates, customers, project-masters) - 既存+新規実装
- [x] 3. useMemo追加 (daily-reports, invoices, estimates ページ)
- [x] 4. dynamic import実装 (モーダルコンポーネント)
- [x] 5. 未使用ライブラリ削除 - jspdfはPDF生成で実際に使用中のためスキップ
- [x] 6. デバウンスフック作成・適用 (hooks/useDebounce.ts)
- [x] 7. next.config.js最適化
- [x] 8. Context最適化 (DailyReportContext)
- [x] 9. リスト仮想化 - 現状では必要なしのためスキップ

---

## 参考: 影響度の高いファイル一覧

| ファイル | 問題 | 優先度 |
|----------|------|--------|
| `app/api/daily-reports/route.ts` | N+1クエリ | 高 |
| `app/api/estimates/route.ts` | ページネーションなし | 高 |
| `app/api/customers/route.ts` | ページネーションなし | 高 |
| `app/daily-reports/page.tsx` | メモ化なし | 高 |
| `components/ProjectMasterForm.tsx` | 大きすぎる (988行) | 高 |
| `components/EstimateForm.tsx` | 大きすぎる (620行) | 中 |
| `contexts/DailyReportContext.tsx` | Context最適化なし | 中 |
| `next.config.js` | 最適化設定なし | 中 |

---

## 次回作業時の開始手順

1. このファイルを確認し、未完了タスクを把握
2. 優先度「高」の項目から順に着手
3. 完了したタスクにチェックを入れる
4. 各修正後、動作確認を行う
