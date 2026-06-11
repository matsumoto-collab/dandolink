# 安全書類作成機能 要件定義書 v1.2

| 項目 | 内容 |
|---|---|
| 作成日 | 2026-06-11（v1.1: 同日 発注者決定事項を反映 / v1.2: 同日 コードベース突き合わせレビュー反映） |
| 対象システム | DandoLink（施工管理システム / Next.js 14 + Prisma + Supabase） |
| 関連資料 | `docs/SAFETY_DOCUMENTS_RESEARCH.md`（業界調査）、`docs/SAFETY_DOCUMENTS_PLAN.md`（ロードマップ） |
| 想定読者 | 実装を担当するSE |

---

## 1. 背景・目的

足場施工業である自社は、現場入場時に元請へ安全書類（グリーンファイル）を提出する義務がある。現状は元請ごとのExcel様式へ毎回手入力しており、作業員・車両・機械の同じ情報を案件のたびに転記している。

本機能の目的:
1. 作業員・車両・機械等の情報を**マスターとして一元管理**する
2. 案件と対象（作業員等）を選択するだけで**安全書類PDFを自動生成**する
3. 元請指定システム（グリーンサイト・CCUS）への転記作業を楽にする（データの一覧性確保）

## 2. スコープ

### フェーズ分割（本書はPhase 1を詳細定義、Phase 2以降は概要）

| Phase | 内容 | 本書での詳細度 |
|---|---|---|
| 1 | 作業員マスター（安全情報）拡張 ＋ 作業員名簿PDF | **詳細（実装対象）** |
| 2 | 車両・機械マスター拡張 ＋ 車両届・持込機械届・クレーン等使用届 | 概要 |
| 3 | 再下請負通知書（協力会社の許可情報管理含む） | 概要 |
| 4 | 新規入場時教育報告書・安全衛生計画書・一括出力 | 概要 |

### スコープ外（明示）

- グリーンサイト / CCUS とのAPI連携（API公開が限定的なため。将来検討）
- 元請からの受領書類の管理（本機能は「自社が作成・提出する」書類が対象)
- 押印・電子署名機能（全建統一様式 改訂6版で押印欄は廃止済み）

## 3. 用語

| 用語 | 意味 |
|---|---|
| 安全書類（グリーンファイル） | 現場入場前に下請が元請へ提出する労務安全書類の総称 |
| 全建統一様式 | 全国建設業協会発行の業界標準様式。最新は改訂6版（2024-10） |
| 作業員名簿 | 全建統一様式第5号。現場の全作業員の情報一覧。最頻出書類 |
| CCUS | 建設キャリアアップシステム。技能者ID・事業者IDを持つ |
| グリーンサイト | 元請が指定するWeb提出システムの一つ |

## 4. 基本方針（アーキテクチャ）

1. **マスター駆動**: 書類に載る情報は全てマスターに保持。書類作成は「案件選択 → 対象選択 → 生成」のみ。
2. **項目は和集合**: 全建統一様式の項目＋元請独自項目（性別、労災特別加入など。§7参照）をマスターに持ち、どの元請様式にも出力可能にする。
3. **出力テンプレート切替**: PDF出力層を様式テンプレートとして分離。Phase 1は「全建統一様式準拠（標準）」1種。元請別テンプレート（例: 三井住友建設様式）は将来追加できる構造にする。
4. **スナップショット保存**: 生成した書類は生成時点のデータをJSONで保存（提出後にマスターが変わっても提出内容を再現可能。保存義務5年に対応）。
5. **既存慣習への準拠**: API・UI・PDF・マイグレーションはDandoLinkの既存パターンに従う（§10）。

## 5. 機能要件（Phase 1）

### FR-1 作業員マスター（安全情報）

