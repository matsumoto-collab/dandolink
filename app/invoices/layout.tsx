import AuthenticatedLayout from '@/components/Layout/AuthenticatedLayout';

export default function InvoicesLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <AuthenticatedLayout>{children}</AuthenticatedLayout>;
}
