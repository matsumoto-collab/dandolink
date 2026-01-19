import AuthenticatedLayout from '@/components/Layout/AuthenticatedLayout';

export default function DailyReportsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <AuthenticatedLayout>{children}</AuthenticatedLayout>;
}
