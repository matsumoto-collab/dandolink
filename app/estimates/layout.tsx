import AuthenticatedLayout from '@/components/Layout/AuthenticatedLayout';

export default function EstimatesLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <AuthenticatedLayout>{children}</AuthenticatedLayout>;
}
