import { FinanceProviders } from '../providers/FinanceProviders';

export default function FinanceLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <FinanceProviders>{children}</FinanceProviders>;
}
