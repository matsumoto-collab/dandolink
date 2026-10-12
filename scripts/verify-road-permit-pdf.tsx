/**
 * 道路申請 PDF（① 警察 ② 松山市 提出用 ③ 松山市 受け取り用）を、入力値の JSON から作って破綻がないか検証する。
 *
 * scripts/verify-joyo-statement-pdf.tsx と同じ作り。ただし **DB は使わない**（値は JSON から読むだけ）。
 * 検証用の値は原本の値をそのまま書いた docs/road-permit/forms/sample-values.json（.gitignore 済み。
 * 原本は担当者の携帯番号入りなので、リポジトリにコミットされるファイルには値を書かない）。
 *
 * チェック項目:
 *   - ページ数 = formIds の数
 *   - 各ページに主要な文言（表題・宛先・目的・場所・路線名・数量・期間など）が入っていること
 *   - 文字が右端（595 − 余白）を越えないこと
 *
 * 実行: npx tsx scripts/verify-road-permit-pdf.tsx --values <json> [--out <pdf>]
 *   例: npx tsx scripts/verify-road-permit-pdf.tsx --values docs/road-permit/forms/sample-values.json --out tmp/road.pdf
 * JSON は RoadPermitValues（＋ formIds。無ければ 3 様式すべて）。normalizeRoadPermitValues を通すので欠けた欄は空になる。
 */
import React from 'react';
import fs from 'fs';
import { renderToBuffer } from '@react-pdf/renderer';
import { RoadPermitDocument } from '../components/pdf/roadPermit/RoadPermitDocument';
import { normalizeRoadPermitValues } from '../lib/roadPermit/defaults';
import { isRoadPermitFormId, sortFormIds } from '../lib/roadPermit/forms';
import {
    effectiveApproxArea,
    formatHourLabel,
    formatReiwaRange,
    formatReiwaYmdOrBlank,
} from '../lib/roadPermit/format';
import { ROAD_PERMIT_FORM_IDS, type RoadPermitFormId, type RoadPermitValues } from '../types/roadPermit';
import { sanitizePdfText } from '../components/pdf/styles';
// styles.ts（CDNフォント）の後に評価させるため import は最後に置く
import '../lib/pdf/registerServerFonts';

const PAGE_WIDTH = 595;
/** 右の余白。原本の外枠の右端は 534pt（警察）・527.5pt（松山市）なので、それより外に文字が出たらはみ出し */
const RIGHT_MARGIN = 36;
const MAX_X = PAGE_WIDTH - RIGHT_MARGIN + 1;

interface PageInfo {
    /** 文字をつないだもの（空白は落とす。字間を空けた見出しも 1 語になる） */
    text: string;
    maxX: number;
    /** 右端を越えた文字（調べる用） */
    overflow: string[];
}

async function analyze(buf: Buffer): Promise<PageInfo[]> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
    const pages: PageInfo[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        let text = '';
        let maxX = 0;
        const overflow: string[] = [];
        for (const it of content.items as { str?: string; transform: number[]; width?: number }[]) {
            if (!it.str) continue;
            text += it.str;
            if (it.str.trim()) {
                const right = Math.round(it.transform[4] + (it.width ?? 0));
                maxX = Math.max(maxX, right);
                if (right > MAX_X) overflow.push(`${it.str}(右端 ${right})`);
            }
        }
        pages.push({ text: text.replace(/\s/g, ''), maxX, overflow });
    }
    return pages;
}

/** PDF の文字と比べるため、SafeText と同じ置き換え（㎡→m² など）をして空白を落とす */
function norm(s: string): string {
    return sanitizePdfText(s).replace(/\s/g, '');
}

