# バグ修正計画

> **作成日**: 2026-02-11
> **目的**: 本番に影響するバグを優先度順に修正する
> **前提**: テストカバレッジ作業(76.79%)は一旦停止し、バグ修正を優先

---

## 修正対象一覧

### #1 useProjects の setTimeout メモリリーク ✅ 修正済み
- **ファイル**: `hooks/useProjects.ts`
- **修正内容**: setTimeout 完了時に `timeoutRefs.current` 配列から該当IDを `filter` で除去するようにした。`addProject`, `updateProject`, `updateProjects` の3箇所すべてに適用。
- **確認**: テストパス、ビルドOK

### #2 useProjects のタイムアウト競合（レースコンディション） ✅ 修正済み
- **ファイル**: `hooks/useProjects.ts`
- **修正内容**: #1 と同時に修正。タイムアウト完了時に配列からIDを除去することで、unmount時のcleanupが確実に機能するようになった。
- **確認**: テストパス、ビルドOK

### #3 収益計算の memberCount 不一致 ✅ 修正済み
- **ファイル**: `lib/profitDashboard.ts`
- **修正内容**: Prismaクエリに `memberCount` フィールドを追加。作業員数の計算を `item.assignment.memberCount || workers.length || 1` に変更し、DBの `memberCount` を優先的に使うようにした。
- **確認**: テストパス、ビルドOK

### #4 PDF生成エラーで無限ローディング ✅ 修正済み
- **ファイル**: `app/(finance)/estimates/[id]/page.tsx`
- **修正内容**: catch ブロックで `toast.error('PDF生成に失敗しました')` を追加し、`setPdfUrl('error')` でエラー状態を設定。JSX側でエラー状態のときにエラーメッセージと「再試行」ボタンを表示するようにした。
- **確認**: ビルドOK

### #5 JSON.parse が try-catch なし ✅ 修正済み
- **ファイル**: `lib/profitDashboard.ts`
- **修正内容**: `JSON.parse()` の直接呼び出しを `parseJsonField()` ユーティリティ（`lib/json-utils.ts`）に置き換え。workers と vehicles の2箇所。不正なJSONでもクラッシュせず空配列にフォールバックする。
- **確認**: テストパス、ビルドOK

### #6 収益ダッシュボードのエラーが無通知 ✅ 修正済み
- **ファイル**: `contexts/ProfitDashboardContext.tsx`
- **修正内容**: catch ブロックに `toast.error('収益データの取得に失敗しました')` を追加。
- **確認**: ビルドOK

### #7 マネージャー名取得失敗が無通知 ✅ 修正済み
- **ファイル**: `components/Projects/ProjectDetailView.tsx`
- **修正内容**: 空の catch ブロックに `console.error('担当者名の取得に失敗しました')` を追加。IDのまま表示するフォールバック動作は維持（トーストは出さない — 軽微なため）。
- **確認**: ビルドOK

### #8 AssignmentTable のエラー表示漏れ ✅ 対応不要
- **ファイル**: `components/Schedule/AssignmentTable.tsx`
- **状況**: 調査の結果、JSX内で `namesLoadError` が既に表示されていた（142行目）。修正不要。

### #9 見積編集が未実装なのにボタンがある ⬜ 未着手
- **ファイル**: `app/(finance)/estimates/[id]/page.tsx` 78行付近
- **問題**: 編集ボタンを押すと「coming soon」トーストが出るだけ。ユーザーが混乱する。
- **修正方針**: (A) ボタンを非表示にする or (B) 実際に編集機能を実装する。要相談。
- **確認方法**: `npm run build` が通ること。

---

## 作業の進め方

1. **1バグ1コミット**で修正する
2. 修正後は必ず `npm run build` と関連テストを実行
3. 問題なければ `git push origin main` でデプロイ
4. コミットメッセージ形式: `fix: <バグの説明>`

## 環境情報

- Next.js 14 (App Router)
- `git push origin main` で自動デプロイ
- テスト: `npx jest --no-coverage <テストファイル>`
- ビルド確認: `npm run build`

## 現在のテスト状況

- 125 スイート / 1,158 テスト / Lines 76.79%
- 全テスト実行: `npx jest --no-coverage`
