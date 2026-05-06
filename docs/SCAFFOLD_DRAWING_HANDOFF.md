# 現場調査（図面）機能 — セッション引き継ぎ

最終更新: 2026-05-06

このドキュメントは、Cowork セッションをまたいで作業を引き継ぐための要約です。
新しいセッションを開始した時、`docs/SESSION_STARTER.md` の内容を貼り付けるだけで、
このドキュメントを読みに来るように指示できる形にしてあります。

---

## 1. 役割分担

- **私（ユーザー / kei）**: プログラミング超初心者。要望・フィードバックを伝える側
- **Cowork のあなた（Claude）**: プランナー / 設計役。要望を整理して **Claude Code 用の指示文** を作る
- **別の Claude Code セッション**: 実装作業をする（npm dev 起動・コード編集・確認）

Cowork からは **コードは書かない**。指示文を作って貼り付けてもらう運用。

---

## 2. プロジェクト

- パス: `C:\Users\yushink\Desktop\yusystem`
- 設計書: `docs/SCAFFOLD_DRAWING_SPEC.md`（必読）
- ローカル: `npm run dev` → `http://localhost:3001/`
- **本番DB に接続中**: `prisma migrate` 系は私が手動で実行する
- Vercel デプロイは禁止（ローカル確認のみ）

---

## 3. 現状の達成度

### Phase 1（描画コア） — ほぼ完成

- ✅ 矢印 4 方向タップで壁追加
- ✅ 連続描画（壁追加後、新終端点に矢印継続）
- ✅ 多角形を閉じる
- ✅ 複数セクション（独立図形 + 既存点からの枝分かれ）
- ✅ 10cm 方眼（適応的な濃淡）
- ✅ ズーム（+ / − / 全体表示）+ マウスホイール
- ✅ パン（ドラッグで視点移動、8px 閾値でタップ判定と両立）
- ✅ 自動計算（外周・床面積・足場面積、セクション合算）
- ✅ ボトムシートとズームボタンの非干渉化
- ✅ undo（戻る）、リセット
- ✅ サイドバー「図面」、`/site-surveys` 一覧、フルスクリーンエディタ（URL 不変）
- ✅ 案件詳細モーダルの「現場調査」タブ → サマリーリスト + 新規作成ボタン
- ✅ DB 永続化（手動マイグレ完了 / 一覧自動リフレッシュ / dirty 判定修正）
- ✅ マーカー機能（4 色・水平/垂直直線・端点からの継続描画）
- ✅ テキスト機能（自由テキスト + 付箋風表示 + ドラッグ移動）
- ✅ 開口の指定（壁タップ → 位置・幅入力 + 編集 / 削除）

### Phase 1（残り）

- ❌ 見積書連携（§3.7「この調査から見積作成」）

### Phase 2 以降

- ❌ PDF 出力
- ❌ 屋根形状
- ❌ 周辺情報

---

## 4. 主要ファイル

### データ層
- `prisma/schema.prisma` — `SiteSurvey` モデル定義済み（マイグレ未）
- `types/site-survey.ts` — フロント型定義
- `stores/siteSurveySlices/types.ts` — drawingData の型
- `stores/siteSurveySlices/drawingSlice.ts` — Zustand ストア（点・壁・セクション管理、undo）
- `stores/siteSurveySlices/editorOpenSlice.ts` — エディタ開閉の状態（URL 不変オーバーレイ用）

### API
- `app/api/site-surveys/route.ts` — GET / POST（テーブル無の場合は 503 / 空配列でフォールバック）
- `app/api/site-surveys/[id]/route.ts` — GET / PATCH / DELETE
- `hooks/useSiteSurveys.ts` — `useSiteSurveys` / `useSiteSurvey` フック

### UI
- `components/SiteSurvey/SiteSurveyEditor.tsx` — フル画面エディタ（保存・リセット・統計・ズーム・パン）
- `components/SiteSurvey/SiteSurveyEditorOverlay.tsx` — Zustand 経由でオーバーレイ表示
- `components/SiteSurvey/ArrowInputController.tsx` — 4 方向矢印・タップ・パン・点選択
- `components/SiteSurvey/DrawingCanvas.tsx` — react-konva 描画（方眼・壁・寸法ラベル）
- `components/SiteSurvey/LengthInputSheet.tsx` — 長さ入力ボトムシート（プリセット 1000-10000）
- `components/SiteSurvey/BottomSheet.tsx` — 共通ボトムシート UI
- `components/ProjectMaster/SiteSurveyTab.tsx` — 案件詳細内のサマリーリスト

