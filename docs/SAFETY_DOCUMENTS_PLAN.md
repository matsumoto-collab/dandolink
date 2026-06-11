# 安全書類機能 実装計画（ロードマップ）

作成日: 2026-06-11
前提資料: `docs/SAFETY_DOCUMENTS_RESEARCH.md`
方針: 全建統一様式 改訂6版（令和6年10月）準拠のPDF出力＋データ管理の両対応

---

## 全体像

```
[マスター整備]                    [書類生成]
作業員マスター（拡張）─┐
車両マスター（拡張）  ─┤→ 案件を選ぶ → 作業員/車両/機械を選ぶ → PDF出力
機械マスター（新規）  ─┤           （全建統一様式準拠・押印欄なし）
協力会社マスター（拡張）┘
```

核となる考え方: **マスターに一度入力すれば、現場ごとの書類は選択だけで自動生成**。
入力済みデータ（案件・元請・自社情報）は最大限流用する。

## 現状のDBとのギャップ

| モデル | 現状 | 安全書類に必要な拡張 |
|---|---|---|
| `Worker` | name のみ | 生年月日、住所、連絡先、家族連絡先、血液型、血圧、健康診断日、保険加入区分、建退共/中退共、資格・教育、職種、雇入日、経験年数、CCUS技能者ID 等 |
| `Vehicle` | name のみ | 車番、車種、運転者、免許情報、任意保険（会社・期間・金額） |
| `CompanyInfo` | 許可番号あり | CCUS事業者ID、許可業種詳細（般/特・許可日）程度 |
| `Customer` | あり | 元請の現場情報（所長名）は書類側で入力でも可 |
| （なし） | — | `Machine`（持込機械）、`SafetyDocument`（書類本体）、`WorkerQualification`（資格） |

## フェーズ計画

### Phase 1: 作業員マスター拡張 + 作業員名簿（様式第5号）★最優先

1. **DB**: `Worker` を拡張（または `WorkerSafetyProfile` を1:1で追加し既存機能への影響を回避 ← 推奨）
   - 個人情報・保険区分・建退共/中退共・健診情報
   - `WorkerQualification`（種別: 特別教育/技能講習/免許、名称、取得日）を1:N で
   - **健康保険番号・基礎年金番号のカラムは作らない**（法令で記載禁止のため）
2. **UI**: 設定 > 作業員マスター編集画面（タブ: 基本情報 / 保険 / 資格・教育 / 健康）
3. **書類作成画面**: 案件選択 → 作業員を複数選択 → ヘッダー情報（元請所長名等）入力 → プレビュー → PDF
4. **PDF**: @react-pdf/renderer で A4横の様式第5号準拠レイアウト
5. **保存**: `SafetyDocument`（type, projectId, データのJSONスナップショット, 作成日）として履歴保存
   - スナップショット方式なら「提出時点の内容」が後から変わらない（保存義務5年に対応）

### Phase 2: 車両・機械系の届

1. `Vehicle` 拡張（車番・車種・保険情報）→ **工事・通勤用車両届（参考第8号）**
2. `Machine` マスター新規（機械名・型式・製造番号・点検日 等）→ **持込機械等使用届（参考第5号）**
3. クレーン等は `Machine` に種別と検査証情報を追加 → **移動式クレーン・車両系建設機械等使用届（第9号）**
4. 運転者・オペレーターは作業員マスターから選択（資格の自動チェック: 例「小型移動式クレーン技能講習」保有者のみ選択可）

### Phase 3: 再下請負通知書（第1号-甲）

1. `Customer`（または新 `Subcontractor`）に建設業許可情報・社会保険加入状況・代表者住所を追加
2. 自社情報（CompanyInfo）＋案件＋下請会社選択で生成
3. 配置技術者（主任技術者・安全衛生責任者等）は作業員マスターから選択

### Phase 4: 残りの主要書類 + グリーンファイル一括出力

- 新規入場時等教育実施報告書（第7号）— 実施日＋受講者選択のみで軽量
- 工事安全衛生計画書（第6号）— テンプレート文＋案件情報
- **一括出力**: 案件を選ぶと必要書類一式をまとめてPDF生成（zip or 結合PDF）

## データモデル素案（Phase 1）

