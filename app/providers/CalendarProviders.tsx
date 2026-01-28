'use client';

import { MasterDataProvider } from "@/contexts/MasterDataContext";
import { ProjectProvider } from "@/contexts/ProjectContext";
import { ProjectMasterProvider } from "@/contexts/ProjectMasterContext";
import { VacationProvider } from "@/contexts/VacationContext";
import { RemarksProvider } from "@/contexts/RemarksContext";
import { CalendarDisplayProvider } from "@/contexts/CalendarDisplayContext";
import { DailyReportProvider } from "@/contexts/DailyReportContext";

export function CalendarProviders({ children }: { children: React.ReactNode }) {
    return (
        <MasterDataProvider>
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
        </MasterDataProvider>
    );
}
