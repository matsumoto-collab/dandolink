'use client';

// All master-related state has been migrated to Zustand stores
// - Projects: calendarStore + useProjects hook
// - ProjectMasters: calendarStore + useProjectMasters hook

export function MasterProviders({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
