import AuthenticatedLayout from '@/components/Layout/AuthenticatedLayout';

export default function ProjectsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <AuthenticatedLayout>{children}</AuthenticatedLayout>;
}