### ページ
- `app/(finance)/site-surveys/page.tsx` — 一覧（`/site-surveys`）
- `app/(finance)/site-surveys/new/page.tsx` — 新規（直リンク用、URL 経由のみ）
- `app/(master)/site-surveys/[id]/page.tsx` — 編集（直リンク用、URL 経由のみ）
- `app/(calendar)/page.tsx` — `<SiteSurveyEditorOverlay />` をマウント
- `components/MainContent.tsx` — `case 'site-surveys'` で `<SiteSurveyListPage />`
- `components/Sidebar.tsx` — 「図面」項目
- `contexts/NavigationContext.tsx` — `'site-surveys'` を PageType に追加

### ユーティリティ
- `utils/drawingMath.ts` — 計算系（snapToGrid, chooseGridSpacing, computeStats, computeTotalStats, fitToCanvas, etc.）

---

## 5. 次のタスク（見積書連携 §3.7）

現場調査の図面・実測値から見積書を生成する導線を実装する。
**着手前に kei と以下 3 点を相談すること**:

1. **起動経路** — 現場調査の編集画面から「見積作成」ボタンか、見積書側に
   「現場調査から取り込む」ボタンを置くか。両方か
2. **流し込む数値** — 外周 / 床面積 / 足場面積 / 軒高 のうちどれを
   どの見積項目に自動投入するか。単価マスターとの紐付けはどうするか
3. **案件紐付け** — `SiteSurvey.projectMasterId` が紐付いている場合と
   未紐付け（null）の場合で挙動を分けるか

### 関連ファイル候補
- `components/Estimate/EstimateForm.tsx`（または同等の見積作成画面）
- 単価マスター関連のフック / API
- `app/api/site-surveys/[id]/route.ts`（取り込み元データ）

---

## 6. 直近の改善履歴（参考）

直近のセッションで以下を順次実装:
1. オーバーレイ方式に変更（URL 不変）
2. 矢印を 8 方向 → 4 方向に変更
3. 連続描画（壁追加後の矢印継続）
4. 点のヒット半径 22px → 40px
5. 寸法ラベルを壁脇に配置 + 白背景
6. ボトムシートをコンパクト化
7. 方眼を 1cm → 10cm に変更
8. ズーム + パン + 全体表示の追加
9. ボトムシート表示中はズームボタン非表示
10. 複数セクション（独立図形 + 枝分かれ）
11. SiteSurvey テーブルを手動マイグレで本番 DB に追加
12. dirty 判定を data スナップショット比較に修正
13. editorOpenSlice に closeVersion を追加し、閉じたタイミングで一覧画面が自動 refresh するように
14. ピン機能を削除し、マーカー（色付き直線）+ テキスト（付箋）に再設計
15. マーカーは水平/垂直軸ロック + 端点からの継続描画対応
16. テキストはドラッグで移動可能、HTML レイヤーで描画

ストア（drawingSlice.ts）には `setStartPoint / startNewSection / setCurrentSection` の API がある。

---

## 7. 守ること

- `prisma migrate` 系コマンドは Cowork から実行しない（私が手動で）
- DragInputController.tsx は将来再利用するため温存
- 既存機能（見積書・案件マスター・カレンダーなど）を壊さない
- 修正は SiteSurvey 関連の最小限に留める
- Vercel へのデプロイは禁止

---

## 8. ボキャブラリ

| 用語 | 意味 |
|---|---|
| セクション (Section) | 1つの独立した図形（本棟・テラスなど） |
| 枝分かれ | 既存セクションの点と同じ座標から始まる新セクション |
| アクティブ点 | 矢印を表示する対象の点（編集中の終端） |
| 閉じる | 多角形の最後の点と最初の点を線で結ぶ |
| 方眼 (グリッド) | 10mm 単位スナップ + 適応的表示間隔 |
| パン | 視点を上下左右にスクロール |
| ズーム | 視野を拡大/縮小 |
