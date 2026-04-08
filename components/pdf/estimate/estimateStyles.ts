import { StyleSheet } from '@react-pdf/renderer';
import { PDF_COLORS as COLORS } from '../styles';

export const estimateStyles = StyleSheet.create({
    // Page — landscape
    page: {
        fontFamily: 'NotoSansJP',
        fontSize: 7.5,
        paddingTop: 14,
        paddingBottom: 14,
        paddingHorizontal: 30,
        backgroundColor: COLORS.white,
        color: COLORS.textPrimary,
    },

    // ===== Title =====
    titleCenter: {
        alignItems: 'center',
        marginTop: 2,
        marginBottom: 4,
    },
    titleText: {
        fontSize: 20,
        letterSpacing: 12,
        fontWeight: 'bold',
        color: COLORS.navy,
    },

    // ===== Header row: customer left, company right =====
    coverHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 4,
    },

    // Left: Customer + amount
    customerArea: { width: 280 },
    customerName: {
        fontSize: 14,
        fontWeight: 'bold',
        paddingBottom: 3,
        borderBottomWidth: 1.5,
        borderBottomColor: COLORS.navy,
    },
    greetingText: {
        fontSize: 8,
        marginTop: 3,
        color: COLORS.textSecondary,
        lineHeight: 1.4,
    },

    // Amount
    amountSection: { marginTop: 4, width: '100%' },
    amountMainRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        borderBottomWidth: 1.5,
        borderBottomColor: COLORS.textPrimary,
        paddingBottom: 2,
        marginBottom: 1,
    },
    amountLabel: { fontSize: 10, fontWeight: 'bold', width: '30%' },
    amountValue: { fontSize: 14, fontWeight: 'bold', textAlign: 'center', width: '40%' },
    amountTaxNote: { fontSize: 8.5, color: COLORS.textSecondary, width: '30%' },
    amountSubRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderLight,
        borderBottomStyle: 'dashed',
        paddingVertical: 1,
    },
    amountSubLabel: { fontSize: 9.5, color: COLORS.textSecondary, width: '30%', textAlign: 'center' },
    amountSubValue: { fontSize: 9.5, width: '40%', textAlign: 'center' },

    // Right: Date + Company
    rightArea: { flex: 1, alignItems: 'flex-end' },
    estimateNoText: { fontSize: 8.5, color: COLORS.textSecondary },
    companyRow: { flexDirection: 'row', alignItems: 'flex-start' },
    companyInfoBlock: { alignItems: 'flex-end' },
    companyName: { fontSize: 10, fontWeight: 'bold', marginBottom: 2, letterSpacing: 1 },
    companyText: { fontSize: 8.5, color: COLORS.textSecondary, marginBottom: 1, textAlign: 'right' },
    stampBox: { width: 45, height: 45 },

    // ===== Info Table + Remarks =====
    infoTable: { flexDirection: 'row', marginBottom: 4 },
    infoLeft: { width: '60%', borderWidth: 0.5, borderColor: COLORS.borderMedium },
    infoRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderLight,
        minHeight: 14,
    },
    infoRowLast: { flexDirection: 'row', minHeight: 14 },
    infoLabelCell: {
        width: 55,
        backgroundColor: COLORS.infoBg,
        paddingHorizontal: 3,
        paddingVertical: 2,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.borderLight,
        justifyContent: 'center',
    },
    infoLabelText: { fontSize: 8.5, color: COLORS.textSecondary },
    infoValueCell: { flex: 1, paddingHorizontal: 3, paddingVertical: 2, justifyContent: 'center' },
    infoValueText: { fontSize: 8.5 },

    remarksArea: { width: '38%', marginLeft: '2%', borderWidth: 0.5, borderColor: COLORS.borderMedium },
    remarksHeader: {
        backgroundColor: COLORS.infoBg,
        paddingHorizontal: 3,
        paddingVertical: 2,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderLight,
    },
    remarksHeaderText: { fontSize: 8.5, color: COLORS.textSecondary, textAlign: 'center' },
    remarksBody: { flex: 1, padding: 3 },
    remarksText: { fontSize: 8.5, color: COLORS.textSecondary, lineHeight: 1.4 },

    // ===== Details Table =====
    table: { width: '100%', borderWidth: 1, borderColor: COLORS.borderDark },
    tableHeader: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: COLORS.borderDark,
        minHeight: 18,
    },
    tableRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderMedium,
        minHeight: 18,
    },
    tableRowLast: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderMedium,
        minHeight: 18,
    },

    // Columns: No(20) + Name(180) + Spec(180) + Qty(50) + Unit(35) + Price(65) + Amount(80) + Remarks(flex)
    cellNo: { width: 20, padding: 3, borderRightWidth: 0.5, borderRightColor: COLORS.borderMedium, justifyContent: 'center', alignItems: 'center' },
    cellName: { width: 180, padding: 3, borderRightWidth: 0.5, borderRightColor: COLORS.borderMedium, justifyContent: 'center' },
    cellSpec: { width: 180, padding: 3, borderRightWidth: 0.5, borderRightColor: COLORS.borderMedium, justifyContent: 'center' },
    cellQty: { width: 50, padding: 3, borderRightWidth: 0.5, borderRightColor: COLORS.borderMedium, justifyContent: 'center', alignItems: 'flex-end' },
    cellUnit: { width: 35, padding: 3, borderRightWidth: 0.5, borderRightColor: COLORS.borderMedium, justifyContent: 'center', alignItems: 'center' },
    cellPrice: { width: 65, padding: 3, borderRightWidth: 0.5, borderRightColor: COLORS.borderMedium, justifyContent: 'center', alignItems: 'flex-end' },
    cellAmount: { width: 80, padding: 3, borderRightWidth: 0.5, borderRightColor: COLORS.borderMedium, justifyContent: 'center', alignItems: 'flex-end' },
    cellRemarks: { flex: 1, padding: 3, justifyContent: 'center' },

    // Cell text
    headerCellText: { fontSize: 8.5, color: COLORS.textSecondary, textAlign: 'center', width: '100%' },
    cellText: { fontSize: 8.5 },
    cellTextCenter: { fontSize: 8.5, textAlign: 'center' },
    cellTextRed: { fontSize: 8.5, color: COLORS.red },

    // Total section
    totalRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: COLORS.borderDark, minHeight: 20 },
    totalRowFinal: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderDark,
        minHeight: 22,
        backgroundColor: COLORS.totalBg,
    },
    totalLabelCell: { width: 430, padding: 3, borderRightWidth: 0.5, borderRightColor: COLORS.borderMedium, justifyContent: 'center', alignItems: 'flex-end' },
    totalSubtotalLabel: { width: 100, padding: 3, justifyContent: 'center', alignItems: 'flex-end' },
    totalAmountCell: { width: 80, padding: 3, borderRightWidth: 0.5, borderRightColor: COLORS.borderMedium, justifyContent: 'center', alignItems: 'flex-end' },
    totalRemarksCell: { flex: 1, padding: 3 },
    totalLabelText: { fontSize: 9, fontWeight: 'bold', color: COLORS.textSecondary },
    totalAmountText: { fontSize: 9, fontWeight: 'bold' },

    // Details page header
    detailsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, marginTop: 4 },
    detailsTitle: { fontSize: 14, letterSpacing: 8, color: COLORS.navy, fontWeight: 'bold', paddingBottom: 2, borderBottomWidth: 1.5, borderBottomColor: COLORS.navy },
    detailsSubInfo: { fontSize: 8, color: COLORS.textSecondary },

    // Footer
    footer: { position: 'absolute', bottom: 10, left: 30, right: 30, flexDirection: 'row', justifyContent: 'space-between' },
    footerText: { fontSize: 6, color: COLORS.borderMedium },
});
