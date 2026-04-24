#!/usr/bin/env node
/**
 * pdfjs-dist の cmaps/ と standard_fonts/ を public/ にコピーする。
 *
 * pdfjs は CJK（日本語など）の CIDフォントや PDF 標準14フォントを描画するために
 * これらのアセットを実行時にロードする必要がある。
 * postinstall で実行することで、Vercel デプロイ時も自動的に配置される。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_BASE = path.join(ROOT, 'node_modules', 'pdfjs-dist');
const DEST_BASE = path.join(ROOT, 'public');

const TARGETS = ['cmaps', 'standard_fonts'];

function copyDir(src, dest) {
    if (!fs.existsSync(src)) {
        console.warn(`[copy-pdfjs-assets] skip: ${src} not found`);
        return;
    }
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(src, dest, { recursive: true });
    const count = fs.readdirSync(dest).length;
    console.log(`[copy-pdfjs-assets] copied ${count} files: ${path.relative(ROOT, src)} -> ${path.relative(ROOT, dest)}`);
}

for (const dir of TARGETS) {
    copyDir(path.join(SRC_BASE, dir), path.join(DEST_BASE, dir));
}
