# Step 6 cc 実装指示書 — API側 partner_member 対応

最終更新: 2026-05-08
ブランチ: `feature/partner-members`
前提: Step 1〜5 完了 (commit & push 済み, 最新 commit 4016625)

---

## 0. 事前読み込み (cc 必須)

1. `docs/handoff/partner-member-resume.md`
2. `docs/handoff/partner-member-step3-design-review.md`
3. `docs/handoff/partner-member-step5-instructions.md`
4. 本ドキュメント

---

## 1. 設計判断 (Cowork 確定)

### partner_member の権限モデル
- partner_member は親協力会社 (`partner`) と **同じレベルのアクセス権** を持つ
- ただし「データを引く際のキー」が異なる:
  - `partner` 自身 → assignedEmployeeId / foremanId は **自分の userId**
  - `partner_member` → assignedEmployeeId は **親会社の companyId** (member 自身は assignment の主体ではない)
  - 例外: 自分が書いた日報は member の userId が foremanId になる (本人が記録した日報は本人だけが見える)

### partner_member は「foreman 行」ではない
- `partnerForemanIds` (協力業者の foreman ID集合 → 外注費計算等) には partner_member を **含めない**
- カレンダー上の partner 行は親会社1行のみ。member は単独の行を持たない (Step 5 で確認済み)

---

## 2. 変更対象ファイル (合計 7ファイル — 8箇所のうち 2箇所は無修正)

### 2.1 `app/api/daily-reports/route.ts` (1箇所)

GET メソッド、line 36 付近:
```diff
         const role = session!.user.role;
-        if (role === 'worker' || role === 'partner') {
+        if (role === 'worker' || role === 'partner' || role === 'partner_member') {
             where.foremanId = session!.user.id;
             // 他人のforemanIdが指定された場合は拒否
             if (foremanId && foremanId !== session!.user.id) {
                 return errorResponse('権限がありません', 403);
             }
         } else if (foremanId) {
```

> 補足: partner_member 自身が書いた日報のみ自分で閲覧/編集できる。親会社は親会社自身の日報のみ閲覧。今回は会社単位の集約閲覧は実装しない (将来検討)。

### 2.2 `app/api/chat/rooms/[roomId]/route.ts` (1箇所)

PATCH メソッド、line 113 付近:
```diff
         // メンバー追加: グループ/案件は参加メンバー誰でも可能（協力業者は除く）
         if (Array.isArray(body.addMemberIds) && body.addMemberIds.length > 0) {
             if (roomMeta?.type === 'dm') {
                 return errorResponse('DMにはメンバーを追加できません', 400);
             }
-            if (session!.user.role === 'partner') {
+            if (session!.user.role === 'partner' || session!.user.role === 'partner_member') {
                 return errorResponse('メンバー追加権限がありません', 403);
             }
```

### 2.3 `app/api/chat/projects/[projectId]/room/route.ts` (1箇所)

GET メソッド、line 66 付近:
```diff
         // 協力業者は「自分 + 案件担当者(createdBy/managerIds)」のみ。
         // 職長/確定メンバー/admin は含めない
-        const isPartner = session!.user.role === 'partner';
+        const isPartner = session!.user.role === 'partner' || session!.user.role === 'partner_member';
         if (!isPartner) {
```

### 2.4 `app/api/chat/projects/[projectId]/ensure-room/route.ts` (1箇所)

POST メソッド、line 64 付近:
```diff
         const memberIds = new Set<string>();
         memberIds.add(userId);

-        const isPartner = session!.user.role === 'partner';
+        const isPartner = session!.user.role === 'partner' || session!.user.role === 'partner_member';
         if (isPartner) {
             // 協力業者: 「自分 + 案件担当者(managerIds + createdBy)」に強制
```

### 2.5 `app/api/project-masters/route.ts` (1箇所、特殊)

GET メソッド、line 28-36 付近。partner_member は **親会社の companyId** をキーに案件を引く:

```diff
         // ロールベースフィルタリング: worker, partner はアサイン済み案件のみ（foreman2 は全件閲覧可）
         const role = session!.user.role;
         if (role === 'worker' || role === 'partner') {
             const assignedPmIds = await prisma.projectAssignment.findMany({
                 where: { assignedEmployeeId: session!.user.id },
                 select: { projectMasterId: true },
                 distinct: ['projectMasterId'],
             });
             where.id = { in: assignedPmIds.map(a => a.projectMasterId) };
         }
+        if (role === 'partner_member') {
+            // partner_member は親会社 (companyId) のアサイン案件を継承
+            const parentCompanyId = session!.user.companyId;
+            if (!parentCompanyId) {
+                where.id = { in: [] }; // 親会社未設定の場合はアクセス案件なし
+            } else {
+                const assignedPmIds = await prisma.projectAssignment.findMany({
+                    where: { assignedEmployeeId: parentCompanyId },
+                    select: { projectMasterId: true },
+                    distinct: ['projectMasterId'],
+                });
+                where.id = { in: assignedPmIds.map(a => a.projectMasterId) };
+            }
+        }
```

> 重要: ここは「partner と同じ条件で or に入れる」ではなく、**別ブロック** にすること。partner は自分の userId、partner_member は親の companyId、という別キーになるため。

### 2.6 `app/api/project-masters/[id]/profit/route.ts` (line 203) — **無修正**

`partnerForemanIds` は「assignedEmployeeId として登場し得る partner 会社のID」を集める。
partner_member は assignedEmployeeId として **登場しない** (calendar の foreman 行は親会社のみ) ため、
このフィルタには partner_member を加えない。