- FR-1-0: **対象は `Worker`（職方マスター）と `User` の両方**（発注者決定）。安全プロフィールはどちらにも紐付け可能とする。実装方式は `WorkerSafetyProfile` に `workerId?` / `userId?` を持たせ、**どちらか一方のみ必須**（両方null・両方設定はDB制約で禁止、各々unique。実装注意は§7.1補足）。既存の `Worker` / `User` モデル自体は変更しない。
- FR-1-0b: **`User` は自社社員専用ではない**点に注意。協力会社アカウント（`role='PARTNER'`、`companyId` で親子）やログイン不可の手配用メンバー（`role='support'`）が同居している。協力会社メンバーを「一次下請の作業員として名簿に正規記載する」運用が実在するため（発注者確認 2026-06-11）、**PARTNER 含む全ロールを紐付け対象とし、紐付け自体に制限は設けない**。書類作成画面の見せ方で臨機応変に対応する（FR-2-2: グループ表示＋初期表示は自社系）。
- FR-1-1: 安全書類用プロフィールは **1:1の別モデル `WorkerSafetyProfile`** として追加する（既存機能への影響回避）。
- FR-1-2: 入力項目は §7.1 の通り。全項目任意入力（部分的に埋めて運用開始できること）。
- FR-1-3: 資格・教育は `WorkerQualification` として1人にN件登録できる（種別: 雇入・職長・特別教育 / 技能講習 / 免許）。
- FR-1-4: 設定画面のタブとして「作業員 安全情報」編集UIを追加。タブ構成: 基本情報 / 連絡先 / 保険・建退共 / 資格・教育 / 健康。
- FR-1-5: 入力補助: 血液型・保険区分・属性記号はプルダウン/チェックボックス。資格名はよく使う足場系資格（足場の組立て等作業主任者、同特別教育、玉掛け、フルハーネス特別教育、小型移動式クレーン等）をサジェスト。

### FR-2 作業員名簿の作成

- FR-2-1: 新画面「安全書類」で書類を新規作成できる。**実装はメインアプリのSPA構造に従う**: `contexts/NavigationContext.tsx` の `PageType` に `'safety-documents'` を追加し、MainContent の switch と Sidebar メニューに組み込む。独立App Routerルート（`app/(master)/` 配下の単独ページ）にはSidebarが付かないため**採用しない**。プログラム遷移・通知リンクは `/?page=safety-documents` 形式。
- FR-2-2: 作成フロー: ①書類種別選択（Phase 1は作業員名簿のみ）→ ②案件選択（ProjectMaster から検索。未登録現場用に手入力も可）→ ③ヘッダー情報入力（元請の事業所名・所長名、自社の次数（一次/二次…）、提出日）→ ④作業員を複数選択（チェックボックス。**自社社員(User)・職方(Worker)・協力会社(role=PARTNER の User)を統合した一覧**から選択。一覧は「自社社員 / 職方 / 協力会社」のグループ見出し付きで表示し、**初期表示は自社系・協力会社は折りたたみ（トグルで展開）**。協力会社メンバーを一次下請として正規記載するケースがあるため選択自体に制限は設けない）→ ⑤プレビュー → ⑥保存・PDF出力。
- FR-2-3: 作業員の並び順は手動で並び替え可能。
- FR-2-4: 選択した作業員の必須情報（氏名・生年月日・健康診断日等）が欠けている場合、警告表示する（生成自体はブロックしない）。
- FR-2-5: 保存済み書類の一覧（案件・種別・作成日で検索）、複製（前回の書類をベースに新規作成）、編集、削除ができる。**削除は `deletedAt` による論理削除（admin/manager 可）とし、物理削除機能は設けない**（5年保存要件・§8と整合。既存 BillingDraft の論理削除と同パターン）。

### FR-3 PDF出力（作業員名簿・全建統一様式第5号準拠）

- FR-3-1: A4横。@react-pdf/renderer を使用（既存PDF基盤に準拠、§10.3）。
- FR-3-2: レイアウトは全建統一様式 改訂6版「準拠」の独自実装（完全コピーではなく項目を網羅）。押印欄なし。
- FR-3-3: 1ページあたりの作業員数を超える場合は自動改ページ（ヘッダーは各ページに再掲）。
- FR-3-4: 健康保険・年金保険・雇用保険は区分名を出力。**番号は雇用保険の下4桁のみ**出力。
- FR-3-5: 画面プレビューとダウンロードの両対応。ウィザード内のプレビューは見積書/請求書で確立済みの **LivePdfPreviewパターン**（`components/ui/LivePdfPreview.tsx`＋`hooks/usePdfPreviewVisible`＋`components/ui/PdfPreviewToggle`。lg+で左右分割・表示トグルをlocalStorage永続）に従う。全画面確認には既存 `<PdfViewer />` も利用可。
- FR-3-6: **印刷対応**（発注者要望）: プレビューから直接印刷できること。**既存 `PdfViewer` はreact-pdfのcanvas描画で印刷機能を持たない**ため、印刷ボタンは「生成PDFのblob URLを新規タブで開き、ブラウザ内蔵PDFビューアの印刷を使う」方式で追加実装する（canvasに対する `window.print()` は崩れるため不可）。印刷時にレイアウト崩れがないことを受け入れ条件とする。
- FR-3-7: **年齢はスナップショットに保存された提出日を基準に算出する**（「今日」基準にしない）。これにより後日再生成しても同一の紙面になる（受け入れ基準4の決定性を担保）。

