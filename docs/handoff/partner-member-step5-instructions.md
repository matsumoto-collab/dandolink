# Step 5 cc 実装指示書 — WeeklyCalendar の partner_member 対応

最終更新: 2026-05-08
ブランチ: `feature/partner-members`
前提: Step 1〜4 完了 (commit & push 済み)

---

## 0. 事前読み込み (cc 必須)

以下のドキュメントを順に全文読了してから着手してください:
1. `docs/handoff/partner-member-resume.md`
2. `docs/handoff/partner-member-step3-design-review.md`
3. 本ドキュメント

---

## 1. 設計の要点 (Cowork による事前調査結果)

### 現状把握
- `components/Calendar/WeeklyCalendar.tsx` 自体は既に `partnerMode + partnerId` で「1社だけのカレンダー行を表示する」仕組みを持つ (line 47–53, 297–311)
- 現在 `userRole === 'partner'` のとき、`components/MainContent.tsx:166` で `partnerId={userId}` を渡している
- `allForemen` (Zustand `calendarStore`) は `/api/dispatch/foremen` から取得され、role='partner' を含む (`app/api/dispatch/foremen/route.ts:16`)
- ただし **API の認可 allowlist には現在 `partner_member` が含まれていない** (`app/api/dispatch/foremen/route.ts:11`)
- NextAuth の session には現在 `companyId` が含まれていない (`types/next-auth.d.ts`, `lib/auth.ts`)

### 拡張方針
partner_member は自分の `companyId` (= 親協力会社のid) を `partnerId` として `WeeklyCalendar` に渡せば、既存の `allForemen.find(f => f.id === partnerId)` がそのまま親会社の行を引いてくれる。
**WeeklyCalendar 本体の修正は不要。** 必要なのは下記4ファイルのみ。

---

## 2. 変更対象ファイル (合計4ファイル)

### 2.1 `types/next-auth.d.ts`

`Session.user` / `User` / `JWT` の3インターフェースに `companyId?: string | null;` を追加。

```diff
 declare module 'next-auth' {
     interface Session {
         user: {
             id: string;
             username: string;
             role: UserRole;
             assignedProjects?: string[];
             isActive: boolean;
+            companyId?: string | null;
         } & DefaultSession['user'];
     }

     interface User {
         id: string;
         username: string;
         email: string;
         displayName: string;
         role: UserRole;
         assignedProjects?: string[];
         isActive: boolean;
         teamId?: string | null;
+        companyId?: string | null;
     }
 }

 declare module 'next-auth/jwt' {
     interface JWT {
         id: string;
         username: string;
         role: UserRole;
         assignedProjects?: string[];
         isActive: boolean;
         teamId?: string | null;
+        companyId?: string | null;
     }
 }
```

### 2.2 `lib/auth.ts`

3箇所修正:

**(a) `authorize()` の戻り値に companyId を追加 (line 70 付近)**
```diff
                     return {
                         id: user.id,
                         username: user.username,
                         email: user.email,
                         displayName: user.displayName,
                         role: user.role.toLowerCase() as UserRole,
                         assignedProjects,
                         isActive: user.isActive,
+                        companyId: user.companyId ?? null,
                     };
```

**(b) `jwt` callback: 初回ログイン時と5分DB再検証時の両方で token.companyId を更新 (line 89〜127 付近)**
```diff
             if (user) {
                 // 初回ログイン時
                 token.id = user.id;
                 token.username = user.username;
                 token.role = user.role;
                 token.assignedProjects = user.assignedProjects;
                 token.isActive = user.isActive;
+                token.companyId = user.companyId ?? null;
                 token.name = user.displayName;
                 token.lastDbCheck = Date.now();
             } else if (token?.id) {
                 ...
                 if (needsDisplayName || now - lastCheck > 300000) {
                     try {
                         const dbUser = await prisma.user.findUnique({
                             where: { id: token.id as string },
-                            select: { isActive: true, isLoginEnabled: true, role: true, displayName: true }
+                            select: { isActive: true, isLoginEnabled: true, role: true, displayName: true, companyId: true }
                         });

                         if (!dbUser || !dbUser.isActive || !dbUser.isLoginEnabled) {
                             token.isActive = false;
                         } else {
                             token.isActive = dbUser.isActive;
                             token.role = dbUser.role.toLowerCase() as UserRole;
                             token.name = dbUser.displayName;
+                            token.companyId = dbUser.companyId ?? null;
                             token.lastDbCheck = now;
                         }
```

