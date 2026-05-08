# Step 9 実装指示書: 職長2 から協力業者のスケジュールを非表示

最終更新: 2026-05-08
ブランチ: `feature/partner-member-step9` を `main` から切る

## 0. 目的と背景

職長2 (foreman2) がスケジュール画面（週間 / 概観 / 手配表の3タブ）を開いたとき、**協力業者 (role=partner) の行を完全に非表示**にする。

現状: `/api/dispatch/foremen` の where 句に `partner` が含まれているため、職長2 のカレンダーにも協力業者の行が並び、その行に手配されている案件カードが見えてしまう。

ゴール: 職長2 だけがスケジュール画面で協力業者の行を見えなくする。職長1 は現状維持（全件閲覧）。出勤簿・出庫伝票など他画面では引き続き協力業者の選択肢を出す。

## 1. 設計判断（kei さん確定）

| 項目 | 決定 |
|---|---|
| 隠し方 | 行ごと完全に非表示（協力業者が存在しないように見える） |
| 対象ロール | foreman2 のみ。foreman1 は現状維持 |
| フィルタ層 | バックエンド API |
| 適用範囲 | スケジュール画面に限定（出勤簿・出庫伝票・LastUpdatedLabel は影響なし） |

実装方針:
- `/api/dispatch/foremen` に `?scope=schedule` クエリを受け付けるように拡張
- `scope === 'schedule'` かつ `session.user.role === 'foreman2'` のときだけ、where 句から `partner` を除外
- スケジュール側 (`stores/calendarSlices/foremanSlice.ts` の `fetchForemen`) は呼び出しを `?scope=schedule` 付きに変更
- 出勤簿・出庫伝票・LastUpdatedLabel は無修正（クエリを付けないので従来通り全件取得）

## 2. 修正するファイル

### 2-1. `app/api/dispatch/foremen/route.ts`

現状:

```ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';

export async function GET() {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = session!.user.role;
        if (!['admin', 'manager', 'foreman1', 'foreman2', 'worker', 'partner', 'partner_member'].includes(role)) {
            return errorResponse('権限がありません', 403);
        }

        const foremen = await prisma.user.findMany({
            where: { isActive: true, role: { in: ['foreman1', 'foreman2', 'admin', 'manager', 'partner'], mode: 'insensitive' } },
            select: { id: true, displayName: true, role: true },
            orderBy: { displayName: 'asc' },
        });

        return NextResponse.json(foremen, { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=120, must-revalidate' } });
    } catch (error) {
        return serverErrorResponse('職長一覧取得', error);
    }
}
```

変更後:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse } from '@/lib/api/utils';

export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = session!.user.role;
        if (!['admin', 'manager', 'foreman1', 'foreman2', 'worker', 'partner', 'partner_member'].includes(role)) {
            return errorResponse('権限がありません', 403);
        }

        const { searchParams } = new URL(req.url);
        const scope = searchParams.get('scope');

        // scope=schedule（スケジュール画面）から呼ばれたとき、職長2 には協力業者を非表示
        const baseRoles = ['foreman1', 'foreman2', 'admin', 'manager', 'partner'];
        const allowedRoles = (scope === 'schedule' && role === 'foreman2')
            ? baseRoles.filter(r => r !== 'partner')
            : baseRoles;

        const foremen = await prisma.user.findMany({
            where: { isActive: true, role: { in: allowedRoles, mode: 'insensitive' } },
            select: { id: true, displayName: true, role: true },
            orderBy: { displayName: 'asc' },
        });

        return NextResponse.json(foremen, { headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=120, must-revalidate' } });
    } catch (error) {
        return serverErrorResponse('職長一覧取得', error);
    }
}
```

ポイント:
- `GET()` → `GET(req: NextRequest)` にシグネチャ変更（`NextRequest` import 追加）
- `URL(req.url)` で searchParams を取得し `scope` を読む
- `baseRoles` を定数化し、職長2+schedule のときだけ `partner` を除外
- それ以外（admin/manager/foreman1 など）は従来どおり全5ロール

### 2-2. `stores/calendarSlices/foremanSlice.ts`

現状 (line 23 付近):

```ts
const response = await fetch('/api/dispatch/foremen');
```

変更後:

```ts
const response = await fetch('/api/dispatch/foremen?scope=schedule');
```

備考: この `fetchForemen` は `useCalendarDisplay` フック経由でスケジュール画面 (WeeklyCalendar / OverviewCalendar / AssignmentTable) のみが呼ぶ。出勤簿・出庫伝票は `fetch('/api/dispatch/foremen', ...)` を直接呼んでおりこのストアは経由しないので、それらは無修正で従来動作。

### 2-3. `__tests__/api/dispatch/foremen/route.test.ts`

既存テストの修正 + 新規ケース追加。

既存テストのうち下記を更新:

```ts
it('should fetch foremen successfully', async () => {
    (prisma.user.findMany as jest.Mock).mockResolvedValue([mockForeman]);

    const res = await GET();  // ← 引数なしで呼んでいる
    ...
});
```

変更点:
- `GET()` の引数に `NextRequest` を渡す形に変更
- 期待する `where` 句は変わらない (manager で scope なしなら全5ロール)

修正例 (NextRequest はモックでよい。test 全体の構造):

```ts
import { NextRequest } from 'next/server';