### FR-4 書類データの保存

- FR-4-1: `SafetyDocument` モデルに保存（type / projectId / title / data(Json: スナップショット) / createdBy / createdAt / updatedAt / deletedAt）。
- FR-4-2: PDF再生成は常にスナップショットから行う（マスターの現在値ではない）。年齢など派生値の算出基準日（提出日）もスナップショット内に持つ（FR-3-7）。
- FR-4-3: 「マスターの最新値で更新」ボタンでスナップショットを再取得できる。

### FR-5 Excelインポート（**Phase 1 必須**・発注者決定）

- FR-5-1: 手持ちの作業員名簿Excel（全建統一様式系）から作業員マスターへ一括取込できる。初期データ投入の負担軽減が目的。ファイル形式は **.xls / .xlsx 両対応**（発注者確認: どちらの形式も持ち込まれ得る）。
- FR-5-2: 取込フロー: ①xlsx/xlsファイル選択 → ②シート選択 → ③列マッピングUI（Excel列 ⇔ プロフィール項目の対応付け。様式が元請ごとに異なるため固定マッピングにしない）→ ④プレビュー（取込予定データと警告表示）→ ⑤実行。**パースはクライアントサイドで完結させ、サーバーへはマッピング済みの構造化JSONのみ送信する**（`POST api/safety-profiles/import` はファイルを受けない。サーバーにファイルパーサを置かないことで攻撃面を縮小し、既存のzodバリデーション慣習にも乗せる）。
- FR-5-2b: **パーサライブラリの指定**: SheetJS **公式レジストリ版**（`https://cdn.sheetjs.com` 配布のtgzを package.json に直接指定。.xls/.xlsx両対応）を使用する。**npmレジストリ版 `xlsx`（0.18.5で更新停止・Prototype Pollution/ReDoSの既知脆弱性が残置）は導入禁止**（直近の監査で依存脆弱性を削減済みのため逆行させない）。インポート画面でのみ動的importし、バンドルへの影響を抑える。
- FR-5-3: 既存作業員と氏名一致した場合は「更新/スキップ」を選択できる。**氏名一致の判定は Worker と User を横断して行う**（同一人物の二重登録を防ぐ。どちらにも居ない場合の新規作成先は `Worker`）。
- FR-5-4: §7.4の禁止項目（健康保険番号等）に該当する列はマッピング先を提供しない。

### Phase 2〜4 概要（参考）

- Phase 2: `Vehicle` 拡張（車番・車種・任意保険）＋ `Machine` マスター新設 → 工事・通勤用車両届 / 持込機械等使用届 / クレーン等使用届。運転者・オペレーター選択時に資格保有を自動チェック。
- Phase 3: 協力会社（Customer または新モデル）に建設業許可・保険加入状況を追加 → 再下請負通知書。
- Phase 4: 新規入場時等教育実施報告書・工事安全衛生計画書、案件単位の一括PDF出力（グリーンファイルセット）。

## 6. 画面要件

| # | 画面 | 配置 | 概要 | 権限 |
|---|---|---|---|---|
| S-1 | 作業員 安全情報編集 | 設定 > **新規タブ「作業員 安全情報」** | FR-1のタブ式フォーム | admin / manager |
| S-2 | 安全書類一覧 | 新メニュー「安全書類」（`PageType` 追加） | 保存済み書類の検索・複製・削除（論理削除） | admin / manager |
| S-3 | 書類作成ウィザード | S-2から遷移 | FR-2のフロー | admin / manager |
| S-4 | PDFプレビュー | S-3内 | LivePdfPreview分割表示＋PdfViewer全画面・DL・印刷（FR-3-5/3-6） | admin / manager |

