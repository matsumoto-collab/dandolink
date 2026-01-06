import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';

// GET: Fetch company info
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        let company = await prisma.companyInfo.findFirst({
            where: { id: 'default' },
        });

        // Create default if not exists
        if (!company) {
            company = await prisma.companyInfo.create({
                data: {
                    id: 'default',
                    name: '株式会社 焼伸 工業',
                    postalCode: '〒799-3104',
                    address: '伊予市上三谷甲3517番地',
                    tel: 'TEL:089-989-7350',
                    fax: 'FAX:089-989-7351',
                    representative: '今井 公',
                },
            });
        }

        return NextResponse.json(company);
    } catch (error) {
        console.error('Failed to fetch company info:', error);
        return NextResponse.json({ error: 'Failed to fetch company info' }, { status: 500 });
    }
}

// PATCH: Update company info
export async function PATCH(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { name, postalCode, address, tel, fax, email, representative, sealImage } = body;

        const company = await prisma.companyInfo.upsert({
            where: { id: 'default' },
            update: {
                name,
                postalCode,
                address,
                tel,
                fax: fax || null,
                email: email || null,
                representative,
                sealImage: sealImage || null,
            },
            create: {
                id: 'default',
                name,
                postalCode,
                address,
                tel,
                fax: fax || null,
                email: email || null,
                representative,
                sealImage: sealImage || null,
            },
        });

        return NextResponse.json(company);
    } catch (error) {
        console.error('Failed to update company info:', error);
        return NextResponse.json({ error: 'Failed to update company info' }, { status: 500 });
    }
}
