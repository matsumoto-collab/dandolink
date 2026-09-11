'use client';

/**
 * 「一人当たりの稼ぎ」タブの中身（kei 要望 2026-09-12）。
 *
 * 絞り込み（期間・月別/日別・担当者・顧客・工事内容）はここで 1 つだけ持ち、
 * 「売上 ÷ 人工」と「一人当たりの稼ぎ」の両方に同じ条件をかける。
 * 絞り込みの選択肢（担当者・顧客・工事内容の一覧）は売上÷人工の API が
 * 「絞り込む前の期間全体」から作って返すので、選んでも候補が消えない。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';
import type { SalesPerManDaySummary } from '@/lib/salesPerManDay';
import ProductivityFilterBar from './ProductivityFilterBar';
import SalesPerManDaySection from './SalesPerManDaySection';
import LaborProductivityPanel from './LaborProductivityPanel';
import {
    defaultProductivityFilter,
    toQuery,
    type ProductivityFilter,
    type ProductivityOptions,
} from './productivityFilter';

const EMPTY_OPTIONS: ProductivityOptions = { customers: [], contents: [], assignees: [] };

type SalesResponse = SalesPerManDaySummary & { options?: ProductivityOptions };

export default function ProductivityTabContent() {
    const [filter, setFilter] = useState<ProductivityFilter>(defaultProductivityFilter);
    // 日付入力は 1 文字ごとに変わるので、実際に取りに行く条件は少し遅らせる
    const [applied, setApplied] = useState<ProductivityFilter>(filter);
    const [data, setData] = useState<SalesPerManDaySummary | null>(null);
    const [options, setOptions] = useState<ProductivityOptions>(EMPTY_OPTIONS);
    const [loading, setLoading] = useState(true);
    const reqId = useRef(0);

    useEffect(() => {
        const t = setTimeout(() => setApplied(filter), 250);
        return () => clearTimeout(t);
    }, [filter]);

    const query = useMemo(() => toQuery(applied, { granularity: applied.granularity }), [applied]);

    useEffect(() => {
        const id = ++reqId.current;
        setLoading(true);
        (async () => {
            try {
                const res = await fetch(`/api/profit-dashboard/sales-per-manday?${query}`, { cache: 'no-store' });
                if (!res.ok) throw new Error(`sales-per-manday ${res.status}`);
                const json = (await res.json()) as SalesResponse;
                if (id !== reqId.current) return; // 後から投げた方が正
                setData(json);
                if (json.options) setOptions(json.options);
            } catch (e) {
                if (id !== reqId.current) return;
                logger.error('売上÷人工の取得に失敗:', e);
                toast.error('売上 ÷ 人工の集計に失敗しました');
            } finally {
                if (id === reqId.current) setLoading(false);
            }
        })();
    }, [query]);

    return (
        <div className="space-y-4">
            <ProductivityFilterBar filter={filter} onChange={setFilter} options={options} loading={loading} />
            {/* 期別・月別（日別）の売上 ÷ 人工＝過去データも含めて第11期〜第13期を比べる */}
            <SalesPerManDaySection data={data} loading={loading} filter={applied} />
            <LaborProductivityPanel filter={applied} />
        </div>
    );
}