/** 様式ごとに「入っているはずの文言」 */
function expectedTexts(id: RoadPermitFormId, v: RoadPermitValues): string[] {
    const approx = effectiveApproxArea(v.occupancy.quantity, v.occupancy.areaApprox);
    if (id === 'police-road-use') {
        const period =
            `${formatReiwaYmdOrBlank(v.period.useFrom)}${formatHourLabel(v.period.timeFrom)}から` +
            `${formatReiwaYmdOrBlank(v.period.useTo)}${formatHourLabel(v.period.timeTo)}まで`;
        return [
            '道路使用許可申請書',
            '道路使用許可証',
            `${v.police.stationName}殿`,
            v.applicant.address,
            v.applicant.companyName,
            v.applicant.representativeName,
            v.police.purpose,
            v.police.section,
            period,
            v.police.method,
            v.police.attachments,
            v.siteManager.name,
            v.siteManager.phone,
            v.police.conditionText,
            '上記のとおり許可する。ただし、次の条件に従うこと。',
            '用紙の大きさは、日本工業規格Ａ列４番とする。',
        ];
    }
    const common = [
        v.applicant.address,
        v.applicant.companyName,
        v.contact.name,
        v.contact.phone,
        v.applicant.tel,
        v.occupancy.purpose,
        `路線名${v.road.routeName}`,
        v.site.location,
        v.occupancy.name,
        v.occupancy.scaleNote,
        `${v.occupancy.quantity}㎡`,
        `約${approx}㎡`,
        formatReiwaRange(v.period.workFrom, v.period.workTo),
        formatReiwaRange(v.period.useFrom, v.period.useTo),
        v.occupancy.structure,
        v.occupancy.constructionMethod,
        '車道・歩道・その他',
    ];
    if (id === 'matsuyama-occupancy-apply') {
        return ['許可申請', '道路占用', '協議書', '新規', '変更', '道路管理者', v.matsuyama.mayorName, '第32条', '第35条', ...common, v.matsuyama.attachments, '※印の欄は，記入しないでください。'];
    }
    return ['許可', '道路占用', '回答書', ...common, '上記について次の条件により', '道路管理者', v.matsuyama.mayorName];
}

function usage(): never {
    console.error('使い方: npx tsx scripts/verify-road-permit-pdf.tsx --values <json> [--out <pdf>]');
    process.exit(1);
}

async function main() {
    const args = process.argv.slice(2);
    const arg = (name: string): string | null => {
        const i = args.indexOf(name);
        return i >= 0 ? args[i + 1] ?? null : null;
    };
    const valuesPath = arg('--values');
    const outPath = arg('--out');
    if (!valuesPath) usage();

    const raw = JSON.parse(fs.readFileSync(valuesPath, 'utf8')) as Record<string, unknown>;
    const values = normalizeRoadPermitValues(raw);
    const rawIds = Array.isArray(raw.formIds) ? raw.formIds.filter(isRoadPermitFormId) : [...ROAD_PERMIT_FORM_IDS];
    const formIds = sortFormIds(rawIds);
    if (formIds.length === 0) {
        console.error('formIds に様式が 1 つもありません');
        process.exit(1);
    }

    const buf = await renderToBuffer(<RoadPermitDocument values={values} formIds={formIds} />);
    if (outPath) {
        fs.writeFileSync(outPath, buf);
        console.log(`PDF を書き出しました: ${outPath}`);
    }

    const pages = await analyze(buf);
    const problems: string[] = [];
    if (pages.length !== formIds.length) problems.push(`ページ数=${pages.length}（期待 ${formIds.length}）`);
    formIds.forEach((id, i) => {
        const page = pages[i];
        if (!page) return;
        for (const t of expectedTexts(id, values)) {
            const n = norm(t);
            if (n === '') continue;
            if (!page.text.includes(n)) problems.push(`${i + 1}ページ目（${id}）に「${t}」が見つからない`);
        }
        if (page.maxX > MAX_X) problems.push(`${i + 1}ページ目 右端はみ出し maxX=${page.maxX}: ${page.overflow.join(' / ')}`);
        console.log(`${i + 1}ページ目 ${id}: 文字数 ${page.text.length} / 右端 maxX=${page.maxX}`);
    });

    console.log(`期間（警察）: ${formatReiwaYmdOrBlank(values.period.useFrom)}${formatHourLabel(values.period.timeFrom)}から${formatReiwaYmdOrBlank(values.period.useTo)}${formatHourLabel(values.period.timeTo)}まで`);
    console.log(`工事の期間（松山市）: ${formatReiwaRange(values.period.workFrom, values.period.workTo)}`);
    console.log(`数量: ${values.occupancy.quantity}㎡ / 面積: 約${effectiveApproxArea(values.occupancy.quantity, values.occupancy.areaApprox)}㎡`);

    if (problems.length === 0) {
        console.log('OK');
    } else {
        console.log('問題あり:');
        for (const p of problems) console.log(`  - ${p}`);
        process.exitCode = 1;
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