- S-1 注記: 既存の設定画面に「作業員」タブは**現存しない**（現状タブ: 車両管理/総メンバー数/工事種別/…/ユーザー管理/協力会社。Worker は名前＋単価のみの汎用リスト管理）。安全情報のタブ式フォームは汎用リスト管理の枠に収まらないため、**新規タブとして追加**する。
- モバイル対応: S-1〜S-4はPC優先（事務作業のため）。閲覧のみレスポンシブ対応できれば尚良。
- ナビゲーション: `PageType` に `'safety-documents'` を追加し Sidebar・MainContent に組み込む（FR-2-1）。権限制御は既存 `hasPermission` に従う。

## 7. データ要件

### 7.1 WorkerSafetyProfile（新規・Worker または User と1:1）

| グループ | フィールド | 型 | 備考 |
|---|---|---|---|
| 紐付け | workerId | String? @unique | Worker参照。userId と排他 |
| | userId | String? @unique | User参照。workerId と排他（CHECK制約: 必ず一方のみ） |
| 基本 | furigana | String? | |
| | birthDate | DateTime? | 年齢は保存せず、提出日基準で算出して出力（FR-3-7） |
| | gender | String? | 男/女（SMCR様式等で必要） |
| | jobType | String? | とび・足場 等 |
| | attributes | String[] | 現/主/女/未/基/技/職/安/能/再/習 |
| | hireDate | DateTime? | 雇入年月日 |
| | experienceYears | Int? | 職種の通算経験年数 |
| | workerCategory | String? | 労働者/一人親方/中小事業主 |
| 連絡先 | address / tel | String? | 現住所・本人TEL |
| | familyContact / familyTel | String? | 緊急連絡先（家族） |
| 健康 | healthCheckDate | DateTime? | 雇入時＋年1回（労安法66条） |
| | bloodPressure | String? | "120-80" 形式 |
| | bloodType | String? | A/B/O/AB |
| | specialHealthCheckDate | DateTime? | 有害業務従事者は半年に1回 |
| | specialHealthCheckType | String? | じん肺/有機溶剤/石綿 等 |
| 保険 | healthInsurance | String? | 健康保険組合/協会けんぽ/建設国保/国民健康保険/適用除外 |
| | pensionInsurance | String? | 厚生年金/国民年金/受給者 |
| | employmentInsurance | String? | 雇用保険/日雇保険/適用除外 |
| | employmentInsuranceLast4 | String? | **下4桁のみ** |
| | rosaiSpecialInsurance | Boolean? | 労災保険特別加入（一人親方等） |
| | kentaikyo / chutaikyo | Boolean? | 建退共・中退共 加入有無 |
| | kentaikyoTechou | Boolean? | 建退共手帳所有（元請様式で必要） |
| その他 | ccusId | String? | CCUS技能者ID |
| | notes | String? | 備考 |

**補足（排他制約の実装）**: Prisma は CHECK 制約を schema.prisma で表現できないため、手動マイグレーションSQL側で `CHECK (num_nonnulls(worker_id, user_id) = 1)` を付与する。`@unique` 2本だけでは「両方NULL」の行が複数作れてしまう（PostgreSQL の NULL は unique 非衝突）点に注意。

### 7.2 WorkerQualification（新規・Profile と1:N）

| フィールド | 型 | 備考 |
|---|---|---|
| category | String | special_education / skill_training / license |
| name | String | 資格・教育名 |
| acquiredAt | DateTime? | 取得日 |
| expiresAt | DateTime? | 有効期限（あれば。将来のアラート用） |

### 7.3 SafetyDocument（新規）

| フィールド | 型 | 備考 |
|---|---|---|
| type | String | Phase1: `sagyoin_meibo` のみ |
| projectId | String? | ProjectMaster参照（手入力現場はnull）。FKは `onDelete: SetNull`（スナップショットに現場名を持つため案件削除後も書類は自立） |
| title | String | 一覧表示用 |
| data | Json | ヘッダー（**提出日含む**・FR-3-7）＋作業員スナップショット＋並び順 |
| createdBy | String? | User.id |
| createdAt / updatedAt | DateTime | |
| deletedAt | DateTime? | 論理削除（FR-2-5）。一覧・取得APIは `deletedAt: null` のみ返す |

### 7.4 ⚠️ 法令上の禁止事項（DBに列を作ってはならない）

- **健康保険の記号・番号**（健康保険法改正 2020-10、告知要求制限）
- **基礎年金番号**（国民年金法108条の4）
- 雇用保険のみ「下4桁」可。マイナンバーも保持しない。

## 8. 非機能要件

