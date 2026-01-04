import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ProjectProvider } from "@/contexts/ProjectContext";
import { NavigationProvider } from "@/contexts/NavigationContext";
import { MasterDataProvider } from "@/contexts/MasterDataContext";
import { RemarksProvider } from "@/contexts/RemarksContext";
import { VacationProvider } from "@/contexts/VacationContext";
import { EstimateProvider } from "@/contexts/EstimateContext";
import { InvoiceProvider } from "@/contexts/InvoiceContext";
import { CompanyProvider } from '@/contexts/CompanyContext';
import { ProjectMasterProvider } from '@/contexts/ProjectMasterContext';
import { ProjectAssignmentProvider } from '@/contexts/ProjectAssignmentContext';
import { CustomerProvider } from '@/contexts/CustomerContext';
import { UnitPriceMasterProvider } from '@/contexts/UnitPriceMasterContext';
import AuthProvider from '@/components/AuthProvider';

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
    title: "施工管理システム - YuSystem",
    description: "建設・施工管理向けの業務管理システム",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="ja">
            <body className={inter.className}>
                <AuthProvider>
                    <NavigationProvider>
                        <MasterDataProvider>
                            <ProjectMasterProvider>
                                <ProjectAssignmentProvider>
                                    <ProjectProvider>
                                        <RemarksProvider>
                                            <VacationProvider>
                                                <EstimateProvider>
                                                    <InvoiceProvider>
                                                        <CompanyProvider>
                                                            <CustomerProvider>
                                                                <UnitPriceMasterProvider>
                                                                    {children}
                                                                </UnitPriceMasterProvider>
                                                            </CustomerProvider>
                                                        </CompanyProvider>
                                                    </InvoiceProvider>
                                                </EstimateProvider>
                                            </VacationProvider>
                                        </RemarksProvider>
                                    </ProjectProvider>
                                </ProjectAssignmentProvider>
                            </ProjectMasterProvider>
                        </MasterDataProvider>
                    </NavigationProvider>
                </AuthProvider>
            </body>
        </html>
    );
}
