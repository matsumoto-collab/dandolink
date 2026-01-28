'use client';

import { CompanyProvider } from "@/contexts/CompanyContext";
import { CustomerProvider } from "@/contexts/CustomerContext";
import { UnitPriceMasterProvider } from "@/contexts/UnitPriceMasterContext";
import { EstimateProvider } from "@/contexts/EstimateContext";
import { InvoiceProvider } from "@/contexts/InvoiceContext";
import { ProjectProvider } from "@/contexts/ProjectContext";

export function FinanceProviders({ children }: { children: React.ReactNode }) {
    return (
        <CompanyProvider>
            <CustomerProvider>
                <ProjectProvider>
                    <UnitPriceMasterProvider>
                        <EstimateProvider>
                            <InvoiceProvider>
                                {children}
                            </InvoiceProvider>
                        </EstimateProvider>
                    </UnitPriceMasterProvider>
                </ProjectProvider>
            </CustomerProvider>
        </CompanyProvider>
    );
}
