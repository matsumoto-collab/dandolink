'use client';

/**
 * 「手配と見比べる」（docs/指示書_大規模手当.md の 7-3 の 9。API は 6-5）。
 * GET /crosscheck?month= を、開いたとき・読み直しのとき（reloadKey）に読む。手当ごとに:
 *
 *  - 対象として数えた現場（sites）
 *  - 人ごとの日数（people）。付くはずの日数と記録の日数が違う行に色を付ける
 *  - 付いていない（押し忘れ。missing）→ チェックして「選んだ分をまとめて付ける」（POST /crosscheck。親が送る）
 *  - 付けすぎ（extra）→「取り消す」（DELETE /records/[id]。親が送る）
 *  - 職長／職長以外が違う（mismatch）
 *  - 手配に入っているが、出勤になっていない日（unworked。参考）
 *
 * 付けてよい相手・区分は、サーバーが作り直して決める（画面は missing[].key を送るだけ）。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '@/lib/logger';
import { Button } from '@/components/ui/Button';
import AllowanceModal from './AllowanceModal';
import {
    ALLOWANCES_API,
    EXTRA_REASON_LABEL,
    PAY_ROLE_LABEL,
    STATUS_LABEL,
    attendanceStatusLabelOf,
    errorMessageOf,
    formatMonthLabel,
    yen,
    type CrosscheckData,
    type CrosscheckItem,
} from './allowancesClient';

interface Props {
    isOpen: boolean;
    month: string;
    /** 一覧を読み直したいときに変わる数（保存・取り消し・知らせのあと） */
    reloadKey: number;
    busy: boolean;
    onClose: () => void;
    /** 選んだ分をまとめて付ける。成功したら true */
    onBulkAdd: (itemId: string, month: string, keys: string[]) => Promise<boolean>;
    /** 取り消す。成功したら true */
    onRemove: (recordId: string) => Promise<boolean>;
}

const th = 'px-3 py-2 whitespace-nowrap';
const td = 'px-3 py-2 whitespace-nowrap';

function SectionTitle({ children, count }: { children: React.ReactNode; count?: number }) {
    return (
        <h4 className="text-sm font-bold text-slate-800">
            {children}
            {count !== undefined && <span className="ml-1.5 text-xs font-medium text-slate-500">{count}件</span>}
        </h4>
    );
}

function Empty({ text = 'ありません' }: { text?: string }) {
    return <p className="text-xs text-slate-400">{text}</p>;
}

interface ItemSectionProps {
    item: CrosscheckItem;
    month: string;
    closed: boolean;
    busy: boolean;
    onBulkAdd: Props['onBulkAdd'];
    onRemove: Props['onRemove'];
}

