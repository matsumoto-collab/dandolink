'use client';

// All calendar-related state has been migrated to Zustand stores
// - Projects: calendarStore + useProjects hook
// - ProjectMasters: calendarStore + useProjectMasters hook
// - CalendarDisplay: calendarStore + useCalendarDisplay hook
// - DailyReports: calendarStore + useDailyReports hook

export function CalendarProviders({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
