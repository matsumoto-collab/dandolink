import AuthenticatedLayout from '@/components/Layout/AuthenticatedLayout';

export default function SettingsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <AuthenticatedLayout>{children}</AuthenticatedLayout>;
}
