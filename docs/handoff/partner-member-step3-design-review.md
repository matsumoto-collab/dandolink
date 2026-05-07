# Step 3-A 設計（確定版）

> 前回 cc が提案した設計の中身は失われていたため、保存メモのヒント
> （3ファイル名・約750行・/api/users分岐含む）と既存コード（UserManagement.tsx 等）の
> 調査結果を組み合わせて再構築。Cowork レビュー → cc レビューを経て確定済み。

## 0. 用語整理

| 用語 | 意味 |
|---|---|
| 協力会社 | role='partner' の User。メンバーの「親」になる存在 |
| メンバー | role='partner_member' の User。companyId に親協力会社のid を持つ |
| 親 | 協力会社のこと（companyId が指す先） |

## 1. 画面の置き場所

**Settingsページに admin 専用の新タブ「協力会社」を追加する。**

理由:
- 既存「ユーザー管理」タブが admin 専用パターンで動いているので、同じ並びに置けば導線も学習コストもゼロ
- 別ページ（/master/partners）にすると、Sidebar / layout / 権限ガード を新たに用意する必要があり、約750行の枠から溢れる
- 既存の admin タブ生成ロジック（settings/page.tsx の `if (isUserAdmin) baseTabs.push(...)` 部分）にもう1つ追加するだけで済む

## 2. 3ファイルの責務

### 2.1 PartnerListPage.tsx (≒260行)
**役割:** 協力会社（role='partner'）の一覧表示 + メンバー一覧画面への遷移

**state:**
```
partners: User[]              // 協力会社一覧
selectedPartner: User | null  // null=一覧表示 / 値あり=メンバー画面
isLoading, modalOpen, modalMode, editingPartner, resetPasswordPartner ...
```

**データ取得:** `GET /api/users?role=partner`

**画面の切替:**
- `selectedPartner === null` → 協力会社一覧（テーブル+モバイルカード）
- `selectedPartner !== null` → `<PartnerMemberListView partner={selectedPartner} onBack={() => setSelectedPartner(null)} />`

**一覧の各行/カード:**
- 表示名 / username / email / アクティブ状態
- 「メンバーを見る」ボタン → setSelectedPartner(partner)
- 編集 / 削除 / パスワードリセット（既存 UserManagement のロジックを流用）
- **削除アクションの制約**: メンバーが1件以上残っている協力会社は削除不可（API 側で 400 を返す。フロントは toast でエラー表示）

**「協力会社追加」ボタン:**
- 既存 UserModal を role='partner' 固定で開く（role セレクトを `partner` 固定で disabled）
- もしくは UserModal を「mode=create時に initialRole prop を受ける」ように軽微改修

> レビュー観点: 「協力会社の追加導線」を **既存 UserManagement タブ側に残す** 案もあり。
> その場合 PartnerListPage は読み取り＋メンバー画面への遷移だけになり、約100行軽くなる。
> どちらにするか後段で確認。

### 2.2 PartnerMemberListView.tsx (≒280行)

**役割:** 選択された協力会社に属するメンバー（role='partner_member' AND companyId=partner.id）の一覧 + CRUD

**props:**
```
partner: User                 // 親協力会社
onBack: () => void            // 「戻る」ボタンで一覧に戻る
```

**state:**
```
members: User[]
isLoading
modalOpen, modalMode: 'create' | 'edit'
editingMember: User | null
resetPasswordMember: User | null
generatedPassword
```

**データ取得:** `GET /api/users?role=partner_member&companyId={partner.id}`

**画面構成:**
- 上部: 「← 戻る」ボタン + `${partner.displayName} のメンバー` 見出し + 「メンバー追加」ボタン
- 一覧: 既存 UserManagement と同じパターン（PCはテーブル / モバイルはカード）
- 各メンバーに: 編集 / 削除 / パスワードリセット / **ログイン許可トグル**

**ログイン許可トグル:**
- isLoginEnabled の即時切替
- **楽観的UI更新**: クリック時に即 state を反転 → `PATCH /api/users/{id}` で `{ isLoginEnabled: !current }` を送る
- 失敗時はロールバック（state を元に戻す）+ toast でエラー表示
- 成功時は `現在ログインを許可しています/許可していません` を toast で通知

**メンバー削除の挙動:**
- hard delete（既存 UserManagement と同じ `DELETE /api/users/{id}` を呼ぶ）
- 過去の `AssignmentWorker.workerId` は orphan UUID として残るが、`workerName` が同テーブルにスナップショットされているので、過去の手配履歴の表示は維持される（schema 上 `workerId` に FK 制約なし、確認済み）

