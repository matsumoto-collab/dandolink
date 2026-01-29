'use client';

import { ProjectProvider } from "@/contexts/ProjectContext";
import { ProjectMasterProvider } from "@/contexts/ProjectMasterContext";
import { VacationProvider } from "@/contexts/VacationContext";
import { RemarksProvider } from "@/contexts/RemarksContext";
import { CalendarDisplayProvider } from "@/contexts/CalendarDisplayContext";
import { DailyReportProvider } from "@/contexts/DailyReportContext";

export function CalendarProviders({ children }: { children: React.ReactNode }) {
    return (
        <ProjectProvider>
            <ProjectMasterProvider>
                <VacationProvider>
                    <RemarksProvider>
                        <CalendarDisplayProvider>
                            <DailyReportProvider>
                                {children}
                            </DailyReportProvider>
                        </CalendarDisplayProvider>
                    </RemarksProvider>
                </VacationProvider>
            </ProjectMasterProvider>
        </ProjectProvider>
    );
}
