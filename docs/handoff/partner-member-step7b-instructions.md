# Step 7-B cc 実装指示書 — partner / partner_member の手配表ビュー（今日明日のみ）

最終更新: 2026-05-08
ブランチ: `feature/partner-members-step7b`（Step 7-A merge 完了後に main から作成）
前提: Step 1〜6 + Step 7-A 完了 (main にマージ済みであること)

---

## 0. 事前読み込み (cc 必須)

1. `docs/handoff/partner-member-resume.md`
2. `docs/handoff/partner-member-step3-design-review.md`（用語整理用）
3. 本ドキュメント

---

## 1. 要件 (Cowork 確定)

### ユースケース
協力会社 A に Aさん・Bさん・Cさんが居て、明日の予定が以下のとき:
- Aさん・Bさん: 協力会社 A の班（親会社が職長）の案件に入る
- Cさん: 自社（社内）職長の班に手配される

→ A本人 / Aさん / Bさん / Cさん **誰でログインしても**、協力会社 A 視点での「明日の仕事 全部」が見える。
- 自社の班の案件 (assignedEmployeeId === 親会社id)
- 自社メンバーが他班に手配されている案件 (confirmedWorkerIds に自社メンバー id を含む)

### 制限
- **当日 + 翌日のみ** （server-side で日付範囲を強制）
- **完全に閲覧のみ**（編集 UI なし、ダウンロードボタンなし、画像は API で返さない）
- 手配確定済み (`isDispatchConfirmed=true`) の案件のみ対象
- コピー防止は **軽め**（電話/住所はコピー可能、編集系 UI を出さないだけ）

### 既存スケジュール画面 (WeeklyCalendar) との関係
- partner / partner_member の `case 'schedule'` を **タブ切替コンポーネント** に差し替え
- 「今日明日」(デフォルト) と「週間」(既存 WeeklyCalendar partnerMode) を切り替えるタブ
- Sidebar の項目自体は無変更（「スケジュール」のままでよい）

### スコープ判定
- partner ログイン時 → スコープキー = `session.user.id`
- partner_member ログイン時 → スコープキー = `session.user.companyId` (未設定なら 403 ではなく空配列を返す)

### Phase A (Step 7-A) との関係
- Phase A で partner / partner_member が **「選択される側」** になった
- Phase B では partner / partner_member が **「自分の手配を見る側」** になる
- どちらも同じ会社内の人を扱うが、API/UI は完全に独立

---

## 2. 新規ファイル (合計 3ファイル)

### 2.1 `app/api/partner-schedule/route.ts` (新規)

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, errorResponse, serverErrorResponse, parseJsonField } from '@/lib/api/utils';

interface PartnerScheduleAssignment {
    id: string;
    date: string; // YYYY-MM-DD
    projectMasterId: string;
    projectTitle: string;
    projectName: string | null;
    customerShortName: string | null;
    location: string | null;
    prefecture: string | null;
    city: string | null;
    constructionTypeId: string | null;
    constructionContent: string | null;
    meetingTime: string | null;
    foremanId: string;
    foremanName: string;
    isOwnTeam: boolean; // 自社班か他班か
    workers: { id: string; displayName: string }[];
    vehicles: { id: string; name: string }[];
    dispatchRemark: string | null;
    remarks: string | null;
}

/**
 * GET /api/partner-schedule
 * 協力会社 (partner) / 協力会社メンバー (partner_member) 専用の閲覧 API。
 * 当日 + 翌日のみ、会社単位のスコープで「自社班」と「自社メンバーが他班に手配」の両方を返す。
 */