**メンバー追加/編集ボタンの動作:**
- create: `setModalMode('create')` → `<PartnerMemberModal partner={partner} mode="create" />`
- edit: `setEditingMember(member)` → `<PartnerMemberModal partner={partner} member={member} mode="edit" />`

### 2.3 PartnerMemberModal.tsx (≒210行)

**役割:** メンバーの作成/編集ダイアログ。役割は partner_member 固定、companyId は親 partner.id 自動セット。

**props:**
```
isOpen: boolean
onClose: () => void
onSave: (data) => Promise<void>
partner: User                  // 親協力会社
member?: User | null           // edit時のみ
mode: 'create' | 'edit'
```

**フォーム項目:**
| 項目 | 必須 | create | edit |
|---|---|---|---|
| 表示名 | ✓ | 入力 | 入力 |
| ユーザー名 | ✓ | 入力 | 表示のみ（既存 UserModal と同じ） |
| メール | ✓ | 入力 | 入力 |
| パスワード | createのみ✓ | 入力 | オプション（変更時のみ） |
| isLoginEnabled | - | チェックボックス（デフォルト true） | チェックボックス |
| isActive | - | チェックボックス（デフォルト true） | チェックボックス |

**フォームに出さない項目:**
- role: `'partner_member'` 固定（送信時のみセット）
- companyId: `partner.id` 固定（送信時のみセット / edit時も hidden で送信）

**編集モードの追加表示:**
- 「所属会社」として `partner.displayName` を **read-only テキスト**で表示（取り違え事故防止）
- companyId は変更不可（モーダル内では変更UIを提供しない）

**送信時のpayload（create例）:**
```
{
  username, email, displayName, password,
  role: 'partner_member',
  companyId: partner.id,
  isLoginEnabled,
}
```

> レビュー観点: 既存 UserModal にこれら2機能（partner_member固定 + companyId自動セット）を
> 追加する案もある。が、UserModal は既に複雑（291行、support分岐あり）なので、
> 別モーダルとして切る方が責務が明快で保守しやすい。

## 3. API 修正 (Step 3-B に含める)

### 3.0 `components/Settings/UserManagement.tsx` 側の対応

partners タブ導入に伴い、既存「ユーザー管理」タブで `role === 'partner'` または `role === 'partner_member'` のユーザーが二重に表示される。これを防ぐため:

- `users` state にセットする前に `.filter(u => u.role !== 'partner' && u.role !== 'partner_member')` を1行追加
- これにより既存タブは「自社内ユーザー」だけを表示し、協力会社系は新タブで管理する責務分離が成立

### 3.1 `app/api/users/route.ts`

#### GET
- クエリパラメータ追加: `companyId` を受ける
  ```ts
  const queryCompanyId = req.nextUrl.searchParams.get('companyId');
  ```
- whereClause 拡張（role + companyId の AND）:
  ```ts
  const whereClause = {
    ...(rolesToFetch ? { role: { in: rolesToFetch } } : {}),
    ...(queryCompanyId ? { companyId: queryCompanyId } : {}),
  };
  ```
- select に `companyId, isLoginEnabled` を追加
- レスポンス（admin/manager用と一般用の両方）に `companyId, isLoginEnabled` を含める

#### POST
- validation 通過後の data に `companyId`, `isLoginEnabled` を追加:
  ```ts
  const newUser = await prisma.user.create({
    data: {
      ...,
      companyId: companyId ?? null,
      isLoginEnabled: isLoginEnabled ?? true,
    },
  });
  ```
- 追加検証（POST）:
  - role === 'partner_member' のとき、companyId に対応する User が存在し、その role が 'PARTNER'（DB保存値は大文字）であることを必ず確認（zod refine では DB 参照できないので、route.ts 内で明示的にチェック → 違反時 400 を返す）
  - companyId が指定されたが role が partner_member 以外 の場合も 400（無関係なユーザーに親を設定するのを防ぐ）
- レスポンスに companyId, isLoginEnabled を含める

### 3.2 `app/api/users/[id]/route.ts`

#### GET
- select に `companyId, isLoginEnabled` を追加
- formatUser のレスポンスに含める

#### PATCH
- updateData に追加:
  ```ts
  if (companyId !== undefined) updateData.companyId = companyId;
  if (isLoginEnabled !== undefined) updateData.isLoginEnabled = isLoginEnabled;
  ```
