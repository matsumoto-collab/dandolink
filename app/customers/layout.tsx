import AuthenticatedLayout from '@/components/Layout/AuthenticatedLayout';

export default function CustomersLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <AuthenticatedLayout>{children}</AuthenticatedLayout>;
}