const makeReq = (url: string) => ({ url } as NextRequest);

it('should fetch foremen successfully (no scope, manager)', async () => {
    (prisma.user.findMany as jest.Mock).mockResolvedValue([mockForeman]);

    const res = await GET(makeReq('http://localhost/api/dispatch/foremen'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual([mockForeman]);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { isActive: true, role: { in: ['foreman1', 'foreman2', 'admin', 'manager', 'partner'], mode: 'insensitive' } },
        select: { id: true, displayName: true, role: true },
        orderBy: { displayName: 'asc' },
    });
});

it('should return 403 if role is not allowed', async () => {
    (requireAuth as jest.Mock).mockResolvedValue({ session: { user: { role: 'guest' } }, error: null });
    const res = await GET(makeReq('http://localhost/api/dispatch/foremen'));
    expect(res.status).toBe(403);
});
```

新規追加するテストケース (4件):

```ts
it('scope=schedule + foreman2: should exclude partner from role filter', async () => {
    (requireAuth as jest.Mock).mockResolvedValue({ session: { user: { id: 'u', role: 'foreman2' } }, error: null });
    (prisma.user.findMany as jest.Mock).mockResolvedValue([]);

    await GET(makeReq('http://localhost/api/dispatch/foremen?scope=schedule'));

    expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { isActive: true, role: { in: ['foreman1', 'foreman2', 'admin', 'manager'], mode: 'insensitive' } },
        select: { id: true, displayName: true, role: true },
        orderBy: { displayName: 'asc' },
    });
});

it('scope=schedule + foreman1: should include partner (foreman1 unaffected)', async () => {
    (requireAuth as jest.Mock).mockResolvedValue({ session: { user: { id: 'u', role: 'foreman1' } }, error: null });
    (prisma.user.findMany as jest.Mock).mockResolvedValue([]);

    await GET(makeReq('http://localhost/api/dispatch/foremen?scope=schedule'));

    expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { isActive: true, role: { in: ['foreman1', 'foreman2', 'admin', 'manager', 'partner'], mode: 'insensitive' } },
        select: { id: true, displayName: true, role: true },
        orderBy: { displayName: 'asc' },
    });
});

it('scope=schedule + admin: should include partner', async () => {
    (requireAuth as jest.Mock).mockResolvedValue({ session: { user: { id: 'u', role: 'admin' } }, error: null });
    (prisma.user.findMany as jest.Mock).mockResolvedValue([]);

    await GET(makeReq('http://localhost/api/dispatch/foremen?scope=schedule'));

    expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { isActive: true, role: { in: ['foreman1', 'foreman2', 'admin', 'manager', 'partner'], mode: 'insensitive' } },
        select: { id: true, displayName: true, role: true },
        orderBy: { displayName: 'asc' },
    });
});

