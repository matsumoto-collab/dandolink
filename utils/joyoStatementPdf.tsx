'use client';

/**
 * 支払明細書 PDF の出力（ブラウザ側）。
 *
 * utils/attendanceMonthlyPdf.tsx と同じ作り: `pdf(<…/>).toBlob()` で Blob を作り、
 * `saveBlobWithShare` で保存する（スマホでは共有シートが開く＝出勤簿 PDF と同じ動き）。
 * 画面からは `await import('@/utils/joyoStatementPdf')` で読み込む（react-pdf を最初の表示に含めない）。
 *
 * 発行済みの明細は、発行した瞬間の写し（issuedSnapshot）から PDF を作る。
 * 下書き・未作成は、設定・対象者・自社情報・出勤簿の今の値でプレビューする（書類番号は出さない）。
 */
import { pdf } from '@react-pdf/renderer';
import {
    JoyoStatementPDF,
    type JoyoStatementPDFProps,
    type JoyoStatementPdfIssuer,
    type JoyoStatementPdfItem,
} from '@/components/pdf/JoyoStatementPDF';
import { buildAttendanceMonthlyPdfData } from '@/utils/attendanceMonthlyData';
import { computeJoyoTotals, recalcItems, type JoyoStatementItem } from '@/lib/joyoStatement';
import type { JoyoIssuedSnapshot, JoyoStatementRow } from '@/types/joyoStatement';
import { saveBlobWithShare, sanitizeFileName } from '@/utils/saveBlobWithShare';
import { logger } from '@/lib/logger';

// フォント登録のため style モジュールを読み込む
import '@/components/pdf/styles';

/** 編集中の値（未作成・下書きのプレビュー用） */
export interface JoyoStatementDraftValues {
    issueDate: string;
    paymentDate: string;
    subject: string;
    items: JoyoStatementItem[];
    includeAttendance: boolean;
}

const toPdfItem = (it: JoyoStatementItem): JoyoStatementPdfItem => ({
    name: it.name,
    quantity: it.quantity,
    unit: it.unit,
    unitPrice: it.unitPrice,
    amount: it.amount,
    note: it.note,
});

/** 発行済みの明細のうち、PDF を作るのに使う項目（管理者の画面の明細・本人の画面の明細のどちらでも渡せる形） */
export interface JoyoIssuedStatementForPdf {
    year: number;
    month: number;
    statementNo: string | null;
    issueDate: string;
    paymentDate: string;
    subject: string;
    items: JoyoStatementItem[];
    total: number;
    tax: number;
    includeAttendance: boolean;
    issuedSnapshot: JoyoIssuedSnapshot;
}

/**
 * 発行済みの明細の PDF の props を、発行した時点の写し（issuedSnapshot）から作る。
 * あとで設定・対象者・自社情報・出勤簿を直しても変わらない。合計は保存してある値をそのまま使う（計算し直さない）。
 * userId は出勤簿ページを作るときの本人の User.id（写しの出勤簿の記録を絞るのに使う）。
 */
export function buildIssuedJoyoStatementPdfProps(args: {
    userId: string;
    statement: JoyoIssuedStatementForPdf;
}): JoyoStatementPDFProps {
    const { userId, statement } = args;
    const { year, month } = statement;
    const snap = statement.issuedSnapshot;
    const attendance = statement.includeAttendance
        ? {
              year,
              month,
              userName: snap.attendanceUserName,
              ...buildAttendanceMonthlyPdfData(year, month, userId, snap.attendanceRecords),
          }
        : null;
    return {
        title: snap.title,
        statementNo: statement.statementNo,
        issueDate: statement.issueDate,
        paymentDate: statement.paymentDate,
        year,
        month,
        subject: statement.subject,
        recipient: snap.recipient,
        issuer: snap.issuer,
        items: statement.items.map(toPdfItem),
        total: statement.total,
        tax: statement.tax,
        footerNote: snap.footerNote || null,
        attendance,
    };
}

/**
 * 画面の状態から PDF の props を作る。
 * 発行済みは写し（issuedSnapshot）から、下書きは今の値から。
 * `draft` を省略すると保存済みの値を使う。明細が未作成（row.statement が null）のときは `draft` が必須。
 */
export function buildJoyoStatementPdfProps(args: {
    year: number;
    month: number;
    row: JoyoStatementRow;
    settings: { title: string; footerNote: string };
    issuer: JoyoStatementPdfIssuer;
    draft?: JoyoStatementDraftValues;
}): JoyoStatementPDFProps {
    const { year, month, row, settings, issuer, draft } = args;
    const { contractor, statement } = row;

    // 発行済み: 写しから作る（あとで設定・対象者・出勤簿を直しても変わらない）。作り方は buildIssuedJoyoStatementPdfProps の1か所
    if (statement && statement.status === 'issued' && statement.issuedSnapshot) {
        return buildIssuedJoyoStatementPdfProps({
            userId: contractor.userId,
            statement: { ...statement, year, month, issuedSnapshot: statement.issuedSnapshot },
        });
    }

    // 未作成・下書き: 今の値でプレビュー（サーバーと同じ式で合計を出す）
    const values: JoyoStatementDraftValues | null =
        draft ??
        (statement
            ? {
                  issueDate: statement.issueDate,
                  paymentDate: statement.paymentDate,
                  subject: statement.subject,
                  items: statement.items,
                  includeAttendance: statement.includeAttendance,
              }
            : null);
    if (!values) {
        throw new Error('明細が未作成のときは draft を渡してください');
    }
    const items = recalcItems(values.items);
    const { total, tax } = computeJoyoTotals(items);
    const attendance = values.includeAttendance
        ? {
              year,
              month,
              userName: contractor.userDisplayName,
              ...buildAttendanceMonthlyPdfData(year, month, contractor.userId, row.attendance.records),
          }
        : null;
    return {
        title: settings.title,
        // 書類番号は発行済みのときだけ出す（発行を取り消した下書きも出さない）
        statementNo: null,
        issueDate: values.issueDate,
        paymentDate: values.paymentDate,
        year,
        month,
        subject: values.subject,
        recipient: {
            name: contractor.recipientName,
            honorific: contractor.honorific,
            postalCode: contractor.postalCode,
            address: contractor.address,
            registrationNumber: contractor.registrationNumber,
        },
        issuer,
        items: items.map(toPdfItem),
        total,
        tax,
        footerNote: settings.footerNote || null,
        attendance,
    };
}

/** プレビュー用の Blob */
export async function generateJoyoStatementPdfBlob(props: JoyoStatementPDFProps): Promise<Blob> {
    return pdf(<JoyoStatementPDF {...props} />).toBlob();
}

/** PDF を保存する（スマホは共有）。ファイル名＝`<書類の名前>_<宛名>_<年>年<月>月分.pdf` */
export async function exportJoyoStatementPDF(props: JoyoStatementPDFProps): Promise<void> {
    try {
        const blob = await generateJoyoStatementPdfBlob(props);
        const fileName = sanitizeFileName(`${props.title}_${props.recipient.name}_${props.year}年${props.month}月分.pdf`);
        await saveBlobWithShare(blob, fileName, 'application/pdf', `${props.title}をお送りします`);
    } catch (error) {
        logger.error('支払明細書PDF生成エラー:', error);
        throw error;
    }
}