**(c) `session` callback で companyId を session.user に流す (line 130 付近)**
```diff
         async session({ session, token }) {
             if (session.user) {
                 session.user.id = token.id;
                 session.user.username = token.username;
                 session.user.role = token.role;
                 session.user.assignedProjects = token.assignedProjects;
                 session.user.isActive = token.isActive;
+                session.user.companyId = token.companyId ?? null;
                 session.user.name = token.name ?? session.user.name ?? null;
             }
             return session;
         },
```

### 2.3 `components/MainContent.tsx`

`userRole === 'partner'` の分岐 (line 162–169) の直下に `partner_member` 分岐を追加:

```diff
                 // partnerロールの場合は週間カレンダーのみ表示（閲覧のみ、自分のチームのみ）
                 if (userRole === 'partner') {
                     return (
                         <div className="flex-1 min-h-0">
                             <WeeklyCalendar partnerMode={true} partnerId={userId} />
                         </div>
                     );
                 }
+                // partner_memberロールの場合は親協力会社のカレンダー行のみを閲覧表示
+                // （partnerId は自分の userId ではなく親会社の companyId を渡す）
+                if (userRole === 'partner_member') {
+                    const parentCompanyId = session?.user?.companyId;
+                    if (!parentCompanyId) {
+                        return (
+                            <div className="flex-1 min-h-0 flex items-center justify-center">
+                                <div className="text-center">
+                                    <h2 className="text-xl font-bold text-slate-900 mb-2">所属会社が設定されていません</h2>
+                                    <p className="text-slate-600">管理者に所属協力会社の設定を依頼してください。</p>
+                                </div>
+                            </div>
+                        );
+                    }
+                    return (
+                        <div className="flex-1 min-h-0">
+                            <WeeklyCalendar partnerMode={true} partnerId={parentCompanyId} />
+                        </div>
+                    );
+                }
```

### 2.4 `app/api/dispatch/foremen/route.ts`

権限 allowlist に `partner_member` を追加 (line 11):

```diff
         const role = session!.user.role;
-        if (!['admin', 'manager', 'foreman1', 'foreman2', 'worker', 'partner'].includes(role)) {
+        if (!['admin', 'manager', 'foreman1', 'foreman2', 'worker', 'partner', 'partner_member'].includes(role)) {
             return errorResponse('権限がありません', 403);
         }
```

> 補足: `partner_member` がこの API で何を返してもらうかは「親会社を含む全 foreman 一覧」で良い。
> WeeklyCalendar 内の `allForemen.find(f => f.id === partnerId)` で親会社1件だけ拾う動作なので、レスポンス全体を渡しても問題ない。

---

## 3. 実装後の確認手順 (cc が完了報告に含めること)

1. `npx tsc --noEmit` で型エラーなしを確認
2. `npm run dev` で起動 → admin でログイン → 既存 partner ユーザーでも動く (後方互換) こと
3. 変更ファイルの diff サマリ (4ファイル分) を Cowork に報告
4. **動作確認 (実 partner_member 作成 → ログイン → 親会社行表示) は Cowork が指示する Step 5 動作確認で実施するため、cc 側ではここまで**

---

## 4. cc が触らないこと

- WeeklyCalendar.tsx 本体には手を入れない (既存ロジックで対応可能)
- `app/api/dispatch/foremen/route.ts` 以外の API は本ステップでは対象外 (Step 6 で別途対応)
- 既存テスト (`__tests__/components/Calendar/WeeklyCalendar.test.tsx`) を破壊しないこと

---

## 5. 完了報告フォーマット

```
Step 5 実装完了。
- 変更ファイル: 4 (types/next-auth.d.ts, lib/auth.ts, components/MainContent.tsx, app/api/dispatch/foremen/route.ts)
- 型チェック: OK
- 既存 partner 動作: OK (回帰なし)
- diff: <git diff の要約>
動作確認 (Step 5動作確認) の指示をお待ちしています。
```