it('no scope + foreman2: should include partner (attendance/materials unaffected)', async () => {
    (requireAuth as jest.Mock).mockResolvedValue({ session: { user: { id: 'u', role: 'foreman2' } }, error: null });
    (prisma.user.findMany as jest.Mock).mockResolvedValue([]);

    await GET(makeReq('http://localhost/api/dispatch/foremen'));

    expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { isActive: true, role: { in: ['foreman1', 'foreman2', 'admin', 'manager', 'partner'], mode: 'insensitive' } },
        select: { id: true, displayName: true, role: true },
        orderBy: { displayName: 'asc' },
    });
});
```

## 3. 触らないファイル（影響なしを明示）

下記は **絶対に変更しないこと**:

- `components/Attendance/AttendancePage.tsx` (line 148 で直接 fetch、scope 付けない)
- `components/Attendance/AttendanceModal.tsx`
- `components/Materials/MaterialRequisitionPage.tsx`
- `components/ui/LastUpdatedLabel.tsx`
- `components/Calendar/WeeklyCalendar.tsx` (バックエンドフィルタなのでフロントは無修正)
- `components/Calendar/OverviewCalendar.tsx`
- `components/Schedule/AssignmentTable.tsx`
- `app/api/assignments/route.ts` (今回はカレンダー行の表示制御のみ。アサインデータ自体は別議論)

スケジュール側は `useCalendarDisplay` 経由で `fetchForemen` を呼ぶ → 自動的に scope=schedule 付きになるため、コンポーネント本体の修正は不要。

## 4. テスト実行

```bash
npm run test -- __tests__/api/dispatch/foremen/route.test.ts
```

全テスト緑になることを確認。

既存の test rot（resume.md §2 末尾の `WeeklyCalendar.test.tsx` の `useCalendarStore` mock 不足）は **今回は触らない**（別タスク化済）。Step 9 と関係しないので失敗していても放置。

## 5. 動作確認 (cc → kei に依頼)

cc は実装後、push する前に「動作確認できる状態になりました」と Cowork に報告。Cowork が diff レビュー後、kei さんに以下を依頼:

1. ローカル `npm run dev` で起動
2. **admin** でログイン → スケジュール画面の週間/概観/手配表すべてに協力業者の行が出ることを確認（回帰なし）
3. **foreman1** ユーザーでログイン → スケジュール画面に協力業者の行が出ることを確認（現状維持）
4. **foreman2** ユーザーでログイン → スケジュール画面の3タブすべてで協力業者の行が **消えている** ことを確認
5. **foreman2** のまま「出勤簿」を開く → 「全ての職長」絞り込みドロップダウンに協力業者が **残っている** ことを確認（影響なし）
6. **foreman2** のまま「出庫伝票」を開く → 班選択に協力業者が **残っている** ことを確認（影響なし）

## 6. commit / push（Cowork レビュー後）

cc は実装完了後、**まず commit せず** Cowork の diff レビューを待つ。Cowork OK 後に下記の 2-commit 構成で push:

**Commit A (impl + tests):**
```
feat(schedule): hide partner rows from foreman2 in schedule views

- /api/dispatch/foremen accepts ?scope=schedule query param
- When scope=schedule and caller is foreman2, exclude partner role from result
- foreman1, admin, manager unaffected
- Attendance / material requisition pages unaffected (no scope param)
- Update fetchForemen in calendarSlices/foremanSlice.ts to pass scope=schedule
- Add 4 new test cases covering scope x role matrix
```

対象: `app/api/dispatch/foremen/route.ts`, `stores/calendarSlices/foremanSlice.ts`, `__tests__/api/dispatch/foremen/route.test.ts`

**Commit B (docs):**
```
docs(handoff): mark Step 9 complete — hide partner schedules from foreman2
```

対象: `docs/handoff/partner-member-resume.md`（Step 9 完了情報を §2 に追記）, `docs/handoff/partner-member-step9-instructions.md`（このファイル自体）

## 7. PR 作成・merge は Cowork が担当

cc が push 完了報告したら、Cowork が Chrome MCP で PR #5 を作成。タイトル例:

```
feat(schedule): hide partner rows from foreman2 in schedule views (Step 9)
```

kei さんの最終確認後、Squash and merge → ブランチ削除。

## 8. 既知のリスク・限界

- **assignments API は無修正**: foreman2 がブラウザの Network タブで `/api/assignments` を直接見れば、partner-assigned のアサインデータ自体は依然として取得可能。今回はあくまで **UI 上の行表示**を消す対応で、データ漏洩防止には踏み込まない。本格的にアクセス制御するなら別タスク（assignments の where 句にロール別フィルタを追加）。
- **`displayedForemanIds` グローバル設定に partner ID が残っていても問題なし**: API が partner を返さなくなれば `allForemen.find(f => f.id === partnerId)` が undefined となり、`employeeRows` で自動的に弾かれる（既存の filter 処理）。manager がわざわざ設定を更新する必要はない。
- **partner_member は元から `dispatch/foremen` に含まれない**: Step 5 で foremen findMany の role enum には入れない設計（親会社の partner で代表）にしてあるため、追加対応不要。
