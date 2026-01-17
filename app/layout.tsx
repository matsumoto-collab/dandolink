import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ProjectProvider } from "@/contexts/ProjectContext";
import { ProjectMasterProvider } from "@/contexts/ProjectMasterContext";
import { AssignmentProvider } from "@/contexts/AssignmentContext";
import { NavigationProvider } from "@/contexts/NavigationContext";
import { MasterDataProvider } from "@/contexts/MasterDataContext";
import { RemarksProvider } from "@/contexts/RemarksContext";
import { VacationProvider } from "@/contexts/VacationContext";
import { CalendarDisplayProvider } from "@/contexts/CalendarDisplayContext";
import { EstimateProvider } from "@/contexts/EstimateContext";
import { InvoiceProvider } from "@/contexts/InvoiceContext";
import { CompanyProvider } from '@/contexts/CompanyContext';
import { CustomerProvider } from '@/contexts/CustomerContext';
import { UnitPriceMasterProvider } from '@/contexts/UnitPriceMasterContext';
import { DailyReportProvider } from '@/contexts/DailyReportContext';
import { ProfitDashboardProvider } from '@/contexts/ProfitDashboardContext';
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
                            <ProjectProvider>
                                <ProjectMasterProvider>
                                    <AssignmentProvider>
                                        <RemarksProvider>
                                            <VacationProvider>
                                                <CalendarDisplayProvider>
                                                    <EstimateProvider>
                                                        <InvoiceProvider>
                                                            <CompanyProvider>
                                                                <CustomerProvider>
                                                                    <UnitPriceMasterProvider>
                                                                        <DailyReportProvider>
                                                                            <ProfitDashboardProvider>
                                                                                {children}
                                                                            </ProfitDashboardProvider>
                                                                        </DailyReportProvider>
                                                                    </UnitPriceMasterProvider>
                                                                </CustomerProvider>
                                                            </CompanyProvider>
                                                        </InvoiceProvider>
                                                    </EstimateProvider>
                                                </CalendarDisplayProvider>
                                            </VacationProvider>
                                        </RemarksProvider>
                                    </AssignmentProvider>
                                </ProjectMasterProvider>
                            </ProjectProvider>
                        </MasterDataProvider>
                    </NavigationProvider>
                </AuthProvider>
            </body>
        </html>
    );
}
