'use client';

// All finance-related state has been migrated to Zustand stores
// - Projects: calendarStore + useProjects hook
// - Estimates: financeStore + useEstimates hook
// - Invoices: financeStore + useInvoices hook

export function FinanceProviders({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
