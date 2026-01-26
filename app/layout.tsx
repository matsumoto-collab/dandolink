import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ProjectProvider } from "@/contexts/ProjectContext";
import { ProjectMasterProvider } from "@/contexts/ProjectMasterContext";
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
import { Toaster } from 'react-hot-toast';

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
                <Toaster
                    position="top-center"
                    toastOptions={{
                        duration: 4000,
                        style: {
                            background: '#363636',
                            color: '#fff',
                        },
                        success: {
                            duration: 3000,
                            style: {
                                background: '#22c55e',
                            },
                        },
                        error: {
                            duration: 5000,
                            style: {
                                background: '#ef4444',
                            },
                        },
                    }}
                />
                <AuthProvider>
                    <NavigationProvider>
                        <MasterDataProvider>
                            <ProjectProvider>
                                <ProjectMasterProvider>
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
                                </ProjectMasterProvider>
                            </ProjectProvider>
                        </MasterDataProvider>
                    </NavigationProvider>
                </AuthProvider>
            </body>
        </html>
    );
}
