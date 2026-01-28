'use client';

import { MasterDataProvider } from "@/contexts/MasterDataContext";
import { CompanyProvider } from "@/contexts/CompanyContext";
import { CustomerProvider } from "@/contexts/CustomerContext";
import { UnitPriceMasterProvider } from "@/contexts/UnitPriceMasterContext";
import { ProjectMasterProvider } from "@/contexts/ProjectMasterContext";
import { ProjectProvider } from "@/contexts/ProjectContext";

export function MasterProviders({ children }: { children: React.ReactNode }) {
    return (
        <MasterDataProvider>
            <CompanyProvider>
                <CustomerProvider>
                    <ProjectProvider>
                        <UnitPriceMasterProvider>
                            <ProjectMasterProvider>
                                {children}
                            </ProjectMasterProvider>
                        </UnitPriceMasterProvider>
                    </ProjectProvider>
                </CustomerProvider>
            </CompanyProvider>
        </MasterDataProvider>
    );
}
