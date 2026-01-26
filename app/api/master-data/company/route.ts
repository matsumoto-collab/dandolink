import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, serverErrorResponse } from '@/lib/api/utils';

export async function GET() {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        let company = await prisma.companyInfo.findFirst({ where: { id: 'default' } });
        if (!company) {
            company = await prisma.companyInfo.create({
                data: { id: 'default', name: '株式会社 焼伸 工業', postalCode: '〒799-3104', address: '伊予市上三谷甲3517番地', tel: 'TEL:089-989-7350', fax: 'FAX:089-989-7351', representative: '今井 公' },
            });
        }
        return NextResponse.json(company);
    } catch (error) {
        return serverErrorResponse('会社情報取得', error);
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const { error } = await requireAuth();
        if (error) return error;

        const { name, postalCode, address, tel, fax, email, representativeTitle, representative, sealImage, licenseNumber, registrationNumber, bankAccounts } = await request.json();

        const data = {
            name, postalCode, address, tel,
            fax: fax || null, email: email || null, representativeTitle: representativeTitle || null,
            representative, sealImage: sealImage || null, licenseNumber: licenseNumber || null,
            registrationNumber: registrationNumber || null, bankAccounts: bankAccounts || null,
        };

        const company = await prisma.companyInfo.upsert({ where: { id: 'default' }, update: data, create: { id: 'default', ...data } });
        return NextResponse.json(company);
    } catch (error) {
        return serverErrorResponse('会社情報更新', error);
    }
}
