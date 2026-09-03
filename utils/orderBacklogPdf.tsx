'use client';

/**
 * 受注明細書 PDF のクライアント側エクスポート。
 * ※ 本体は Phase 3 で差し替える（components/pdf/OrderBacklogPDF.tsx を pdf().toBlob() で描画してダウンロード）。
 *   画面側がこの入口だけを先に参照できるように、シグネチャを固定した仮実装を置いている。
 */
import type { OrderBacklogSheet } from '@/lib/orderBacklog/render';

export async function exportOrderBacklogPDF(_sheet: OrderBacklogSheet, _fileName: string): Promise<void> {
    throw new Error('PDF出力は準備中です');
}