| 分類 | 要件 |
|---|---|
| セキュリティ | 作業員安全情報・安全書類のAPIは admin / manager のみアクセス可（既存 `requireManagerOrAbove()`＝`lib/api/utils.ts` を使用）。foreman以下・partnerは不可（※partnerロールの**ログインユーザー**がアクセスできないことと、PARTNER の User を名簿の**記載対象**にできること〔FR-1-0b〕は両立する別概念） |
| 個人情報 | §7.4の禁止項目を持たない。プロフィール閲覧はUI上もadmin/managerに限定。Supabase RLSは既存方針に従う |
| 監査 | SafetyDocument の作成・更新・削除は createdBy/updatedAt で追跡（既存の監査慣習レベルで可） |
| 保存性 | 書類スナップショットは5年以上保持可能であること。削除は `deletedAt` 論理削除のみで**物理削除機能は設けない**（FR-2-5） |
| マルチテナント | 新テーブル3つに tenant 列・RLSポリシーは**設けない**（自社版は単一テナント継続、SaaSは別プロジェクトで多社化の方針〔2026-05-16確定〕のため。§12 #10） |
| 性能 | 作業員50名規模・書類100件規模で一覧/生成が3秒以内目安 |
| 文字 | PDF日本語フォントは既存の Noto Sans JP 登録（`components/pdf/styles.ts`）を流用。`sanitizePdfText()` 適用 |

## 9. API要件（推奨設計）

既存慣習（`app/api/master-data/{resource}/route.ts`、認証ヘルパー、`{data, pagination}` 形式）に準拠。

| メソッド/パス | 用途 |
|---|---|
| GET `api/safety-profiles` | 一覧（Worker/User統合。各行は `{ source: 'worker'\|'user', id, name, role?, profile? }` 形で返し、フロントの一意キーは `worker:{id}` / `user:{id}` の合成形式とする。書類作成画面の選択肢用） |
| GET/PUT `api/safety-profiles?workerId=...` / `?userId=...` | 安全プロフィール取得・更新（upsert）。**パスIDではなくクエリで対象を指定**する（Worker=uuid と User=cuid で id 空間が異なり、`[id]` が何のIDか曖昧になるため）。PUT 応答に `profile.id` を含める |
| GET/POST `api/safety-profiles/[profileId]/qualifications`、DELETE `.../qualifications/[qid]` | 資格CRUD。プロフィール未保存の対象に資格を付ける場合は、先に空プロフィールを upsert してから登録する（UIはこの順を自動で行う） |
| POST `api/safety-profiles/import` | Excelインポート（FR-5）。**マッピング済み構造化JSONを受ける（ファイルは受けない）**。zodで §7.1 のスキーマ検証 |
| GET/POST `api/safety-documents`、GET/PUT/DELETE `api/safety-documents/[id]` | 書類CRUD。DELETE は `deletedAt` 論理削除（FR-2-5） |
| POST `api/safety-documents/[id]/refresh` | スナップショット再取得（FR-4-3） |

PDF生成はクライアントサイド（@react-pdf/renderer）で行う既存方式に合わせ、専用APIは不要。

## 10. 実装ガイド（既存コードの参照先）

| 項目 | 参照 |
|---|---|
| マスターCRUD API | `app/api/master-data/vehicles/route.ts` / `app/api/master-data/workers/route.ts` 等。認証は `requireAuth()` / `requireManagerOrAbove()`（**`lib/api/utils.ts`**） |
| 画面ナビゲーション | `contexts/NavigationContext.tsx`（`PageType`）＋ MainContent の switch ＋ Sidebar の3点セットで追加（FR-2-1）。独立App RouterルートにはSidebarが付かないため不可。プログラム遷移は `/?page=safety-documents` |
| 設定画面タブUI | `app/(master)/settings/page.tsx` ＋ 各 `*Settings` コンポーネント（S-1は新規タブとして追加。S-1注記参照） |
| PDFテンプレート | `components/pdf/EstimatePDF.tsx` / `InvoicePDF.tsx`。共通スタイル `components/pdf/styles.ts`、全画面ビューア `components/ui/PdfViewer.tsx`、ライブプレビュー `components/ui/LivePdfPreview.tsx`＋`hooks/usePdfPreviewVisible`＋`components/ui/PdfPreviewToggle`（FR-3-5） |
| Excelパーサ | SheetJS 公式レジストリ版（`https://cdn.sheetjs.com` のtgzを package.json に直接指定。FR-5-2b）。インポート画面でのみ動的import。npmレジストリ版 `xlsx` は導入禁止 |
| 命名 | PDF: `components/pdf/SagyoinMeiboPDF.tsx` のように `{DocumentName}PDF.tsx` |
| マイグレーション | 新規テーブル追加のみの最小SQLとし、`docs/manual-migrations/` に `日付_説明.sql` で記録する運用（README参照）。`prisma migrate dev` の自動diffは既存ドリフトがあるため注意。`WorkerSafetyProfile` の排他は SQL 側で `CHECK (num_nonnulls(worker_id, user_id) = 1)` を付与（§7.1補足） |
| 権限定義 | `utils/permissions.ts` の `ROLE_PERMISSIONS` にリソース `safetyDocuments` を追加（admin/manager のみ view/create/edit/delete、他ロールは空配列） |
| テスト | `__tests__/` 配下に構造ミラーで配置。API・純関数（スナップショット生成・年齢計算・改ページ計算）は単体テスト必須。UIテストは隔離中のCI事情により追加しない（API層・純関数に限定） |

