'use client';

import { UnitPriceMasterProvider } from "@/contexts/UnitPriceMasterContext";
import { ProjectMasterProvider } from "@/contexts/ProjectMasterContext";
import { ProjectProvider } from "@/contexts/ProjectContext";

export function MasterProviders({ children }: { children: React.ReactNode }) {
    return (
        <ProjectProvider>
            <UnitPriceMasterProvider>
                <ProjectMasterProvider>
                    {children}
                </ProjectMasterProvider>
            </UnitPriceMasterProvider>
        </ProjectProvider>
    );
}