- 追加検証（POST と同条件を再掲）:
  - role を partner_member に変更するとき、または companyId を変更するときに、指定 companyId に対応する User が存在し、role が 'PARTNER' であることを必ず確認（違反時 400）
  - companyId が指定されたが対象ユーザーの role が partner_member 以外 の場合も 400
- select / レスポンスに companyId, isLoginEnabled を追加

#### DELETE
- 追加ガード: 削除対象が role='PARTNER'（協力会社・親）の場合、子メンバー（companyId が一致する User）が1件以上残っていれば削除拒否（400 + メッセージ「メンバーが残っているため削除できません」）
  ```ts
  // 親協力会社の削除ガード
  if (target.role === 'PARTNER') {
    const memberCount = await prisma.user.count({ where: { companyId: id } });
    if (memberCount > 0) return errorResponse('メンバーが残っているため削除できません', 400);
  }
  ```
- partner_member 自身の削除はそのまま hard delete（FK制約なしのため `AssignmentWorker.workerId` は orphan UUID として残るが履歴は workerName で維持）

### 3.3 後方互換

- 既存の Bearer 5社（role='partner'）の API 呼び出しは companyId / isLoginEnabled が undefined のままでも壊れない
  - GET: select 追加だけなのでレスポンスに新フィールドが増える程度（フロントは無視できる）
  - POST/PATCH: 渡さなければ DB のデフォルト（companyId=null, isLoginEnabled=true）が使われる
  - validate もレベル refine が「partner_member の時のみ companyId 必須」なので既存ユーザー作成は影響なし

## 4. Settings ページへの組み込み

`app/(master)/settings/page.tsx` に対して:

```ts
// 1. activeTab の型に 'partners' を追加
const [activeTab, setActiveTab] = useState<... | 'partners'>('vehicles');

// 2. baseTabs の admin 分岐に追加
if (isUserAdmin) {
    baseTabs.push({ id: 'users' as const, ... });
    baseTabs.push({ id: 'partners' as const, label: '協力会社', count: null });
}

// 3. import を追加
import PartnerListPage from '@/components/Settings/PartnerListPage';

// 4. activeTab === 'partners' のときの描画
{activeTab === 'partners' && <PartnerListPage />}
```

## 5. 設計判断（確定）

| # | 判断点 | 確定案 | 補足 |
|---|---|---|---|
| Q1 | 協力会社（partner）追加導線 | 案A: PartnerListPage 内に「協力会社追加」ボタン（自己完結） | UserModal を流用し role='partner' 固定で開く |
| Q2 | メンバー画面への遷移方式 | 案A: 同タブ内 state 切替 | URL化は将来追加可能 |
| Q3 | ログイン許可トグル | 案A: 行内即時切替（楽観的UI） | 失敗時ロールバック+toast |
| Q4 | モーダル | 案A: 別ファイル PartnerMemberModal | UserModal は責務肥大化を避け据置 |
| Q5 | メンバー削除 | 案A: hard delete | ただし**親協力会社の削除は子メンバー残存時に API 側で拒否（400）**。子メンバー自身の削除は orphan UUID 容認、履歴は workerName で維持 |

## 6. 行数概算

**新規ファイル:**

| ファイル | 行数 |
|---|---|
| PartnerListPage.tsx | 260 |
| PartnerMemberListView.tsx | 280 |
| PartnerMemberModal.tsx | 210 |
| 小計 | **750** |

**既存ファイル修正:**

| ファイル | 修正規模 |
|---|---|
| `app/api/users/route.ts` | +約35行（select/where拡張 + POST時の親role検証 +5行 + companyId/isLoginEnabled保存 +5行） |
| `app/api/users/[id]/route.ts` | +約25行（PATCH時の親role検証 +5行 + DELETE時の親削除ガード +5行 + select拡張） |
| `components/Settings/UserManagement.tsx` | +1行（`.filter` で partner / partner_member を除外） |
| `app/(master)/settings/page.tsx` | +約10行（`partners` タブ追加 + import） |

**合計概算:** 約820行（純増）


## 7. 次のアクション

1. ~~Q1〜Q5 の判断確定~~ ✓ 完了
2. ~~設計書を確定版に更新~~ ✓ 完了（本ドキュメント）
3. cc 向け Step 3-B 実装指示文を作成 → ユーザーに渡す ← **いまここ**
4. cc が実装 → 動作確認 (Step 4)
