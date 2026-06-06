import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { prisma } from '@/lib/prisma';
import {
    requireAuth,
    errorResponse,
    notFoundResponse,
    validationErrorResponse,
    serverErrorResponse,
    parseJsonField,
} from '@/lib/api/utils';
import { logger } from '@/lib/logger';
import { extractAssigneeIds } from '@/lib/projectAssignees';
import { supabaseAdmin, STORAGE_BUCKET } from '@/lib/supabase-admin';
import { pushLineMessage, type LineMessage } from '@/lib/line';
import { buildCustomerMessage, workLabelFromConstructionTypeName } from '@/lib/customerNotice';
import type { ContactPerson } from '@/types/customer';

/**
 * 作業の開始/完了を顧客担当者のLINEへ送る（ワンタップ送信）。
 * - GET: ダイアログ表示用のコンテキスト（送信先・写真候補・文面・送信済み状況）
 * - POST: 実送信（完了はテキスト＋写真、開始はテキストのみ。写真はWebP→JPEG変換して署名URLで渡す）
 * kind=start|complete（既定 complete）。認可: admin/manager または案件担当者(createdBy)。
 */
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const SIGNED_TTL = 3600;
const LINE_MAX_MESSAGES_PER_PUSH = 5;
// 既定で選ぶ「この完了の写真」= 直近この時間内にアップされたもの
const RECENT_PHOTO_MS = 24 * 60 * 60 * 1000;
// 顧客へ送れる写真カテゴリ（survey/instruction/document など内部用は除外）
const PHOTO_CATEGORIES = ['assembly', 'demolition', 'other'];

type AssignmentWithPm = NonNullable<Awaited<ReturnType<typeof loadAssignment>>>;

function loadAssignment(id: string) {
    return prisma.projectAssignment.findUnique({
        where: { id },
        include: { projectMaster: true },
    });
}

function canNotify(role: string | undefined, userId: string | undefined, createdBy: string | null | undefined): boolean {
    if (role === 'admin' || role === 'manager') return true;
    if (!userId) return false;
    return extractAssigneeIds(createdBy ?? undefined).includes(userId);
}

/** assignment/pm の工事種別から顧客向けの作業ラベルを解決（組立作業/解体作業/作業） */
async function resolveWorkLabel(assignment: AssignmentWithPm): Promise<string> {
    const ctId = assignment.constructionType || assignment.projectMaster.constructionType || null;
    if (!ctId) return '作業';
    const ct = await prisma.constructionType.findUnique({ where: { id: ctId } }).catch(() => null);
    return workLabelFromConstructionTypeName(ct?.name ?? ctId);
}

/** クエリ/ボディの kind を 'start'|'complete' に正規化（既定は complete） */
function parseKind(v: unknown): 'start' | 'complete' {
    return v === 'start' ? 'start' : 'complete';
}

/** 通知本文に使う現場名（work-status と同じ組み立て） */
async function buildSiteTitle(pm: AssignmentWithPm['projectMaster']): Promise<string> {
    const baseName = pm.name || pm.title || '案件';
    const honorific = pm.honorific || '';
    const siteName = `${baseName}${honorific}`;
    const suffix = pm.constructionSuffixId
        ? (await prisma.constructionSuffix.findUnique({ where: { id: pm.constructionSuffixId } }))?.name
        : undefined;
    return suffix ? `${siteName}（${suffix}）` : siteName;
}

async function getCompanyName(): Promise<string | null> {
    const info = await prisma.companyInfo.findUnique({ where: { id: 'default' }, select: { name: true } }).catch(() => null);
    return info?.name ?? null;
}

function getLinkedContacts(customerContactPersons: string | null): ContactPerson[] {
    const contacts = parseJsonField<ContactPerson[]>(customerContactPersons, []);
    return contacts.filter((c) => !!c.lineUserId);
}

/**
 * 顧客へ送れる写真候補（新しい順）。
 * 完了に添付された写真の category は工事種別と一致しないことがある（完了UIの選択次第）ため、
 * 節目カテゴリには限定せず、内部用カテゴリを除いた画像を候補にする。既定選択は「直近アップ分」。
 */
function getCandidatePhotos(projectMasterId: string) {
    return prisma.projectMasterFile.findMany({
        where: { projectMasterId, fileType: 'image', category: { in: PHOTO_CATEGORIES } },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { id: true, fileName: true, storagePath: true, thumbnailPath: true, createdAt: true },
    });
}

function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