function CrosscheckItemSection({ item, month, closed, busy, onBulkAdd, onRemove }: ItemSectionProps) {
    const [selected, setSelected] = useState<Set<string>>(() => new Set());

    // 読み直したら、もう無い鍵（付いた・付くはずでなくなった）は選択から外す
    useEffect(() => {
        const keys = new Set(item.missing.map((m) => m.key));
        setSelected((prev) => {
            const next = new Set(Array.from(prev).filter((k) => keys.has(k)));
            return next.size === prev.size ? prev : next;
        });
    }, [item.missing]);

    const bulkBlockedReason = !item.isActive ? '設定で『使う』にすると、付けられます' : closed ? 'この月は締めてあります' : null;
    const allSelected = item.missing.length > 0 && selected.size === item.missing.length;

    const toggle = (key: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };
    const toggleAll = () => {
        setSelected(allSelected ? new Set() : new Set(item.missing.map((m) => m.key)));
    };

    const handleBulk = async () => {
        const keys = item.missing.filter((m) => selected.has(m.key)).map((m) => m.key);
        if (keys.length === 0) return;
        const ok = await onBulkAdd(item.itemId, month, keys);
        if (ok) setSelected(new Set());
    };

    const handleRemove = async (r: CrosscheckItem['extra'][number]) => {
        if (!window.confirm(`${r.userName}さんの ${r.date}の「${item.itemName}」（${PAY_ROLE_LABEL[r.payRole]} ${yen(r.amount)}）を取り消しますか？`)) return;
        await onRemove(r.recordId);
    };

    return (
        <section className="space-y-5 border border-slate-200 rounded-xl p-3 md:p-4 bg-white">
            <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="text-base font-bold text-slate-900">{item.itemName}</h3>
                {!item.isActive && (
                    <span className="px-2 py-0.5 rounded-md text-xs bg-slate-100 text-slate-500 border border-slate-200">使わない</span>
                )}
                <span className="text-xs text-slate-500">
                    工事内容が『{item.constructionContent}』の現場／付くはず {item.expectedCount}件・記録 {item.recordCount}件
                </span>
            </div>

            {/* 対象として数えた現場 */}
            <div className="space-y-1.5">
                <SectionTitle>対象として数えた現場</SectionTitle>
                {item.sites.length === 0 ? (
                    <p className="text-xs text-slate-500">
                        この月に、数える対象になった手配がありません（対象の現場の手配が無い・手当が始まる前の月・先の日付だけ、のどれかです）
                    </p>
                ) : (
                    <div className="flex flex-wrap gap-1.5">
                        {item.sites.map((s) => (
                            <span key={s.projectMasterId} className="px-2 py-0.5 rounded-md text-xs bg-slate-100 text-slate-700">
                                {s.title}（{s.days}日）
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* 人ごとの日数 */}
            <div className="space-y-1.5">
                <SectionTitle>人ごとの日数</SectionTitle>
                {item.people.length === 0 ? (
                    <Empty />
                ) : (
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                        <table className="w-full text-sm bg-white">
                            <thead>
                                <tr className="text-xs font-bold text-slate-700 bg-slate-100">
                                    <th className={`${th} text-left`} rowSpan={2}>氏名</th>
                                    <th className={`${th} text-center border-l border-slate-200`} colSpan={2}>付くはずの日数</th>
                                    <th className={`${th} text-center border-l border-slate-200`} colSpan={2}>記録の日数</th>
                                </tr>
                                <tr className="text-xs font-bold text-slate-700 bg-slate-100">
                                    <th className={`${th} text-right border-l border-slate-200`}>職長</th>
                                    <th className={`${th} text-right`}>職長以外</th>
                                    <th className={`${th} text-right border-l border-slate-200`}>職長</th>
                                    <th className={`${th} text-right`}>職長以外</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {item.people.map((p) => {
                                    const differs = p.expectedForemanDays !== p.recordedForemanDays || p.expectedMemberDays !== p.recordedMemberDays;
                                    return (
                                        <tr key={p.userId} className={differs ? 'bg-amber-50' : undefined}>
                                            <td className={td}>{p.userName}</td>
                                            <td className={`${td} text-right tabular-nums border-l border-slate-200`}>{p.expectedForemanDays}日</td>
                                            <td className={`${td} text-right tabular-nums`}>{p.expectedMemberDays}日</td>
                                            <td className={`${td} text-right tabular-nums border-l border-slate-200`}>{p.recordedForemanDays}日</td>
                                            <td className={`${td} text-right tabular-nums`}>{p.recordedMemberDays}日</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
                <p className="text-[11px] text-slate-400">
                    付くはずの日数 ＝ 対象の現場の手配に入っていて、出勤簿が出勤・夜勤・休日出勤の日。記録の日数は、確認待ちも含みます。
                </p>
            </div>

            {/* 付いていない（押し忘れ） */}
            <div className="space-y-1.5">
                <SectionTitle count={item.missing.length}>付いていない（押し忘れ）</SectionTitle>
                {item.missing.length === 0 ? (
                    <Empty />
                ) : (
                    <>
                        <div className="flex flex-wrap items-center gap-2">
                            <Button size="sm" variant="outline" onClick={toggleAll} disabled={busy || bulkBlockedReason !== null}>
                                {allSelected ? '選択を外す' : '全部選ぶ'}
                            </Button>
                            <Button
                                size="sm"
                                variant="primary"
                                onClick={handleBulk}
                                disabled={busy || bulkBlockedReason !== null || selected.size === 0}
                            >
                                選んだ分をまとめて付ける{selected.size > 0 ? `（${selected.size}件）` : ''}
                            </Button>
                            {bulkBlockedReason && <span className="text-xs text-red-600">{bulkBlockedReason}</span>}
                        </div>
                        <div className="overflow-x-auto border border-slate-200 rounded-lg">
                            <table className="w-full text-sm bg-white">
                                <thead>
                                    <tr className="text-left text-xs font-bold text-slate-700 bg-slate-100">
                                        <th className={th}>日付</th>
                                        <th className={th}>氏名</th>
                                        <th className={th}>区分</th>
                                        <th className={`${th} text-right`}>金額</th>
                                        <th className={`${th} text-center`}>チェック</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {item.missing.map((m) => (
                                        <tr key={m.key} className="hover:bg-teal-100 transition-colors">
                                            <td className={`${td} tabular-nums`}>{m.date}</td>
                                            <td className={td}>
                                                {m.userName}
                                                {m.isSelf && <span className="ml-1 text-xs text-amber-700">（自分の分は確認待ちになります）</span>}
                                            </td>
                                            <td className={td}>{PAY_ROLE_LABEL[m.payRole]}</td>
                                            <td className={`${td} text-right tabular-nums`}>{yen(m.amount)}</td>
                                            <td className={`${td} text-center`}>
                                                <input
                                                    type="checkbox"
                                                    className="h-4 w-4 accent-teal-600"
                                                    checked={selected.has(m.key)}
                                                    onChange={() => toggle(m.key)}
                                                    disabled={busy || bulkBlockedReason !== null}
                                                    aria-label={`${m.date} ${m.userName}`}
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>

            {/* 付けすぎ */}
            <div className="space-y-1.5">
                <SectionTitle count={item.extra.length}>付けすぎ</SectionTitle>
                {item.extra.length === 0 ? (
                    <Empty />
                ) : (
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                        <table className="w-full text-sm bg-white">
                            <thead>
                                <tr className="text-left text-xs font-bold text-slate-700 bg-slate-100">
                                    <th className={th}>日付</th>
                                    <th className={th}>氏名</th>
                                    <th className={th}>区分</th>
                                    <th className={`${th} text-right`}>金額</th>
                                    <th className={th}>理由</th>
                                    <th className={th}></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {item.extra.map((r) => (
                                    <tr key={r.recordId} className="hover:bg-teal-100 transition-colors">
                                        <td className={`${td} tabular-nums`}>{r.date}</td>
                                        <td className={td}>
                                            {r.userName}
                                            {r.status === 'pending' && <span className="ml-1 text-xs text-amber-700">（{STATUS_LABEL.pending}）</span>}
                                        </td>
                                        <td className={td}>{PAY_ROLE_LABEL[r.payRole]}</td>
                                        <td className={`${td} text-right tabular-nums`}>{yen(r.amount)}</td>
                                        <td className={`${td} text-slate-600`}>{EXTRA_REASON_LABEL[r.reason] ?? r.reason}</td>
                                        <td className={`${td} text-right`}>
                                            {!closed && (
                                                <Button size="sm" variant="dangerOutline" onClick={() => handleRemove(r)} disabled={busy}>
                                                    取り消す
                                                </Button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* 職長／職長以外が違う */}
            <div className="space-y-1.5">
                <SectionTitle count={item.mismatch.length}>職長／職長以外が違う</SectionTitle>
                {item.mismatch.length === 0 ? (
                    <Empty />
                ) : (
                    <>
                        <p className="text-xs text-slate-500">直すときは、取り消して、『記録を足す』で付け直します。</p>
                        <div className="overflow-x-auto border border-slate-200 rounded-lg">
                            <table className="w-full text-sm bg-white">
                                <thead>
                                    <tr className="text-left text-xs font-bold text-slate-700 bg-slate-100">
                                        <th className={th}>日付</th>
                                        <th className={th}>氏名</th>
                                        <th className={th}>記録の区分と金額</th>
                                        <th className={th}>手配から決まる区分</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {item.mismatch.map((r) => (
                                        <tr key={r.recordId} className="hover:bg-teal-100 transition-colors">
                                            <td className={`${td} tabular-nums`}>{r.date}</td>
                                            <td className={td}>{r.userName}</td>
                                            <td className={td}>
                                                {PAY_ROLE_LABEL[r.payRole]} {yen(r.amount)}
                                            </td>
                                            <td className={`${td} font-semibold`}>{PAY_ROLE_LABEL[r.expectedPayRole]}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>

            {/* 手配に入っているが、出勤になっていない日（参考） */}
            <div className="space-y-1.5">
                <SectionTitle count={item.unworked.length}>手配に入っているが、出勤になっていない日（参考）</SectionTitle>
                {item.unworked.length === 0 ? (
                    <Empty />
                ) : (
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                        <table className="w-full text-sm bg-white">
                            <thead>
                                <tr className="text-left text-xs font-bold text-slate-700 bg-slate-100">
                                    <th className={th}>日付</th>
                                    <th className={th}>氏名</th>
                                    <th className={th}>区分</th>
                                    <th className={th}>出勤簿の区分</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {item.unworked.map((u) => (
                                    <tr key={`${u.userId}_${u.date}`} className="hover:bg-teal-100 transition-colors">
                                        <td className={`${td} tabular-nums`}>{u.date}</td>
                                        <td className={td}>{u.userName}</td>
                                        <td className={td}>{PAY_ROLE_LABEL[u.payRole]}</td>
                                        <td className={td}>{attendanceStatusLabelOf(u.attendanceStatus)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </section>
    );
}

export default function AllowanceCrosscheckModal({ isOpen, month, reloadKey, busy, onClose, onBulkAdd, onRemove }: Props) {
    const [data, setData] = useState<CrosscheckData | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const seqRef = useRef(0);

    const load = useCallback(async () => {
        if (!isOpen) return;
        const seq = ++seqRef.current;
        try {
            const params = new URLSearchParams({ month });
            const res = await fetch(`${ALLOWANCES_API}/crosscheck?${params}`, { cache: 'no-store' });
            if (!res.ok) {
                const message = await errorMessageOf(res, '手配との見比べの取得に失敗しました');
                if (seq === seqRef.current) setLoadError(message);
                return;
            }
            const body = (await res.json()) as CrosscheckData;
            if (seq !== seqRef.current) return; // 古い読み込みの答えは捨てる
            setData(body);
            setLoadError(null);
        } catch (e) {
            logger.error('手当の見比べの取得に失敗:', e);
            if (seq === seqRef.current) setLoadError('手配との見比べの取得に失敗しました');
        }
    }, [isOpen, month]);

    // 開き直した・月が変わったら、前の内容は消してから読む
    useEffect(() => {
        setData(null);
        setLoadError(null);
    }, [isOpen, month]);

    useEffect(() => {
        load();
    }, [load, reloadKey]);

    const shown = data && data.month === month ? data : null;

    return (
        <AllowanceModal isOpen={isOpen} onClose={onClose} title="手配と見比べる" subtitle={formatMonthLabel(month)} widthClass="lg:max-w-6xl">
            <div className="space-y-4">
                <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    手配（その日の現場と班）と出勤簿から、手当が付くはずの人と日を出して、記録と見比べます。
                    <strong>出勤簿の区分（欠勤・有給など）を直してから使ってください。</strong>
                </p>

                {shown?.closed && (
                    <p className="text-sm text-slate-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        締めた月です。見るだけです（締めたあとで手配や出勤簿が直されると、ここの見比べは変わりますが、記録は変わりません）。
                    </p>
                )}

                {shown === null ? (
                    <div className="text-center py-6">
                        <p className="text-sm text-slate-500">{loadError ?? '読み込み中…'}</p>
                        {loadError && (
                            <Button size="sm" variant="outline" className="mt-3" onClick={() => load()}>
                                読み直す
                            </Button>
                        )}
                    </div>
                ) : shown.items.length === 0 ? (
                    <p className="text-sm text-slate-500 py-6 text-center">手当がありません</p>
                ) : (
                    shown.items.map((item) => (
                        <CrosscheckItemSection
                            key={item.itemId}
                            item={item}
                            month={shown.month}
                            closed={shown.closed}
                            busy={busy}
                            onBulkAdd={onBulkAdd}
                            onRemove={onRemove}
                        />
                    ))
                )}
            </div>
        </AllowanceModal>
    );
}