## 11. 受け入れ基準（Phase 1）

1. 作業員に安全情報・資格を登録でき、再読込後も保持される
2. 案件＋作業員5名を選択して作業員名簿を作成 → 全建統一様式第5号準拠のA4横PDFが出力される（押印欄なし、保険は区分のみ、雇用保険は下4桁）
3. 作業員11名以上で自動改ページされ、各ページにヘッダーが出る
4. 保存した書類を後日開いてもPDFが同一内容で再生成される（マスター変更・経過日数の影響を受けない。**年齢も提出日基準で不変**＝FR-3-7）
5. foreman/worker/partnerロールでは安全書類メニュー・APIにアクセスできない（403）
6. 健康保険番号・基礎年金番号の入力欄・DB列が存在しない（Excelインポートのマッピング先にも存在しない）
7. 自社社員（User）・職方（Worker）・協力会社メンバー（role=PARTNER の User）を1つの名簿に混在させて出力できる。書類作成画面の初期表示は自社系で、協力会社はトグル展開で選択できる
8. Excel（**.xls / .xlsx の両形式**）から作業員10名分を列マッピングで取込み、マスターに反映される
9. プレビューから印刷した紙面がレイアウト崩れなく出力される
10. 書類を削除しても DB 上にレコードが残る（`deletedAt` 論理削除）。一覧には表示されない
11. `npx tsc --noEmit`・`npm run lint`・`npm run build` がエラーなく通る

## 12. 決定事項（2026-06-11 発注者確認済み。#6〜#10 は発注者一任に基づく v1.2 裁定）

| # | 事項 | 決定 |
|---|---|---|
| 1 | メニュー名称 | **「安全書類」** |
| 2 | 安全書類の対象 | **Worker と User の全員（PARTNER 含む）**。協力会社メンバーを一次下請として正規記載する運用があるため制限しない。書類作成画面はグループ表示・初期表示は自社系で臨機応変に対応（FR-1-0b / FR-2-2） |
| 3 | Excelインポート（FR-5） | **Phase 1 に含める（必須）**。ファイル形式は .xls / .xlsx 両対応 |
| 4 | 元請別テンプレート（SMCR様式等） | **Phase 4以降**。当面は全建統一様式準拠の標準様式で運用 |
| 5 | PDF印刷 | プレビューからの印刷・PDFダウンロードの両方に対応（FR-3-6） |
| 6 | Excelパーサ | クライアントサイドパース＋SheetJS公式レジストリ版。npmレジストリ版 `xlsx` は脆弱性残置のため導入禁止（FR-5-2/2b） |
| 7 | 年齢の算出基準 | スナップショット内の**提出日**基準。「今日」基準にしない（FR-3-7。再生成の決定性担保） |
| 8 | 書類の削除 | `deletedAt` 論理削除のみ。物理削除機能は設けない（FR-2-5。5年保存と整合） |
| 9 | 画面配置 | メインSPAの `PageType` 追加方式。独立App Routerルートは不採用（FR-2-1）。設定画面の安全情報は新規タブ（S-1注記） |
| 10 | マルチテナント | 新テーブルに tenantId/RLS は設けない（SaaSは別プロジェクト方針〔2026-05-16確定〕のため。§8） |
