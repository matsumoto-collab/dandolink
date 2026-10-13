/**
 * @jest-environment node
 */
/**
 * /api/road-permits/settings（担当者の候補）の配線のテスト。
 * 候補の正規化の中身は __tests__/lib/roadPermitContacts.test.ts で見ている。ここは
 * 権限・入力チェック・DB の読み書き（1 行だけ・upsert）を見る。
 */
import { NextRequest, NextResponse } from 'next/server';
import { GET, PUT } from '@/app/api/road-permits/settings/route';
import { prisma } from '@/lib/prisma';
import { requireManagerOrAbove, validationErrorResponse } from '@/lib/api/utils';

const putReq = (body: unknown) =>
    new NextRequest('http://localhost/api/road-permits/settings', {
        method: 'PUT',
        body: typeof body === 'string' ? body : JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
    });

describe('/api/road-permits/settings', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: { user: { id: 'u1', role: 'manager' } }, error: null });
        (prisma.roadPermitSetting.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.roadPermitSetting.upsert as jest.Mock).mockImplementation(
            async ({ create }: { create: { contacts: unknown } }) => ({ contacts: create.contacts }),
        );
    });

    describe('GET', () => {
        it('権限が無ければそのエラーを返し、DB は読まない', async () => {
            const err = NextResponse.json({ error: '管理者またはマネージャー権限が必要です' }, { status: 403 });
            (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: null, error: err });

            const res = await GET();
            expect(res.status).toBe(403);
            expect(prisma.roadPermitSetting.findUnique).not.toHaveBeenCalled();
        });

        it('行が無ければ空の候補', async () => {
            const res = await GET();
            const json = await res.json();
            expect(res.status).toBe(200);
            expect(res.headers.get('Cache-Control')).toBe('no-store');
            expect(json).toEqual({ contacts: [] });
            expect((prisma.roadPermitSetting.findUnique as jest.Mock).mock.calls[0][0]).toMatchObject({ where: { id: 'default' } });
        });

        it('行があれば候補を正規化して返す（空白を取る・空の行は落とす・壊れた JSON でも落ちない）', async () => {
            (prisma.roadPermitSetting.findUnique as jest.Mock).mockResolvedValue({
                contacts: [{ name: ' 今井　公一郎 ', phone: '089-000-0000' }, { name: '', phone: ' ' }, 'x', { name: '三生　浩人' }],
            });
            const res = await GET();
            expect(await res.json()).toEqual({
                contacts: [
                    { name: '今井　公一郎', phone: '089-000-0000' },
                    { name: '三生　浩人', phone: '' },
                ],
            });

            (prisma.roadPermitSetting.findUnique as jest.Mock).mockResolvedValue({ contacts: '壊れた' });
            expect(await (await GET()).json()).toEqual({ contacts: [] });
        });
    });

    describe('PUT', () => {
        it('権限が無ければそのエラーを返し、書かない', async () => {
            const err = NextResponse.json({ error: '管理者またはマネージャー権限が必要です' }, { status: 403 });
            (requireManagerOrAbove as jest.Mock).mockResolvedValue({ session: null, error: err });

            const res = await PUT(putReq({ contacts: [{ name: '今井', phone: '' }] }));
            expect(res.status).toBe(403);
            expect(prisma.roadPermitSetting.upsert).not.toHaveBeenCalled();
        });

        it('候補を丸ごと置き換えて保存し、保存後の候補を返す（行が無ければ作る＝upsert・並び順を保つ）', async () => {
            const res = await PUT(
                putReq({
                    contacts: [
                        { name: ' 今井　公一郎 ', phone: ' 089-000-0000 ' },
                        { name: '三生　浩人', phone: '090-1111-2222' },
                    ],
                }),
            );
            const json = await res.json();
            expect(res.status).toBe(200);
            expect(res.headers.get('Cache-Control')).toBe('no-store');
            expect(json).toEqual({
                contacts: [
                    { name: '今井　公一郎', phone: '089-000-0000' },
                    { name: '三生　浩人', phone: '090-1111-2222' },
                ],
            });

            const args = (prisma.roadPermitSetting.upsert as jest.Mock).mock.calls[0][0];
            expect(args.where).toEqual({ id: 'default' });
            expect(args.create).toEqual({
                id: 'default',
                contacts: [
                    { name: '今井　公一郎', phone: '089-000-0000' },
                    { name: '三生　浩人', phone: '090-1111-2222' },
                ],
                updatedBy: 'u1',
            });
            expect(args.update).toEqual({ contacts: args.create.contacts, updatedBy: 'u1' });
        });

        it('空の並びで保存できる（候補を全部消す）', async () => {
            const res = await PUT(putReq({ contacts: [] }));
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ contacts: [] });
            expect((prisma.roadPermitSetting.upsert as jest.Mock).mock.calls[0][0].create.contacts).toEqual([]);
        });

        it('名前が空の行があれば 400（電話だけの行は保存できない）', async () => {
            const res = await PUT(putReq({ contacts: [{ name: '  ', phone: '090-1111-2222' }] }));
            expect(res.status).toBe(400);
            // テスト環境の validationErrorResponse は文言を固定で返すので、渡した文言で確かめる
            expect((validationErrorResponse as jest.Mock).mock.calls[0][0]).toContain('名前');
            expect(prisma.roadPermitSetting.upsert).not.toHaveBeenCalled();
        });

        it('形が違えば 400（contacts が無い・配列でない・JSON でない・多すぎる）', async () => {
            expect((await PUT(putReq({}))).status).toBe(400);
            expect((await PUT(putReq({ contacts: 'x' }))).status).toBe(400);
            expect((await PUT(putReq('{壊れた'))).status).toBe(400);
            const many = Array.from({ length: 21 }, (_, i) => ({ name: `人${i}`, phone: '' }));
            expect((await PUT(putReq({ contacts: many }))).status).toBe(400);
            expect(prisma.roadPermitSetting.upsert).not.toHaveBeenCalled();
        });

        it('知らないキーは落とす（name・phone だけ保存する）', async () => {
            await PUT(putReq({ contacts: [{ name: '今井', phone: '', email: 'x@example.com' }] }));
            expect((prisma.roadPermitSetting.upsert as jest.Mock).mock.calls[0][0].create.contacts).toEqual([{ name: '今井', phone: '' }]);
        });
    });
});
