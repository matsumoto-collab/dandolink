# DandoLink プロジェクト辛口評価レポート

> **評価日**: 2026-02-09
> **総合評価**: **65点/100点**（IMPROVEMENT_STATUS.mdの自己評価92点は過大評価）

---

## ❌ 致命的な問題点

### 1. テストが壊れている

```
Test Suites: 7 failed, 58 passed
Tests: 21 failed, 688 passed
```

- テストサイクルが回っていない状態で「本番運用可能」と記載しているのは危険
- CI/CDで失敗してもマージできる運用になっている可能性

### 2. カバレッジが31%で停滞

- TESTING_STATUS.mdに「目標40%→進行中」とあるが進んでいない
- **コンポーネントのカバレッジがほぼ0%**：UIが壊れても気づかない
- `lib/auth.ts`, `lib/profitDashboard.ts` が0%：認証・コア機能がテストなし

---

## 🟠 アーキテクチャの問題

### 3. MainContent.tsx がアンチパターン

```tsx
// MainContent.tsx がページルーターのように動作
switch (activePage) {
    case 'schedule': return <WeeklyCalendar />;
    case 'settings': return <SettingsPage />;
    // ...
}
```

- **Next.js App Routerを使っているのにCSRでページ切り替え**
- SEO無視、初回ロード最適化できない、URLと状態が乖離
- Route Groupsを作ったのに活かしていない

### 4. calendarStore.ts が898行のGod Object

- 案件、日報、休暇、備考、表示設定、職長管理...すべてが1ファイル
- 「責務の分離」ができていない
- テストしにくく、バグを埋め込みやすい構造

### 5. 残っているContextとZustandの混在

- `AssignmentContext`, `NavigationContext`, `ProfitDashboardContext` がContext
- 他はZustand
- **統一されていない状態管理は認知負荷を上げる**

---

## 🟡 コード品質の問題

### 6. `any`型の乱用

テストコードだけで200箇所以上の`any`使用：

```typescript
} as any); // Cast for simplified mock
(selector: any) => {...}
```

- 型安全性を完全に放棄している箇所が多い
- プロダクションコードにも影響

### 7. ESLint設定が最小限

```json
{
  "extends": ["next/core-web-vitals"]
}
```

- これだけでは品質を担保できない
- `@typescript-eslint/recommended`, `prettier`連携なし

### 8. README.mdが古い

```markdown
### 今後の実装予定
- ガントチャート表示  ← 本当に予定？
- 認証機能  ← もう実装済み
```

- ドキュメントがメンテされていない

---

## 🟢 評価できる点

| 良い点 | 詳細 |
|--------|------|
| ✅ TypeScript strict mode | `noUnusedLocals`, `noImplicitReturns`など有効 |
| ✅ API統一ユーティリティ | `lib/api/utils.ts`でエラーハンドリング統一 |
| ✅ Zustand移行の実行 | 12コンテキストを整理した実績 |
| ✅ Prismaスキーマ設計 | インデックス適切、リレーション正しい |
| ✅ Rate Limiting実装 | API保護の仕組みがある |
| ✅ E2Eテスト基盤 | Playwright設定済み |

---

## 📊 スコア内訳

| カテゴリ | 点数 | 理由 |
|----------|------|------|
| アーキテクチャ | 12/20 | MainContentのCSR切り替え、Storeの肥大化 |
| コード品質 | 10/20 | any型乱用、ESLint不十分 |
| テスト | 8/20 | 31%カバレッジ、テスト失敗状態 |
| セキュリティ | 15/15 | API認証、Rate Limiting実装済み |
| ドキュメント | 5/10 | READMEが古い、IMPROVEMENT_STATUSは良い |
| 開発体験 | 15/15 | Zustand移行、hooks整理は完了 |
| **合計** | **65/100** | |

---

## 🎯 優先度別 改善タスク

### 優先度: 最高（今すぐ）

| タスク | 工数 | 効果 |
|--------|------|------|
| テストを通す（21個の失敗修正） | 小 | CIを健全に戻す |
| READMEを現状に更新 | 小 | オンボーディング改善 |

### 優先度: 高

| タスク | 工数 | 効果 |
|--------|------|------|
| MainContent.tsxを廃止しApp Router完全移行 | 大 | SSR/SEO対応、パフォーマンス向上 |
| calendarStore.tsを3-4ファイルに分割 | 中 | 保守性向上、テスト容易化 |
| 残りContextをZustand移行 | 小 | 状態管理の統一 |

### 優先度: 中

| タスク | 工数 | 効果 |
|--------|------|------|
| ESLint強化（`@typescript-eslint/strict`） | 小 | コード品質担保 |
| コンポーネントテスト追加 | 大 | UI変更時の安全性 |
| `any`型の排除 | 中 | 型安全性向上 |

### 優先度: 低

| タスク | 工数 | 効果 |
|--------|------|------|
| DBリファクタリング Phase 2（JSONフィールド正規化） | 大 | クエリ効率化 |
| SWR/React Query導入 | 中 | キャッシュ戦略改善 |

---

## 結論

技術的負債の整理は進んでいるが、**「本番運用可能な品質」という自己評価は楽観的すぎる**。

テストが壊れた状態でデプロイを続けると、いずれ重大なバグを見逃す。まずは**テストを全て通す**ことを最優先にすべき。
