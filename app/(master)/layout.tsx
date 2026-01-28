import { MasterProviders } from '../providers/MasterProviders';

export default function MasterLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <MasterProviders>{children}</MasterProviders>;
}
