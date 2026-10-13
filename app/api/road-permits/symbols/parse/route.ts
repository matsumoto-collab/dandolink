import { NextRequest, NextResponse } from 'next/server';
import { errorResponse, requireManagerOrAbove, serverErrorResponse } from '@/lib/api/utils';
import { logger } from '@/lib/logger';
import { parseJwwBlocks } from '@/lib/roadPermit/symbols/jwwImport';
import type { ParseJwwResponse } from '@/types/roadPermitSymbol';

// ezjww は wasm をファイルで読むので Node で動かす（next.config.js で外部化・ファイルトレース済み）
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * POST /api/road-permits/symbols/parse  multipart/form-data { file: .jww / .jws }
 * JWW を読んで、ブロックごとの記号の候補（形・大きさ・線の本数・近くの文字）を返す。ファイルは保存しない。
 * 読む中身は lib/roadPermit/symbols/jwwImport.ts の parseJwwBlocks（純粋関数）。ここはファイルの受け取りと ezjww の呼び出しだけ。
 */
export async function POST(req: NextRequest) {
    try {
        const { error } = await requireManagerOrAbove();
        if (error) return error;

        const formData = await req.formData().catch(() => null);
        const file = formData?.get('file');
        if (!file || typeof file === 'string') return errorResponse('ファイルが選ばれていません', 400);
        const fileName = file.name || 'ファイル';
        if (!/\.(jww|jws)$/i.test(fileName)) return errorResponse('JWW のファイル（.jww か .jws）を選んでください', 400);
        if (file.size > MAX_FILE_SIZE) return errorResponse('ファイルが大きすぎます（10MB まで）', 400);

        const bytes = new Uint8Array(await file.arrayBuffer());
        const ez = await import('ezjww');
        const format = ez.detectFileFormat(bytes);
        if (format === 'jwc') return errorResponse('JWC のファイルは読めません。JWW か JWS を選んでください', 400);
        if (format !== 'jww' && format !== 'jws') return errorResponse('JWW のファイルとして読めませんでした', 400);

        let doc;
        try {
            doc = format === 'jws' ? ez.readJwsDocument(bytes) : ez.readDocument(bytes);
        } catch (e) {
            logger.warn('JWW の読み込みに失敗', { fileName, error: e instanceof Error ? e.message : String(e) });
            return errorResponse('JWW のファイルを読めませんでした（壊れているか、対応していない版です）', 400);
        }

        const { blocks, warnings } = parseJwwBlocks(doc);
        if (blocks.length === 0) {
            return errorResponse('ブロックがありません。JWW でブロック化（ブロック図形登録）してから取り込んでください', 400);
        }

        const body: ParseJwwResponse = { fileName, blocks, warnings };
        return NextResponse.json(body, { headers: NO_STORE });
    } catch (error) {
        return serverErrorResponse('JWW の読み込み', error);
    }
}
