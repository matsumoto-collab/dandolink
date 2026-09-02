/**
 * 手配表（作業日報）PDF に電動工具の欄が正しく出るかを、実データを使わず組み立てた行で検証する。
 *
 * 車両欄を「車両（上段）＋電動工具（下段）」の2段にしたため（2026-09-02）、
 *   - 工具を選んでいない行は従来どおり車両だけが出るか
 *   - 工具がある行は車両名と工具名の両方が同じ列に出るか
 *   - 列幅の合計が用紙の利用幅（A4縦 - 左右padding = 559.28pt）を超えていないか
 * を確認する。DB には触らない。
 *
 * 実行: npx tsx scripts/verify-assignment-sheet-tools.tsx
 */
import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { AssignmentSheetPDF } from '../components/pdf/AssignmentSheetPDF';
import { buildAssignmentSheetRows, type AssignmentSheetProject, type WorkerNameInfo } from '../lib/assignmentSheet';
import '../lib/pdf/registerServerFonts';

const DATE = new Date(2026, 8, 2); // 2026-09-02
const DATE_KEY = '2026-09-02';

const workerNameMap = new Map<string, WorkerNameInfo>([
    ['f1', { displayName: '東本', isPartner: false, companyDisplayName: null, role: 'foreman1' }],
    ['w1', { displayName: '和馬', isPartner: false, companyDisplayName: null, role: 'worker' }],
]);
const vehicleNameMap = new Map<string, string>([['v1', '24-88'], ['v2', '2tリース']]);
const toolNameMap = new Map<string, string>([['t1', 'インパクト #1'], ['t2', '発電機A']]);
const managerMap = new Map<string, string>([['m1', '今井 太郎']]);
const ctMap = new Map<string, { name: string; color: string }>([['ct1', { name: '組立', color: '#111111' }]]);

const projects: AssignmentSheetProject[] = [
    {
        id: 'withTools',
        startDate: DATE,
        title: '工具あり現場',
        customer: 'アレスホーム',
        assignedEmployeeId: 'f1',
        constructionType: 'ct1',
        sortOrder: 0,
        createdBy: 'm1',
        confirmedWorkerIds: ['f1', 'w1'],
        confirmedVehicleIds: ['v1'],
        confirmedToolIds: ['t1', 't2'],
        memberCount: 2,
        isDispatchConfirmed: true,
    },
    {
        id: 'noTools',
        startDate: DATE,
        title: '工具なし現場',
        customer: 'アレスホーム',
        assignedEmployeeId: 'f1',
        constructionType: 'ct1',
        sortOrder: 1,
        createdBy: 'm1',
        confirmedWorkerIds: ['f1'],
        confirmedVehicleIds: ['v2'],
        memberCount: 1,
        isDispatchConfirmed: true,
    },
];

async function extract(buf: Buffer): Promise<{ text: string; maxX: number }> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
    let text = '';
    let maxX = 0;
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        for (const it of content.items as { str?: string; transform?: number[]; width?: number }[]) {
            if (!it.str) continue;
            text += it.str;
            if (it.transform && it.str.trim()) maxX = Math.max(maxX, it.transform[4] + (it.width ?? 0));
        }
    }
    return { text, maxX };
}

async function main() {
    const rows = buildAssignmentSheetRows({
        projects,
        dateKey: DATE_KEY,
        displayedForemanIds: ['f1'],
        allForemen: [{ id: 'f1', displayName: '東本' }],
        workerNameMap,
        vehicleNameMap,
        toolNameMap,
        managerMap,
        ctMap,
        isNamesLoaded: true,
    });

    const checks: { label: string; ok: boolean; detail?: string }[] = [];

    const withTools = rows.find((r) => r.projectId === 'withTools')!;
    const noTools = rows.find((r) => r.projectId === 'noTools')!;
    checks.push({ label: '工具ありの行に工具名2件', ok: withTools.toolNames.length === 2, detail: withTools.toolNames.join(',') });
    checks.push({ label: '工具なしの行は空配列', ok: noTools.toolNames.length === 0 });

    const buf = await renderToBuffer(
        <AssignmentSheetPDF date={DATE} rows={rows} managers={['今井']} />
    );
    const { text, maxX } = await extract(buf);

    checks.push({ label: '見出しが「車両・工具」', ok: text.includes('車両・工具') });
    checks.push({ label: '車両名が出る（24-88）', ok: text.includes('24-88') });
    checks.push({ label: '工具名が出る（インパクト #1）', ok: text.replace(/\s/g, '').includes('インパクト#1') });
    checks.push({ label: '工具名が出る（発電機A）', ok: text.includes('発電機A') });
    checks.push({ label: '現場名が欠けていない', ok: text.includes('工具あり現場') && text.includes('工具なし現場') });
    // A4縦 595.28pt - 右padding 18 = 577.28 が右端。列の合計は 559.28 に収まる想定
    checks.push({ label: '右端をはみ出していない', ok: maxX <= 578, detail: `maxX=${maxX.toFixed(1)}` });

    let ng = 0;
    for (const c of checks) {
        if (!c.ok) ng++;
        console.log(`${c.ok ? 'OK  ' : 'NG  '} ${c.label}${c.detail ? `  (${c.detail})` : ''}`);
    }
    console.log(`\n${checks.length - ng}/${checks.length} 件OK`);
    process.exit(ng === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
