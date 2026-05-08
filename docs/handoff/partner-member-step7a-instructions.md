# Step 7-A cc 実装指示書 — 手配ピッカーで partner / partner_member を選択可に

最終更新: 2026-05-08
ブランチ: `feature/partner-members-step7a`（main から新規作成して作業）
前提: Step 1〜6 完了 (PR #1 main にマージ済み)

---

## 0. 事前読み込み (cc 必須)

1. `docs/handoff/partner-member-resume.md`
2. 本ドキュメント

その他既存の handoff (step3/5/6 instructions) は今回は読まなくて OK。スコープが独立しているため。

---

## 1. ブランチ運用

```bash
git checkout main
git pull origin main
git checkout -b feature/partner-members-step7a
```

main から新規ブランチで作業すること。

---

## 2. 設計判断 (Cowork 確定)

### 要件
- 手配確定モーダルのメンバー選択ピッカーで、`partner` と `partner_member` ロールのユーザーも選択できるようにする
- partner_member のチップには **親会社名を併記** する（誤選択防止）
- 並び順は worker と foreman2 の間に配置

### 影響しないこと（据え置き）
- `/api/dispatch/workers` の認可（誰がこの API を呼べるか）は admin/manager/foreman1/foreman2/worker のまま。partner / partner_member は呼ばない（手配する側にはならない）
- `confirmedWorkerIds` の保存ロジック（既に user.id ベースで型に依存しないため partner_member の id を入れて壊れない）
- 手配確定後の通知 (`/api/push/notify-dispatch`)（push 通知は別系統で、同じく id ベース）

---

## 3. 変更対象ファイル (合計 2ファイル)

### 3.1 `app/api/dispatch/workers/route.ts`

**(a) role allowlist 拡張 (line 16):**
```diff
         const workers = await prisma.user.findMany({
-            where: { isActive: true, role: { in: ['worker', 'WORKER', 'foreman2', 'FOREMAN2', 'foreman1', 'FOREMAN1', 'admin', 'ADMIN', 'manager', 'MANAGER', 'support', 'SUPPORT'] } },
-            select: { id: true, displayName: true, role: true, dispatchSortOrder: true, hideByDefaultInDispatch: true },
+            where: { isActive: true, role: { in: ['worker', 'WORKER', 'foreman2', 'FOREMAN2', 'foreman1', 'FOREMAN1', 'admin', 'ADMIN', 'manager', 'MANAGER', 'support', 'SUPPORT', 'partner', 'PARTNER', 'partner_member', 'PARTNER_MEMBER'] } },
+            select: {
+                id: true,
+                displayName: true,
+                role: true,
+                dispatchSortOrder: true,
+                hideByDefaultInDispatch: true,
+                companyId: true,
+                company: { select: { id: true, displayName: true } },
+            },
             orderBy: [
                 { dispatchSortOrder: { sort: 'asc', nulls: 'last' } },
                 { displayName: 'asc' },
             ],
         });
```

**(b) 認可チェック (line 11) は変更しない**:
```ts
// このまま据え置き
if (!['admin', 'manager', 'foreman1', 'foreman2', 'worker'].includes(role)) {
    return errorResponse('権限がありません', 403);
}
```

> 補足: Prisma の `company` リレーション名は schema.prisma の `User` モデルで `company User? @relation("CompanyMembers", fields: [companyId], references: [id], onDelete: SetNull)` と定義されている。`select: { company: { select: { ... } } }` でそのまま引ける。

### 3.2 `components/Calendar/DispatchConfirmModal.tsx`

**(a) `DispatchUser` インターフェース拡張 (line 16-22 付近):**
```diff
 interface DispatchUser {
     id: string;
     displayName: string;
     role: string;
     dispatchSortOrder?: number | null;
     hideByDefaultInDispatch?: boolean;
+    companyId?: string | null;
+    company?: { id: string; displayName: string } | null;
 }
```

**(b) `ROLE_PRIORITY` に partner / partner_member を追加 (line 25-32 付近):**
```diff
 const ROLE_PRIORITY: Record<string, number> = {
     worker: 1,
+    partner_member: 1.5,
+    partner: 1.7,
     foreman2: 2,
     foreman1: 3,
     support: 4,
     manager: 5,
     admin: 6,
 };
```

**(c) `renderWorkerChip` で partner_member のとき親会社名を併記 (line 170-192 付近):**

現状:
```tsx
const renderWorkerChip = (worker: DispatchUser) => {
    const teams = workerTeamMap.get(worker.id);
    const isSelected = selectedWorkerIds.includes(worker.id);
    return (
        <button
            key={worker.id}
            type="button"
            onClick={() => handleWorkerToggle(worker.id)}
            className={`relative flex items-center justify-center gap-1.5 px-3 min-h-[52px] rounded-xl text-sm font-medium transition-all active:scale-[0.97] ${isSelected
                ? 'bg-slate-800 text-white border-2 border-slate-800 shadow-sm'
                : 'bg-white text-slate-700 border-2 border-slate-200 hover:border-slate-400 hover:bg-slate-50'
                }`}
        >
            {isSelected && <Check className="w-4 h-4 flex-shrink-0" />}
            <span className="truncate">{worker.displayName}</span>
            {teams && (
                <span className="absolute -top-2 -right-1 px-1.5 py-0.5 text-[10px] bg-amber-400 text-amber-900 rounded-full font-semibold shadow-sm whitespace-nowrap leading-tight">
                    {teams.join('・')}
                </span>
            )}
        </button>
    );
};
```

修正後:
```tsx
const renderWorkerChip = (worker: DispatchUser) => {
    const teams = workerTeamMap.get(worker.id);
    const isSelected = selectedWorkerIds.includes(worker.id);
    const parentCompanyName =
        worker.role === 'partner_member' ? (worker.company?.displayName ?? null) : null;

    return (
        <button
            key={worker.id}
            type="button"
            onClick={() => handleWorkerToggle(worker.id)}
            className={`relative flex items-center justify-center gap-1.5 px-3 min-h-[52px] rounded-xl text-sm font-medium transition-all active:scale-[0.97] ${isSelected
                ? 'bg-slate-800 text-white border-2 border-slate-800 shadow-sm'
                : 'bg-white text-slate-700 border-2 border-slate-200 hover:border-slate-400 hover:bg-slate-50'
                }`}
        >
            {isSelected && <Check className="w-4 h-4 flex-shrink-0" />}
            <div className="flex flex-col items-center min-w-0 leading-tight">
                {parentCompanyName && (
                    <span className={`text-[10px] truncate max-w-full ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                        {parentCompanyName}
                    </span>
                )}
                <span className="truncate max-w-full">{worker.displayName}</span>
            </div>
            {teams && (
                <span className="absolute -top-2 -right-1 px-1.5 py-0.5 text-[10px] bg-amber-400 text-amber-900 rounded-full font-semibold shadow-sm whitespace-nowrap leading-tight">
                    {teams.join('・')}
                </span>
            )}
        </button>
    );
};
```

> 親会社名を表示するのは partner_member だけ。partner 本人や worker など他ロールはこれまで通り displayName のみ表示（1行）。partner_member だけ2行表示になる。

**(d) (任意) 空状態のメッセージを軽く更新する:**

line 333-336 付近:
```diff
                                 {workers.length === 0 ? (
                                     <p className="text-center text-slate-500 py-6 border border-slate-200 rounded-xl">
-                                        ユーザー管理でworkerロールのユーザーを追加してください
+                                        ユーザー管理または協力会社からメンバーを追加してください
                                     </p>
                                 ) : (
```

> これは任意。元のメッセージのまま放置でも機能上は問題ない。少し正確にする程度。

---

## 4. 動作確認 (cc 環境内)

1. `npx tsc --noEmit` で型エラーなし (Step 5/6 と同じく既存の updateTotalMembers 2件以外)
2. `npm test -- --testPathPattern="dispatch/workers|DispatchConfirmModal"` 関連テスト通過 (失敗時は内容を報告、勝手に修正しない)
3. 変更ファイルの diff サマリ (2ファイル) を Cowork に報告

> 動作確認 (実 partner_member を選択して手配確定) は kei が後で実施するため、cc 側ではここまで。

---

## 5. cc が触らないこと

- 認可ロジック (`/api/dispatch/workers` の line 11) は据え置き
- DispatchConfirmModal の `handleConfirm` / `handleCancelDispatch` ロジックは据え置き
- daily-reports / chat / project-masters 等の Step 6 で触ったファイルは今回は触らない

---

## 6. 完了報告フォーマット

```
Step 7-A 実装完了。
- ブランチ: feature/partner-members-step7a (main から作成)
- 変更ファイル: 2
  - app/api/dispatch/workers/route.ts (allowlist 拡張 + select 拡張)
  - components/Calendar/DispatchConfirmModal.tsx (型・並び順・表示拡張)
- 型チェック: OK / NG (NG なら詳細)
- 関連テスト: 通過 / 失敗 (失敗なら詳細)
- diff: <git diff の要約>
動作確認 (Step 7-A 動作確認) の指示をお待ちしています。
```