export async function GET(_req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const role = session!.user.role;
        if (role !== 'partner' && role !== 'partner_member') {
            return errorResponse('権限がありません', 403);
        }

        // スコープキー: 会社単位
        const scopeCompanyId =
            role === 'partner' ? session!.user.id : session!.user.companyId;
        if (!scopeCompanyId) {
            return NextResponse.json([], { headers: { 'Cache-Control': 'no-store' } });
        }

        // 期間: 今日 0時 〜 翌日 23:59:59.999
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dayAfterTomorrow = new Date(today);
        dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2); // 翌々日 0時 (= 翌日 24時)

        // 自社メンバー一覧 (partner_member の id 集合)
        const members = await prisma.user.findMany({
            where: { companyId: scopeCompanyId, isActive: true },
            select: { id: true, displayName: true },
        });
        const memberIds = new Set(members.map((m) => m.id));
        memberIds.add(scopeCompanyId); // 親会社自身も「自社」に含める

        // 期間内の手配確定済み assignments を全件取り、後で会社単位で絞る
        const assignments = await prisma.projectAssignment.findMany({
            where: {
                date: { gte: today, lt: dayAfterTomorrow },
                isDispatchConfirmed: true,
            },
            select: {
                id: true,
                date: true,
                assignedEmployeeId: true,
                confirmedWorkerIds: true,
                meetingTime: true,
                dispatchRemark: true,
                remarks: true,
                constructionType: true,
                projectMaster: {
                    select: {
                        id: true,
                        title: true,
                        name: true,
                        honorific: true,
                        customerShortName: true,
                        location: true,
                        prefecture: true,
                        city: true,
                        constructionContent: true,
                    },
                },
            },
            orderBy: [{ date: 'asc' }, { meetingTime: 'asc' }],
        });

        // foremen 表示名解決用マップ
        const foremanIds = new Set<string>();
        assignments.forEach((a) => foremanIds.add(a.assignedEmployeeId));
        const foremenList = await prisma.user.findMany({
            where: { id: { in: Array.from(foremanIds) } },
            select: { id: true, displayName: true },
        });
        const foremenMap = new Map(foremenList.map((f) => [f.id, f.displayName]));

        // workers 表示名解決用マップ (memberIds + 同案件内の他社メンバーも含めるため広めに引く)
        const workerIdSet = new Set<string>();
        assignments.forEach((a) => {
            const ids = parseJsonField<string[]>(a.confirmedWorkerIds, []);
            ids.forEach((id) => workerIdSet.add(id));
        });
        const workersList = await prisma.user.findMany({
            where: { id: { in: Array.from(workerIdSet) } },
            select: { id: true, displayName: true },
        });
        const workerMap = new Map(workersList.map((w) => [w.id, w.displayName]));

        // 会社単位のフィルタ:
        //   isOwnTeam = assignedEmployeeId === scopeCompanyId
        //   memberInOtherTeam = confirmedWorkerIds に memberIds の誰かが含まれる && !isOwnTeam
        const filtered: PartnerScheduleAssignment[] = [];
        for (const a of assignments) {
            const confirmedIds = parseJsonField<string[]>(a.confirmedWorkerIds, []);
            const isOwnTeam = a.assignedEmployeeId === scopeCompanyId;
            const memberInThisTeam = confirmedIds.some((id) => memberIds.has(id));
            if (!isOwnTeam && !memberInThisTeam) continue;

            filtered.push({
                id: a.id,
                date: a.date.toISOString().slice(0, 10),
                projectMasterId: a.projectMaster.id,
                projectTitle: a.projectMaster.title,
                projectName: a.projectMaster.name
                    ? a.projectMaster.name + (a.projectMaster.honorific || '')
                    : null,
                customerShortName: a.projectMaster.customerShortName,
                location: a.projectMaster.location,
                prefecture: a.projectMaster.prefecture,
                city: a.projectMaster.city,
                constructionTypeId: a.constructionType,
                constructionContent: a.projectMaster.constructionContent,
                meetingTime: a.meetingTime,
                foremanId: a.assignedEmployeeId,
                foremanName: foremenMap.get(a.assignedEmployeeId) ?? '不明',
                isOwnTeam,
                workers: confirmedIds.map((id) => ({
                    id,
                    displayName: workerMap.get(id) ?? '不明',
                })),
                vehicles: [], // TODO: AssignmentVehicle を別途引いてもよい。MVPは空配列
                dispatchRemark: a.dispatchRemark,
                remarks: a.remarks,
            });
        }

        return NextResponse.json(filtered, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return serverErrorResponse('協力会社向け予定取得', error);
    }
}
```

> 重要な実装ポイント:
> - 認可: `partner` と `partner_member` のみ。それ以外は 403。
> - スコープキー: partner なら自分の id、partner_member なら companyId。companyId 未設定の partner_member は **空配列** を返す（403 ではない）。
> - 日付範囲: 当日 0時 〜 翌々日 0時 (＝今日と明日の2日分のみ)。クライアント指定不可、サーバ側で固定。
> - 手配確定済 (`isDispatchConfirmed=true`) のみ。
> - select は機微情報を除外: 金額系、添付ファイル、内部メモ系は返さない。
> - vehicles は MVP で空配列。後続で AssignmentVehicle テーブル参照を追加可能。

### 2.2 `components/PartnerSchedule/PartnerScheduleView.tsx` (新規)

```tsx
'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { Calendar, MapPin, Clock, Users, AlertCircle } from 'lucide-react';
import Loading from '@/components/ui/Loading';
import { logger } from '@/lib/logger';
import { useMasterData } from '@/hooks/useMasterData';

