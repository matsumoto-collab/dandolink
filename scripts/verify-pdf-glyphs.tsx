/**
 * 旧字・記号が PDF に実際に描画されるかを検証する（読み取り専用・DB非依存）。
 *
 * 同梱の全グリフ TTF（Regular / Bold）でテスト PDF を生成し、pdfjs で
 * テキストを抽出して 1 文字も欠落していないことを確認する。
 * 欠落フォントだと該当文字は描画されず、抽出テキストからも消える。
 *
 * 実行: npx tsx scripts/verify-pdf-glyphs.tsx
 */
import React from 'react';
import { Document, Page, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { commonStyles, sanitizePdfText } from '../components/pdf/styles';
// side-effect: NotoSansJP を同梱 TTF（Regular/Bold）で再登録する
import { usingLocalFont } from '../lib/pdf/registerServerFonts';

// 実データに存在し、CDN サブセットでは欠落していた文字を網羅
const SAMPLE = '濵田様邸 髙橋 西﨑 濱田 ①②③④ Ⅱ ※ № ★ ㈱ → ㎡ ㎥ ⅿ';

function TestDoc() {
    const text = sanitizePdfText(SAMPLE);
    return (
        <Document>
            <Page size="A4" style={commonStyles.page}>
                <View>
                    <Text>{text}</Text>
                    <Text style={{ fontWeight: 'bold' }}>{text}</Text>
                </View>
            </Page>
        </Document>
    );
}

async function extractText(buf: Buffer): Promise<string> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({
        data: new Uint8Array(buf),
        useSystemFonts: false,
    }).promise;
    let out = '';
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        out += content.items.map((it: any) => it.str ?? '').join('');
    }
    return out;
}

async function main() {
    console.log(`同梱フォント使用: ${usingLocalFont}`);
    const buf = Buffer.from(await renderToBuffer(<TestDoc />));
    console.log(`PDF生成: ${(buf.length / 1024).toFixed(1)}KB`);

    const extracted = await extractText(buf);
    const expected = sanitizePdfText(SAMPLE).replace(/\s/g, '');
    const missing = [...new Set([...expected])].filter((ch) => !extracted.includes(ch));

    console.log(`抽出テキスト: ${extracted}`);
    if (missing.length === 0) {
        console.log('✅ 全ての文字が PDF に描画されている');
    } else {
        console.log(`❌ 描画されなかった文字: ${missing.join(' ')}`);
        process.exitCode = 1;
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