```prisma
model WorkerSafetyProfile {
  id              String    @id @default(uuid())
  workerId        String    @unique
  furigana        String?
  birthDate       DateTime?
  address         String?
  tel             String?
  familyContact   String?   // 緊急連絡先（住所）
  familyTel       String?
  bloodType       String?   // A/B/O/AB
  bloodPressure   String?   // "120-80"
  jobType         String?   // とび、足場 等
  attributes      String[]  // 職/安/主/現 等の属性記号
  hireDate        DateTime?
  experienceYears Int?
  healthCheckDate DateTime? // 最新健康診断日
  specialHealthCheckDate DateTime?
  specialHealthCheckType String?
  healthInsurance String?   // kenpo/kyokai/kensetsu-kokuho/kokuho/exempt
  pensionInsurance String?  // kosei/kokumin/recipient
  employmentInsurance String? // employed/daily/exempt
  employmentInsuranceLast4 String? // 雇用保険番号 下4桁のみ
  kentaikyo       Boolean?  // 建退共
  chutaikyo       Boolean?  // 中退共
  ccusId          String?   // CCUS技能者ID
  qualifications  WorkerQualification[]
}

model WorkerQualification {
  id        String @id @default(uuid())
  profileId String
  category  String // special_education / skill_training / license
  name      String
  acquiredAt DateTime?
}

model SafetyDocument {
  id        String   @id @default(uuid())
  type      String   // sagyoin_meibo / sharyo_todoke / ...
  projectId String?
  title     String
  data      Json     // 生成時点のスナップショット
  createdBy String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

## 元請様式の実物解析（2026-06-11 追記）

ユーザー環境では元請ごとに提出形態が異なる: **①元請独自Excel様式（紙/PDF提出）、②グリーンサイト、③CCUS**。

### 解析済み: 三井住友建設（SMCR）様式パッケージ（①施工体制台帳作成（SMCR）.xls）

1ブックに17書類＋運用説明が同梱された典型的な元請パッケージ:
表紙 / 工事の通知 / 誓約書 / 元請施工台帳 / 再下請負様式（=統一様式第1号-甲）/ 下請編成表 / **作業員名簿（労務・安全様式第1号）** / 社会保険加入状況（統一様式第5号別紙）/ 持込機械クレーン / 持込機械自主管理一覧表 / 持込電動工具 / 工事用車輌届 / 危険・有害物持込 / 火気使用許可 / 店社安全管理計画 / 現場安全計画 / 教育の実施 / 高齢者就労 / 健康有所見者就労

**全建統一様式との差分（SMCRの場合）:**
- ベースは全建統一様式だが**古い改訂版ベース**（社会保険加入状況が別紙のまま、押印欄あり、平成表記の箇所あり）
- 作業員名簿の追加項目: **性別、退場年月日、労働者/一人親方/中小事業主の区分、労災保険特別加入の有無、建退共手帳所有の有無**、本人同意文言
- 独自書類: 誓約書、高齢者就労報告、健康有所見者就労報告、店社安全管理計画
- 工事用車輌届: 車両1台ごとに1枚、任意保険証書（写し）添付、対人/対物/搭乗者の保険金額、運行経路

### 設計への影響（重要）

1. **データモデルは「全項目の和集合」で持つ**: 全建統一様式 + 元請独自項目（性別、労災特別加入、建退共手帳、一人親方区分など）をマスターに持てば、どの元請様式にも出力できる。
2. **出力はテンプレート切替方式**: `SafetyDocument` の出力層を「全建統一様式準拠（標準）」+「元請別テンプレート（SMCR等）」に分離。まず標準を作り、元請テンプレートを順次追加。
3. **グリーンサイト/CCUS対応**: 両者ともAPI公開が限定的なため、当面は「マスターを単一の正とし、転記・CSV化しやすい画面/出力を用意する」方針。CCUS技能者ID・事業者IDはマスターに保持済みの設計でOK。
4. **既存Excelからの取込**: 元請様式や手持ちの作業員名簿Excelから作業員マスターへ一括インポートする機能は初期データ投入の負担を大きく下げる（Phase 1 に追加検討）。

## 横断的な注意事項

- **個人情報保護**: 作業員名簿データは閲覧権限を絞る（admin/事務のみ等）。健康保険番号・基礎年金番号は保持しない。
- **期限アラート**(将来): 健診1年・特殊健診半年・資格・検査証・任意保険の期限を通知センターに統合。
- **様式レイアウト**: 全建統一様式に「準拠」した独自レイアウトで作成（様式の完全コピーは避け、項目を網羅する形。各SaaSも同方式）。
- **押印欄なし**（改訂6版準拠）。
- **元請独自様式**: まず全建統一様式準拠で出し、要望が出たら元請別テンプレートを追加検討。

## 次のアクション

1. Phase 1 の詳細設計（画面ワイヤー・PDFレイアウト・マイグレーション）
2. 実際に使っている作業員名簿のサンプル（元請から渡される様式）があれば共有してもらう → レイアウト精度が上がる
