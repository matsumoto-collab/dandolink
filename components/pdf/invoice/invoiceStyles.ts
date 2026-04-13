import { StyleSheet } from '@react-pdf/renderer';
import { PDF_COLORS as COLORS } from '../styles';

export const invoiceStyles = StyleSheet.create({
    page: {
        fontFamily: 'NotoSansJP',
        fontSize: 8,
        paddingTop: 25,
        paddingBottom: 40,
        paddingHorizontal: 30,
        backgroundColor: COLORS.white,
        color: COLORS.textPrimary,
    },

    // ===== Title =====
    titleText: { fontSize: 20, letterSpacing: 12, fontWeight: 'bold', color: COLORS.navy },

    // Column styles for portrait table
    cellNo: { width: 18, padding: 2, borderRightWidth: 0.5, borderRightColor: COLORS.borderMedium, justifyContent: 'center', alignItems: 'center' },
    cellName: { width: 120, padding: 2, borderRightWidth: 0.5, borderRightColor: COLORS.borderMedium, justifyContent: 'center' },
    cellSpec: { width: 100, padding: 2, borderRightWidth: 0.5, borderRightColor: COLORS.borderMedium, justifyContent: 'center' },
    cellQty: { width: 35, padding: 2, borderRightWidth: 0.5, borderRightColor: COLORS.borderMedium, justifyContent: 'center', alignItems: 'flex-end' },
    cellUnit: { width: 25, padding: 2, borderRightWidth: 0.5, borderRightColor: COLORS.borderMedium, justifyContent: 'center', alignItems: 'center' },
    cellPrice: { width: 50, padding: 2, borderRightWidth: 0.5, borderRightColor: COLORS.borderMedium, justifyContent: 'center', alignItems: 'flex-end' },
    cellAmount: { width: 60, padding: 2, borderRightWidth: 0.5, borderRightColor: COLORS.borderMedium, justifyContent: 'center', alignItems: 'flex-end' },
    cellRemarks: { flex: 1, padding: 2, justifyContent: 'center' },
    headerCellText: { fontSize: 9, color: COLORS.textSecondary, textAlign: 'center', width: '100%' },
    cellText: { fontSize: 9 },
    cellTextCenter: { fontSize: 9, textAlign: 'center' },
    cellTextRed: { fontSize: 9, color: COLORS.red },
    tableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.borderDark, minHeight: 16 },
    tableRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: COLORS.borderMedium, minHeight: 17 },
    tableRowLast: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: COLORS.borderMedium, minHeight: 17 },
    projectHeaderRow: { flexDirection: 'row', borderBottomWidth: 0.3, borderBottomColor: COLORS.borderLight, minHeight: 17 },
    totalRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: COLORS.borderDark, minHeight: 17 },
    totalLabelCell: { width: 273, padding: 2, borderRightWidth: 0.5, borderRightColor: COLORS.borderMedium, justifyContent: 'center', alignItems: 'flex-end' },
    totalSubtotalLabel: { width: 75, padding: 2, justifyContent: 'center', alignItems: 'flex-end' },
    totalAmountCell: { width: 60, padding: 2, borderRightWidth: 0.5, borderRightColor: COLORS.borderMedium, justifyContent: 'center', alignItems: 'flex-end' },
    totalRemarksCell: { flex: 1, padding: 2 },
    totalLabelText: { fontSize: 8, fontWeight: 'bold', color: COLORS.textSecondary },
    totalAmountText: { fontSize: 8, fontWeight: 'bold' },

    // Info table
    infoLabelCell: { width: 55, backgroundColor: COLORS.infoBg, paddingHorizontal: 3, paddingVertical: 2, borderRightWidth: 0.5, borderRightColor: COLORS.borderLight, justifyContent: 'center' },
    infoLabelText: { fontSize: 8, color: COLORS.textSecondary },
    infoValueCell: { flex: 1, paddingHorizontal: 3, paddingVertical: 2, justifyContent: 'center' },
    infoValueText: { fontSize: 8 },

    // Footer
    footer: { position: 'absolute', bottom: 12, left: 30, right: 30, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
    footerText: { fontSize: 6, color: COLORS.borderMedium },
});
