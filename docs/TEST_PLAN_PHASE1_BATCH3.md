# Phase 1 (Batch 3) テスト方針書

## 概要
`app/api/master-data/` 配下の以下のルートに対してテストを実装します。

## 対象ファイル
1. `app/api/master-data/managers/route.ts` (CRUD)
2. `app/api/master-data/managers/[id]/route.ts` (CRUD)
3. `app/api/master-data/construction-types/route.ts` (CRUD, Default Seeding)
4. `app/api/master-data/construction-types/[id]/route.ts` (CRUD)
5. `app/api/master-data/settings/route.ts` (Singleton GET/PATCH)

## テストケース一覧

### 1-2. `managers` (Managers)
※ `vehicles` / `workers` と同様の CRUD 構成。

#### GET
- [ ] **正常系**: アクティブな担当者一覧を取得できること (200)
- [ ] **異常系**: 未認証 (401), DBエラー (500)

#### POST
- [ ] **正常系**: 担当者を作成できること (201)
- [ ] **準正常系**: バリデーションエラー (名前空) (400)
- [ ] **異常系**: 未認証 (401), DBエラー (500)

#### PATCH `[id]`
- [ ] **正常系**: 担当者名を更新できること (200)
- [ ] **準正常系**: バリデーションエラー (400)
- [ ] **準正常系**: 権限なし (403)
- [ ] **異常系**: 未認証 (401), DBエラー (500)

#### DELETE `[id]`
- [ ] **正常系**: 論理削除できること (200)
- [ ] **準正常系**: 権限なし (403)
- [ ] **異常系**: 未認証 (401), DBエラー (500)

### 3-4. `construction-types` (Construction Types)

#### GET
- [ ] **正常系**: 工事種別一覧を取得できること (200)
- [ ] **正常系**: データが空の場合、デフォルト値がシードされること (200)
- [ ] **異常系**: 未認証 (401), DBエラー (500)

#### POST
- [ ] **正常系**: 工事種別を作成できること（sortOrderが最大値+1されること） (201)
- [ ] **準正常系**: バリデーションエラー (名前/色) (400)
- [ ] **異常系**: 未認証 (401), DBエラー (500)

#### PATCH `[id]`
- [ ] **正常系**: 名前・色・並び順を個別/一括で更新できること (200)
- [ ] **準正常系**: バリデーションエラー (400)
- [ ] **準正常系**: 権限なし (403)
- [ ] **異常系**: 未認証 (401), DBエラー (500)

#### DELETE `[id]`
- [ ] **正常系**: 論理削除できること (200)
- [ ] **準正常系**: 権限なし (403)
- [ ] **異常系**: 未認証 (401), DBエラー (500)

### 5. `settings` (System Settings)

#### GET
- [ ] **正常系**: 設定を取得できること (200)
- [ ] **正常系**: 設定が存在しない場合、デフォルト値を作成して返すこと (200)
- [ ] **異常系**: 未認証 (401), DBエラー (500)

#### PATCH
- [ ] **正常系**: 設定（totalMembers）を更新できること (200)
- [ ] **正常系**: 設定が存在しない場合でも更新（upsert）できること (200)
- [ ] **準正常系**: バリデーションエラー (数値以外/0以下) (400)
- [ ] **異常系**: 未認証 (401), DBエラー (500)

## 実装方針
- `prisma`, `requireAuth` をモック化。
- `construction-types`: `aggregate` (max sortOrder) のモック挙動に注意。
- `settings`: `upsert` のモック挙動を確認。
- `validateHexColor`, `validateStringField` は `lib/api/utils` モックに含める。