```ts
// 変更しない
const partnerForemanIds = new Set(foremanUsers.filter(u => u.role === 'partner').map(u => u.id));
```

> このファイルはそもそも admin/manager 専用 API (line 43-45) なので partner_member 自体は呼べない。

### 2.7 `utils/permissions.ts` (1箇所)

`canAccessProject`、line 112 付近:
```diff
     // Foreman2, Worker, Partner need to check assigned projects
-    if (user.role === 'foreman2' || user.role === 'worker' || user.role === 'partner') {
+    if (user.role === 'foreman2' || user.role === 'worker' || user.role === 'partner' || user.role === 'partner_member') {
         if (!user.assignedProjects) return false;
         return user.assignedProjects.includes(projectId);
     }
```

> 補足: `assignedProjects` は per-user の JSON フィールド。partner_member は admin が個別に設定するモデル
> (現状は親会社の assignedProjects を自動継承する仕組みは作らない)。実運用上の絞り込みは
> `app/api/project-masters/route.ts` (#5) の companyId 経由で機能するため、
> ここは保険的なチェックでよい。将来「親から自動同期」が必要になったら別途検討。

### 2.8 `lib/profitDashboard.ts` (line 381) — **無修正**

#6 と同じ理由。`partnerForemanIdSet` は会社単位の集計。partner_member は対象外。
```ts
// 変更しない
const partnerForemanIdSet = new Set(
    allUsers.filter(u => u.role === 'partner').map(u => u.id)
);
```

### 2.9 (再 grep で発見) `app/api/chat/mentions/suggest/route.ts` (2箇所)

メンション候補のロール一覧に partner_member を追加:

```diff
 const ROLE_OPTIONS = [
     { id: 'admin', label: '管理者' },
     { id: 'manager', label: 'マネージャー' },
     { id: 'foreman1', label: '職長1' },
     { id: 'foreman2', label: '職長2' },
     { id: 'worker', label: '職方' },
     { id: 'partner', label: '協力業者' },
+    { id: 'partner_member', label: '協力会社メンバー' },
 ];
```

```diff
 function roleLabel(role: string): string {
     switch (role) {
         case 'admin': return '管理者';
         case 'manager': return 'マネージャー';
         case 'foreman1': return '職長1';
         case 'foreman2': return '職長2';
         case 'worker': return '職方';
         case 'partner': return '協力業者';
+        case 'partner_member': return '協力会社メンバー';
         default: return role;
     }
 }
```

---

## 3. 再 grep の結果まとめ

### 修正対象 (今回作業)
- 7ファイル (上記 §2 の 2.1〜2.5, 2.7, 2.9)

### 確認済みで無修正 (今回作業)
- `app/api/project-masters/[id]/profit/route.ts:203` — partnerForemanIds (会社単位、partner_member 対象外)
- `lib/profitDashboard.ts:381` — partnerForemanIdSet (同上)
- `app/api/dispatch/foremen/route.ts:16` — Step 5 で API allowlist のみ追加、findMany は変更なしで OK 確定済み

### 念のため確認 (cc 側でテスト実行で確認)
- `__tests__/api/dispatch/foremen/route.test.ts:42` — 期待モック値が `findMany` の where と一致しているか。Step 5 で findMany を変えていないので壊れないはず。
- `__tests__/utils/permissions.test.ts` — `canAccessProject` の partner ケースのテストが partner_member 追加で壊れないか (partner_member ケースのテスト追加は任意)

### スコープ外 (将来検討、resume.md に記録)
- `app/api/my-schedule/route.ts:76` — foremanMap は partner_member の表示名解決に必要になったら検討
- partner_member の `assignedProjects` を親会社から自動同期する仕組み

---

## 4. 実装後の確認 (cc が完了報告に含めること)

1. `npx tsc --noEmit` で型エラーなし (Step 5 と同じ既存の updateTotalMembers エラー以外)
2. `npm test -- --testPathPattern="permissions|dispatch/foremen"` で関連テストが通る (失敗時は内容を報告、勝手に修正しない)
3. 変更ファイルの diff サマリー (7ファイル) を Cowork に報告
4. **動作確認 (実 partner_member 作成 → 各機能の挙動目視) は kei が実施するため、cc 側ではここまで**

---

## 5. cc が触らないこと

- カレンダー系コンポーネント (Step 5 で完了済み、本ステップでは不要)
- profit/route.ts と profitDashboard.ts の partnerForemanIds (§2.6, §2.8 の理由)
- テストの期待値勝手に書き換え禁止 (失敗したら止めて報告)
- prisma schema / migration 系 (Step 1 で完了済み、追加の DDL は不要)

---

## 6. 完了報告フォーマット

```
Step 6 実装完了。
- 変更ファイル: 7
  - app/api/daily-reports/route.ts
  - app/api/chat/rooms/[roomId]/route.ts
  - app/api/chat/projects/[projectId]/room/route.ts
  - app/api/chat/projects/[projectId]/ensure-room/route.ts
  - app/api/project-masters/route.ts
  - utils/permissions.ts
  - app/api/chat/mentions/suggest/route.ts
- 無修正 (確認済み): app/api/project-masters/[id]/profit/route.ts, lib/profitDashboard.ts
- 型チェック: OK / NG (NG なら詳細)
- 関連テスト: 通過 / 失敗 (失敗なら詳細)
- diff: <git diff の要約>
動作確認 (Step 6 動作確認) の指示をお待ちしています。
```
