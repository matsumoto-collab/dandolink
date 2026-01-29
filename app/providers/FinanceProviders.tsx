'use client';

import { UnitPriceMasterProvider } from "@/contexts/UnitPriceMasterContext";
import { EstimateProvider } from "@/contexts/EstimateContext";
import { InvoiceProvider } from "@/contexts/InvoiceContext";
import { ProjectProvider } from "@/contexts/ProjectContext";

export function FinanceProviders({ children }: { children: React.ReactNode }) {
    return (
        <ProjectProvider>
            <UnitPriceMasterProvider>
                <EstimateProvider>
                    <InvoiceProvider>
                        {children}
                    </InvoiceProvider>
                </EstimateProvider>
            </UnitPriceMasterProvider>
        </ProjectProvider>
    );
}