// ============================ GET（コンテキスト） ============================
export async function GET(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const sp = new URL(req.url).searchParams;
        const assignmentId = sp.get('assignmentId') || '';
        if (!assignmentId) return validationErrorResponse('assignmentId は必須です');
        const kind = parseKind(sp.get('kind'));

        const assignment = await loadAssignment(assignmentId);
        if (!assignment) return notFoundResponse('配置');
        const pm = assignment.projectMaster;

        if (!canNotify(session!.user.role, session!.user.id, pm.createdBy)) {
            return errorResponse('この案件の顧客へ連絡する権限がありません', 403);
        }

        const workLabel = await resolveWorkLabel(assignment);

        const customer = pm.customerId
            ? await prisma.customer.findUnique({ where: { id: pm.customerId }, select: { id: true, name: true, contactPersons: true } })
            : null;

        const allContacts = parseJsonField<ContactPerson[]>(customer?.contactPersons ?? null, []);
        const contacts = allContacts.map((c) => ({ id: c.id, name: c.name, linked: !!c.lineUserId }));

        // 写真は完了連絡のみ（開始連絡はテキストのみ）
        const nowMs = Date.now();
        const photos = kind === 'complete'
            ? await Promise.all(
                (await getCandidatePhotos(pm.id)).map(async (f) => {
                    const p = f.thumbnailPath || f.storagePath;
                    const signed = await supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(p, 600);
                    return {
                        id: f.id,
                        fileName: f.fileName,
                        thumbnailUrl: signed.data?.signedUrl ?? null,
                        createdAt: f.createdAt.toISOString(),
                        isDefault: nowMs - f.createdAt.getTime() < RECENT_PHOTO_MS,
                    };
                })
            )
            : [];

        const [companyName, siteTitle] = await Promise.all([getCompanyName(), buildSiteTitle(pm)]);
        const defaultMessage = buildCustomerMessage({
            phase: kind,
            companyName,
            siteTitle,
            workLabel,
            withPhotos: photos.some((p) => p.isDefault),
        });

        const lastSent = await prisma.customerNotificationLog.findFirst({
            where: { assignmentId, milestone: kind, status: 'sent' },
            orderBy: { sentAt: 'desc' },
            select: { sentAt: true, imageCount: true },
        });

        return NextResponse.json(
            {
                kind,
                workLabel,
                phaseLabel: kind === 'start' ? '開始' : '完了',
                project: { id: pm.id, title: pm.name || pm.title || '案件' },
                customer: customer ? { id: customer.id, name: customer.name } : null,
                contacts,
                photos,
                defaultMessage,
                sent: lastSent ? { sentAt: lastSent.sentAt.toISOString(), imageCount: lastSent.imageCount } : null,
            },
            { headers: NO_STORE }
        );
    } catch (error) {
        return serverErrorResponse('顧客連絡コンテキストの取得', error);
    }
}

