import AuthenticatedLayout from '@/components/Layout/AuthenticatedLayout';

export default function ProfitDashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <AuthenticatedLayout>{children}</AuthenticatedLayout>;
}