interface PartnerScheduleAssignment {
    id: string;
    date: string;
    projectMasterId: string;
    projectTitle: string;
    projectName: string | null;
    customerShortName: string | null;
    location: string | null;
    prefecture: string | null;
    city: string | null;
    constructionTypeId: string | null;
    constructionContent: string | null;
    meetingTime: string | null;
    foremanId: string;
    foremanName: string;
    isOwnTeam: boolean;
    workers: { id: string; displayName: string }[];
    vehicles: { id: string; name: string }[];
    dispatchRemark: string | null;
    remarks: string | null;
}

function formatDateLabel(dateStr: string): { main: string; sub: string } {
    const d = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const isToday = d.getTime() === today.getTime();
    const isTomorrow = d.getTime() === tomorrow.getTime();
    const wd = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
    const main = isToday ? '今日' : isTomorrow ? '明日' : `${d.getMonth() + 1}/${d.getDate()}`;
    const sub = `${d.getMonth() + 1}/${d.getDate()} (${wd})`;
    return { main, sub };
}

export default function PartnerScheduleView() {
    const [assignments, setAssignments] = useState<PartnerScheduleAssignment[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedDate, setSelectedDate] = useState<'today' | 'tomorrow'>('today');
    const { constructionTypes } = useMasterData();

    useEffect(() => {
        let cancelled = false;
        const fetchData = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const res = await fetch('/api/partner-schedule', { cache: 'no-store' });
                if (!res.ok) throw new Error(`status ${res.status}`);
                const data: PartnerScheduleAssignment[] = await res.json();
                if (!cancelled) setAssignments(data);
            } catch (e) {
                logger.error('Failed to fetch partner schedule:', e);
                if (!cancelled) setError('データの取得に失敗しました。再読込してください。');
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };
        fetchData();
        return () => {
            cancelled = true;
        };
    }, []);

    const constructionTypeMap = useMemo(
        () => new Map(constructionTypes.map((c) => [c.id, c])),
        [constructionTypes]
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const todayKey = today.toISOString().slice(0, 10);
    const tomorrowKey = tomorrow.toISOString().slice(0, 10);

    const targetDateKey = selectedDate === 'today' ? todayKey : tomorrowKey;
    const dayAssignments = assignments.filter((a) => a.date === targetDateKey);
    const ownTeamAssignments = dayAssignments.filter((a) => a.isOwnTeam);
    const otherTeamAssignments = dayAssignments.filter((a) => !a.isOwnTeam);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loading text="予定を読み込み中..." />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-8">
                <AlertCircle className="w-8 h-8 text-amber-500 mb-3" />
                <p className="text-slate-700">{error}</p>
            </div>
        );
    }

    const renderCard = (a: PartnerScheduleAssignment) => {
        const ct = a.constructionTypeId ? constructionTypeMap.get(a.constructionTypeId) : null;
        const projectLabel = a.projectName ?? a.projectTitle;
        const place = [a.prefecture, a.city, a.location].filter(Boolean).join(' ');
        return (
            <div
                key={a.id}
                className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-2"
            >
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        {ct && (
                            <span
                                className="px-2 py-0.5 rounded-md text-xs font-semibold text-white shrink-0"
                                style={{ backgroundColor: ct.color || '#64748b' }}
                            >
                                {ct.name}
                            </span>
                        )}
                        <span className="font-semibold text-slate-900 truncate">{projectLabel}</span>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 shrink-0">
                        {a.foremanName}班
                    </span>
                </div>
                {a.customerShortName && (
                    <div className="text-sm text-slate-500">{a.customerShortName}</div>
                )}
                {place && (
                    <div className="flex items-start gap-1.5 text-sm text-slate-700">
                        <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" />
                        <span>{place}</span>
                    </div>
                )}
                {a.meetingTime && (
                    <div className="flex items-center gap-1.5 text-sm text-slate-700">
                        <Clock className="w-4 h-4 shrink-0 text-slate-400" />
                        <span>集合 {a.meetingTime}</span>
                    </div>
                )}
                {a.workers.length > 0 && (
                    <div className="flex items-start gap-1.5 text-sm text-slate-700">
                        <Users className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" />
                        <span>{a.workers.map((w) => w.displayName).join('、')}</span>
                    </div>
                )}
                {a.dispatchRemark && (
                    <div className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2">
                        {a.dispatchRemark}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="h-full overflow-y-auto bg-slate-50">
            <div className="max-w-3xl mx-auto p-4 space-y-4">
                {/* 日付タブ */}
                <div className="flex gap-2 bg-white rounded-xl border border-slate-200 p-1">
                    {(['today', 'tomorrow'] as const).map((key) => {
                        const label = formatDateLabel(key === 'today' ? todayKey : tomorrowKey);
                        const isActive = selectedDate === key;
                        return (
                            <button
                                key={key}
                                onClick={() => setSelectedDate(key)}
                                className={`flex-1 flex flex-col items-center py-2 rounded-lg transition-colors ${isActive
                                    ? 'bg-slate-800 text-white'
                                    : 'text-slate-700 hover:bg-slate-100'
                                    }`}
                            >
                                <span className="text-sm font-semibold">{label.main}</span>
                                <span className="text-xs opacity-70">{label.sub}</span>
                            </button>
                        );
                    })}
                </div>

                {/* 自社の班 */}
                <section>
                    <h2 className="text-sm font-semibold text-slate-600 mb-2 flex items-center gap-1.5">
                        <Calendar className="w-4 h-4" />
                        自社の班
                    </h2>
                    {ownTeamAssignments.length === 0 ? (
                        <p className="text-sm text-slate-400 bg-white rounded-xl border border-slate-200 p-4 text-center">
                            予定はありません
                        </p>
                    ) : (
                        <div className="space-y-2">{ownTeamAssignments.map(renderCard)}</div>
                    )}
                </section>

                {/* 他班に手配 */}
                {otherTeamAssignments.length > 0 && (
                    <section>
                        <h2 className="text-sm font-semibold text-slate-600 mb-2 flex items-center gap-1.5">
                            <Users className="w-4 h-4" />
                            他班に手配
                        </h2>
                        <div className="space-y-2">{otherTeamAssignments.map(renderCard)}</div>
                    </section>
                )}
            </div>
        </div>
    );
}
```

### 2.3 `components/PartnerSchedule/PartnerScheduleScreen.tsx` (新規)

`MainContent` の case 'schedule' から呼ぶラッパー。「今日明日 / 週間」のタブを持つ。

```tsx
'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import Loading from '@/components/ui/Loading';
import PartnerScheduleView from './PartnerScheduleView';

const WeeklyCalendar = dynamic(() => import('@/components/Calendar/WeeklyCalendar'), {
    loading: () => (
        <div className="flex items-center justify-center h-full">
            <Loading />
        </div>
    ),
});

interface PartnerScheduleScreenProps {
    /** 既存 partnerMode を WeeklyCalendar に渡すための id (= partner なら自分.id, partner_member なら companyId) */
    weeklyPartnerId: string;
}

export default function PartnerScheduleScreen({ weeklyPartnerId }: PartnerScheduleScreenProps) {
    const [tab, setTab] = useState<'daily' | 'weekly'>('daily');

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="flex-shrink-0 flex border-b border-slate-200 bg-white">
                <button
                    onClick={() => setTab('daily')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'daily'
                        ? 'border-slate-800 text-slate-900'
                        : 'border-transparent text-slate-500 hover:text-slate-700'
                        }`}
                >
                    今日明日
                </button>
                <button
                    onClick={() => setTab('weekly')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'weekly'
                        ? 'border-slate-800 text-slate-900'
                        : 'border-transparent text-slate-500 hover:text-slate-700'
                        }`}
                >
                    週間
                </button>
            </div>
            <div className="flex-1 min-h-0">
                {tab === 'daily' ? (
                    <PartnerScheduleView />
                ) : (
                    <WeeklyCalendar partnerMode={true} partnerId={weeklyPartnerId} />
                )}
            </div>
        </div>
    );
}
```

---

## 3. 既存ファイルの修正 (1ファイル)

### 3.1 `components/MainContent.tsx`

partner / partner_member の case 'schedule' 分岐を新スクリーンに差し替える。

**(a) import 追加 (上部の dynamic imports あたり):**
```diff
+const PartnerScheduleScreen = dynamic(() => import('./PartnerSchedule/PartnerScheduleScreen'), {
+    loading: () => <LoadingSpinner />,
+});
```

**(b) `case 'schedule':` 内の partner / partner_member 分岐を差し替え:**

現状:
```tsx
if (userRole === 'partner') {
    return (
        <div className="flex-1 min-h-0">
            <WeeklyCalendar partnerMode={true} partnerId={userId} />
        </div>
    );
}
if (userRole === 'partner_member') {
    const parentCompanyId = session?.user?.companyId;
    if (!parentCompanyId) {
        return (
            <div className="flex-1 min-h-0 flex items-center justify-center">
                <div className="text-center">
                    <h2 className="text-xl font-bold text-slate-900 mb-2">所属会社が設定されていません</h2>
                    <p className="text-slate-600">管理者に所属協力会社の設定を依頼してください。</p>
                </div>
            </div>
        );
    }
    return (
        <div className="flex-1 min-h-0">
            <WeeklyCalendar partnerMode={true} partnerId={parentCompanyId} />
        </div>
    );
}
```

修正後:
```tsx
if (userRole === 'partner') {
    return (
        <div className="flex-1 min-h-0">
            <PartnerScheduleScreen weeklyPartnerId={userId!} />
        </div>
    );
}
if (userRole === 'partner_member') {
    const parentCompanyId = session?.user?.companyId;
    if (!parentCompanyId) {
        return (
            <div className="flex-1 min-h-0 flex items-center justify-center">
                <div className="text-center">
                    <h2 className="text-xl font-bold text-slate-900 mb-2">所属会社が設定されていません</h2>
                    <p className="text-slate-600">管理者に所属協力会社の設定を依頼してください。</p>
                </div>
            </div>
        );
    }
    return (
        <div className="flex-1 min-h-0">
            <PartnerScheduleScreen weeklyPartnerId={parentCompanyId} />
        </div>
    );
}
```

> 既存 WeeklyCalendar の partnerMode 自体は据え置き。PartnerScheduleScreen 内で「週間」タブから引き続き利用する。
> ガード（companyId 未設定時の案内表示）も据え置き。

---

## 4. 動作確認 (cc 環境内)

1. `npx tsc --noEmit` で型エラーなし (既存 updateTotalMembers 2件以外)
2. `npm test` で関連テスト通過 (今回は新規ファイル中心、既存テストへの影響は薄い想定)
3. 変更ファイルの diff サマリ (新規3 + 修正1 = 4ファイル) を Cowork に報告

> 動作確認 (実 partner_member の今日明日表示・他班手配の混入確認・期間外データが返らない確認) は kei が後で実施。cc 側ではここまで。

---

## 5. cc が触らないこと

- 既存 WeeklyCalendar 本体は無修正 (Step 5 完了済)
- 既存 partner_member の companyId ガード (`所属会社が設定されていません` 案内) は据え置き
- 認証/認可フロー (auth.ts) は無修正
- Sidebar.tsx は今回は無修正 (タブ式にしたので Sidebar 項目変更不要)

---

## 6. 完了報告フォーマット

```
Step 7-B 実装完了。
- ブランチ: feature/partner-members-step7b (main から作成)
- 新規ファイル: 3
  - app/api/partner-schedule/route.ts
  - components/PartnerSchedule/PartnerScheduleView.tsx
  - components/PartnerSchedule/PartnerScheduleScreen.tsx
- 修正ファイル: 1
  - components/MainContent.tsx (partner / partner_member 分岐を新スクリーンに差し替え)
- 型チェック: OK / NG (NG なら詳細)
- 関連テスト: 通過 / 失敗 (失敗なら詳細)
- diff: <git diff の要約>
動作確認 (Step 7-B 動作確認) の指示をお待ちしています。
```

---

## 7. 既知の制限事項 (kei にも共有済)

- **画像保存防止は技術的に完全保護不可。** 案件の写真は本 API レスポンスに含めない方針で対応した。仮に必要になったら別途検討。
- **isDispatchConfirmed=true のみ表示。** 手配確定前の「予定」は表示されない。`workers` フィールド (planned, JSON) を表示したい場合は別途要望ベースで追加。
- **vehicles は MVP で空配列。** AssignmentVehicle テーブル参照を後続で足せばカード上に車両名表示可能。
- **当日 + 翌日 のみ。** 翌々日以降や過去は本ビューでは見えない。週間タブの WeeklyCalendar から過去/将来を確認可能。