// ============================ POST（送信） ============================
export async function POST(req: NextRequest) {
    try {
        const { session, error } = await requireAuth();
        if (error) return error;

        const body = await req.json().catch(() => ({}));
        const assignmentId = typeof body?.assignmentId === 'string' ? body.assignmentId : '';
        if (!assignmentId) return validationErrorResponse('assignmentId は必須です');
        const messageOverride = typeof body?.messageOverride === 'string' ? body.messageOverride : undefined;
        const force = body?.force === true;
        const contactIdFilter: string[] | null = Array.isArray(body?.contactIds) ? body.contactIds.filter((x: unknown) => typeof x === 'string') : null;
        const imageIdFilter: string[] | null = Array.isArray(body?.imageFileIds) ? body.imageFileIds.filter((x: unknown) => typeof x === 'string') : null;
        const kind = parseKind(body?.kind);

        const assignment = await loadAssignment(assignmentId);
        if (!assignment) return notFoundResponse('配置');
        const pm = assignment.projectMaster;

        if (!canNotify(session!.user.role, session!.user.id, pm.createdBy)) {
            return errorResponse('この案件の顧客へ連絡する権限がありません', 403);
        }

        const workLabel = await resolveWorkLabel(assignment);

        const customer = pm.customerId
            ? await prisma.customer.findUnique({ where: { id: pm.customerId }, select: { id: true, name: true, contactPersons: true } })
            : null;

        // 送信先（LINE連携済みの担当者のみ）
        let recipients = getLinkedContacts(customer?.contactPersons ?? null);
        if (contactIdFilter) recipients = recipients.filter((c) => contactIdFilter.includes(c.id));
        if (recipients.length === 0) {
            return validationErrorResponse('送信先がありません（LINE連携済みの担当者を選択してください）');
        }

        // 文面
        const [companyName, siteTitle] = await Promise.all([getCompanyName(), buildSiteTitle(pm)]);

        // 写真は完了連絡のみ（開始連絡はテキストのみ）。既定=直近24h以内のアップ＝完了時に添付したもの。
        const nowMs = Date.now();
        const selectedFiles = kind === 'complete'
            ? (await getCandidatePhotos(pm.id)).filter((f) =>
                imageIdFilter ? imageIdFilter.includes(f.id) : nowMs - f.createdAt.getTime() < RECENT_PHOTO_MS)
            : [];

        const imageMessages = await buildImageMessages(selectedFiles);

        const text = (messageOverride && messageOverride.trim())
            || buildCustomerMessage({ phase: kind, companyName, siteTitle, workLabel, withPhotos: imageMessages.length > 0 });

        const messages: LineMessage[] = [{ type: 'text', text }, ...imageMessages];
        const groups = chunk(messages, LINE_MAX_MESSAGES_PER_PUSH);

        const results: Array<{ contactId: string; name: string; status: 'sent' | 'failed' | 'skipped'; error?: string }> = [];

        for (const contact of recipients) {
            // 二重送信防止（force=再送 のときは無視）
            if (!force) {
                const already = await prisma.customerNotificationLog.findFirst({
                    where: { assignmentId, milestone: kind, contactId: contact.id, status: 'sent' },
                    select: { id: true },
                });
                if (already) {
                    results.push({ contactId: contact.id, name: contact.name, status: 'skipped' });
                    continue;
                }
            }

            let ok = true;
            let errText = '';
            for (const g of groups) {
                const r = await pushLineMessage(contact.lineUserId!, g);
                if (!r.ok) {
                    ok = false;
                    errText = r.error || `status ${r.status}`;
                    break;
                }
            }

            await prisma.customerNotificationLog.create({
                data: {
                    assignmentId,
                    projectMasterId: pm.id,
                    customerId: customer?.id ?? null,
                    contactId: contact.id,
                    channel: 'line',
                    milestone: kind,
                    lineUserId: contact.lineUserId,
                    messageText: text,
                    imageCount: imageMessages.length,
                    status: ok ? 'sent' : 'failed',
                    errorText: ok ? null : errText.slice(0, 500),
                    sentBy: session!.user.id,
                },
            });

            results.push({ contactId: contact.id, name: contact.name, status: ok ? 'sent' : 'failed', error: ok ? undefined : errText });
        }

        const sentCount = results.filter((r) => r.status === 'sent').length;
        return NextResponse.json(
            { results, sentCount, imageCount: imageMessages.length },
            { headers: NO_STORE }
        );
    } catch (error) {
        return serverErrorResponse('顧客への連絡', error);
    }
}

/**
 * 選択画像（Storage上はWebP）をJPEGへ変換し、署名URLでLINEのimageメッセージを作る。
 * LINEはJPEG/PNGのみ・公開HTTPS必須。本体/プレビューとも1MB前後に収める。
 */
async function buildImageMessages(
    files: Array<{ id: string; storagePath: string }>
): Promise<Array<{ type: 'image'; originalContentUrl: string; previewImageUrl: string }>> {
    const out: Array<{ type: 'image'; originalContentUrl: string; previewImageUrl: string }> = [];
    for (const f of files) {
        try {
            const { data, error } = await supabaseAdmin.storage.from(STORAGE_BUCKET).download(f.storagePath);
            if (error || !data) {
                logger.error('[customer-notify] image download failed', { id: f.id, error });
                continue;
            }
            const buf = Buffer.from(await data.arrayBuffer());
            const [jpeg, preview] = await Promise.all([
                sharp(buf).jpeg({ quality: 80 }).toBuffer(),
                sharp(buf).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer(),
            ]);

            const jpegPath = `line-jpeg/${f.id}.jpg`;
            const prevPath = `line-jpeg/${f.id}_prev.jpg`;
            await Promise.all([
                supabaseAdmin.storage.from(STORAGE_BUCKET).upload(jpegPath, jpeg, { contentType: 'image/jpeg', upsert: true }),
                supabaseAdmin.storage.from(STORAGE_BUCKET).upload(prevPath, preview, { contentType: 'image/jpeg', upsert: true }),
            ]);

            const [orig, pre] = await Promise.all([
                supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(jpegPath, SIGNED_TTL),
                supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUrl(prevPath, SIGNED_TTL),
            ]);
            if (orig.data?.signedUrl && pre.data?.signedUrl) {
                out.push({ type: 'image', originalContentUrl: orig.data.signedUrl, previewImageUrl: pre.data.signedUrl });
            }
        } catch (e) {
            logger.error('[customer-notify] image convert failed', { id: f.id, e });
        }
    }
    return out;
}
