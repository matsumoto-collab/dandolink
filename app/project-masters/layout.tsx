import AuthenticatedLayout from '@/components/Layout/AuthenticatedLayout';

export default function ProjectMastersLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <AuthenticatedLayout>{children}</AuthenticatedLayout>;
}
