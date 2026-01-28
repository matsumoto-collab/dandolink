import { CalendarProviders } from '../providers/CalendarProviders';

export default function CalendarLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <CalendarProviders>{children}</CalendarProviders>;
}
