import { prisma } from '@/lib/prisma';
import { jstDayStartUtc } from '@/lib/dateUtils';
import { jstDateKey, siteName, resolveOwnerNames, ownersOf, type PmLite } from '@/lib/crewAvailability';
import { logger } from '@/lib/logger';

/**
 * 「◯◯（地名）の近くに行く仕事はある？」に答えるための近隣検索（AIなしの純粋なDB計算）。
 *
 * 現調（現場調査）で遠方をまとめて回るために、指定地名の周辺で予定が入っている現場を
 * 距離つきで返す。AI照会（lib/availabilityAssistant.ts）のツール find_nearby_jobs から呼ぶ。
 * 「数字はDB・言葉はAI」の分担どおり、距離・件数はここで計算しAIは文章化だけを行う。
 *
 * 【距離の元データ】
 * ProjectMaster.latitude/longitude（案件登録時に地図でピンを刺した座標）。
 * 2026-07-22 時点の実データでは、今後90日に予定がある案件166件のうち座標があるのは
 * 117件（約70%）。座標が無い案件は距離を判定できないため、黙って落とさず
 * unknownLocation として件数と現場名を返す（「近くに無い」と誤解させないため）。
 *
 * 【地名 → 座標の解決】
 * 1. 過去の案件の住所に含まれる地名として引く（social geocoding）。社内で使う地名
 *    （「北条」「重信」等の旧町名・通称）は必ず過去の現場住所に出てくるため、
 *    外部の地図サービスより確実に当たる。複数件当たったら座標の中央値を基準点にする。
 * 2. 当たらなければ OpenStreetMap(Nominatim) で引く（キー不要・サーバー側 fetch なので
 *    CSP は無関係）。会社の案件で最も多い都道府県を補って国内に限定して検索する。
 * 3. どちらも駄目なら resolved=null を返す（AIは「その地名が分かりません」と答える）。
 */

/** 「近く」の既定半径。kei選択（2026-07-22）＝車で20分程度＝現調でついでに寄れる範囲 */
export const DEFAULT_RADIUS_KM = 10;
/** 質問で半径を指定されたときの上限（これ以上は「近く」ではなく全件列挙になるため） */
const MAX_RADIUS_KM = 50;
/** 既定の照会期間（今日から7日間＝「今週」） */
const DEFAULT_RANGE_DAYS = 7;
/** 1回で見る最長期間 */
const MAX_RANGE_DAYS = 31;
/** 半径内に1件も無かったときに「一番近いのは」として返す現場数 */
const NEAREST_FALLBACK_COUNT = 3;
/** 返す最大現場数（多すぎると音声で聞けない。松山市内は半径10kmに40現場以上入る） */
const MAX_JOBS = 12;
/** unknownLocation で現場名を挙げる最大件数 */
const MAX_UNKNOWN_SITES = 5;
/** 地名として短すぎるものは誤ヒットするので弾く（正規化後の文字数） */
const MIN_PLACE_LENGTH = 2;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EARTH_RADIUS_KM = 6371;

/** 現場の1日ぶんの予定 */
export interface NearbyJobDay {
    /** YYYY-MM-DD（JST） */
    date: string;
    /** 班名。浮き（班未定）は null */
    team: string | null;
    memberCount: number;
    dateStatus: 'confirmed' | 'tentative';
}

/**
 * 近くの現場1件。同じ現場に複数日の予定があってもまとめて1件で返す
 * （日ごとに1行返すと同じ現場が並んで他の現場が押し出されるため）。
 */
export interface NearbyJob {
    /** 現場名（案件名＋敬称） */
    site: string;
    /** 基準点からの直線距離（km・小数1桁） */
    distanceKm: number;
    /** 住所（県＋市区町村＋番地。表示用。座標だけ登録された案件では空になりうる） */
    address: string;
    /** この現場の予定（日付順） */
    schedule: NearbyJobDay[];
    /** 案件担当者（[0]=主担当） */
    owners: string[];
    /** 半径の外だが「一番近い現場」として参考に返したもの */
    outsideRadius?: boolean;
}

export interface ResolvedPlace {
    /** 'projects'=過去案件の住所から特定 / 'geocoding'=地図サービスから特定 */
    source: 'projects' | 'geocoding';
    /** 基準点の説明（AIがそのまま言えるようにした文字列） */
    label: string;
    latitude: number;
    longitude: number;
    /** source='projects' のとき、根拠になった過去案件の件数 */
    matchedProjects?: number;
}

export interface NearbyJobsResult {
    /** 質問された地名（そのまま返す） */
    place: string;
    /** 基準点。特定できなければ null（AIは「地名が分かりません」と答える） */
    resolved: ResolvedPlace | null;
    radiusKm: number;
    startDate: string;
    endDate: string;
    /** 近い順の現場。半径内が0件のときだけ outsideRadius=true の最寄りが入る */
    jobs: NearbyJob[];
    /** 距離を判定できた（座標がある）現場の数 */
    checkedCount: number;
    /** 住所（座標）未登録で距離を判定できなかった現場。隠さずAIに伝えて回答に添えさせる */
    unknownLocation: {
        count: number;
        sites: string[];
    };
    /** jobs を MAX_JOBS で切ったときの、半径内の実際の現場数 */
    totalInRadius: number;
}

export interface GeoPoint {
    latitude: number;
    longitude: number;
}

/** 2点間の直線距離（km）。Haversine。 */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b.latitude - a.latitude);
    const dLng = toRad(b.longitude - a.longitude);
    const lat1 = toRad(a.latitude);
    const lat2 = toRad(b.latitude);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 住所・地名の突き合わせ用の正規化。
 * DBの住所は全角数字・全角スペース混じり（「松山市西石井３丁目４」）なので NFKC で
 * 半角へ寄せ、空白と「大字/字」等のゆらぎを落として含有判定する。
 */
export function normalizePlace(s: string): string {
    return s
        .normalize('NFKC')
        .replace(/\s+/g, '')
        .replace(/[ヶケ]/g, 'ケ')
        .replace(/大字|字(?=[^\s])/g, '');
}

/**
 * 座標群の代表点（緯度・経度それぞれの中央値）。
 * 平均だと1件だけ遠方（同名地名の別市など）が混ざったときに基準点が引きずられるため中央値。
 */
export function medianPoint(points: GeoPoint[]): GeoPoint | null {
    if (points.length === 0) return null;
    const mid = (values: number[]): number => {
        const sorted = [...values].sort((a, b) => a - b);
        const i = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 1 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
    };
    return {
        latitude: mid(points.map((p) => p.latitude)),
        longitude: mid(points.map((p) => p.longitude)),
    };
}

interface AddressRow {
    prefecture: string | null;
    city: string | null;
    location: string | null;
    latitude: number | null;
    longitude: number | null;
}

/** 表示用の住所文字列（県＋市区町村＋番地） */
export function formatAddress(row: { prefecture: string | null; city: string | null; location: string | null }): string {
    return [row.prefecture, row.city, row.location].filter((v) => v && v.trim()).join('');
}

/**
 * 過去の案件住所から地名の基準点を求める（純粋関数）。
 * 「北条」のような部分一致で当たった案件の座標の中央値を返す。
 */
export function resolvePlaceFromAddresses(place: string, rows: AddressRow[]): ResolvedPlace | null {
    const needle = normalizePlace(place);
    if (needle.length < MIN_PLACE_LENGTH) return null;

    const matched = rows.filter((r) => {
        if (r.latitude === null || r.longitude === null) return false;
        return normalizePlace(formatAddress(r)).includes(needle);
    });
    if (matched.length === 0) return null;

    const center = medianPoint(
        matched.map((r) => ({ latitude: r.latitude!, longitude: r.longitude! }))
    )!;

    // 基準点に最も近い案件の住所を「◯◯付近」の代表表記に使う（中央値そのものは住所を持たないため）
    const nearest = matched.reduce((best, r) => {
        const d = haversineKm(center, { latitude: r.latitude!, longitude: r.longitude! });
        return d < best.d ? { d, row: r } : best;
    }, { d: Number.POSITIVE_INFINITY, row: matched[0] });

    return {
        source: 'projects',
        label: `${[nearest.row.prefecture, nearest.row.city].filter(Boolean).join('')} 付近`,
        latitude: center.latitude,
        longitude: center.longitude,
        matchedProjects: matched.length,
    };
}

/**
 * Nominatim の display_name（「喜与町, 松山市, 愛媛県, 790-0000, 日本」のように細→粗）を
 * 「愛媛県松山市喜与町 付近」の形に直す。道路名などが先頭に来ることがあるため粗い側から3つだけ使う。
 */
export function formatGeocodedLabel(displayName: string | undefined, fallback: string): string {
    if (!displayName) return `${fallback} 付近`;
    const parts = String(displayName)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s && s !== '日本' && !/^\d{3}-?\d{4}$/.test(s));
    if (parts.length === 0) return `${fallback} 付近`;
    return `${parts.slice(-3).reverse().join('')} 付近`;
}

/**
 * OpenStreetMap(Nominatim) で地名を引く。過去案件に無い地名（初めて行くエリア）の受け皿。
 * 失敗・タイムアウトは null を返して静かに諦める（AI は「分かりません」と答える）。
 */
async function geocodeWithNominatim(place: string, prefectureHint: string | null): Promise<ResolvedPlace | null> {
    const query = prefectureHint && !place.includes(prefectureHint) ? `${prefectureHint}${place}` : place;
    const url =
        'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=jp&accept-language=ja&q=' +
        encodeURIComponent(query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
        const res = await fetch(url, {
            // Nominatim の利用規約で User-Agent（連絡先を含む識別子）が必須
            headers: { 'User-Agent': 'DandoLink/1.0 (schedule assistant; contact via app admin)' },
            signal: controller.signal,
        });
        if (!res.ok) return null;
        const json = (await res.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>;
        const top = json?.[0];
        if (!top?.lat || !top?.lon) return null;
        const latitude = Number(top.lat);
        const longitude = Number(top.lon);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
        return {
            source: 'geocoding',
            label: formatGeocodedLabel(top.display_name, query),
            latitude,
            longitude,
        };
    } catch (e) {
        logger.error('[nearbyJobs] 地名の解決に失敗（Nominatim）', e);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/** 案件で最も多い都道府県（Nominatim 検索の地域ヒント） */
function dominantPrefecture(rows: AddressRow[]): string | null {
    const count = new Map<string, number>();
    for (const r of rows) {
        const p = r.prefecture?.trim();
        if (p) count.set(p, (count.get(p) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestN = 0;
    count.forEach((n, p) => {
        if (n > bestN) { bestN = n; best = p; }
    });
    return best;
}

export interface FindNearbyJobsParams {
    /** 地名（「北条」「新居浜」など質問文から抜き出したもの） */
    place: string;
    /** 開始日 YYYY-MM-DD（省略時=今日） */
    startDate?: string;
    /** 終了日 YYYY-MM-DD（省略時=開始日から7日間） */
    endDate?: string;
    /** 半径km（省略時=10・最大50） */
    radiusKm?: number;
}

/**
 * 指定地名の周辺で予定が入っている現場を、近い順に返す。
 * 半径内が0件のときは「一番近い現場」を3件だけ outsideRadius=true で返す
 * （「近くに無い」で終わらせず、どれくらい離れているかを言えるようにするため）。
 */
export async function findNearbyJobs(params: FindNearbyJobsParams): Promise<NearbyJobsResult> {
    const place = (params.place ?? '').trim();
    const radiusKm = Math.min(
        MAX_RADIUS_KM,
        Math.max(1, params.radiusKm && Number.isFinite(params.radiusKm) ? params.radiusKm : DEFAULT_RADIUS_KM)
    );

    const start = jstDayStartUtc(params.startDate ?? new Date());
    const requestedEnd = params.endDate
        ? new Date(jstDayStartUtc(params.endDate).getTime() + MS_PER_DAY)
        : new Date(start.getTime() + DEFAULT_RANGE_DAYS * MS_PER_DAY);
    const maxEnd = new Date(start.getTime() + MAX_RANGE_DAYS * MS_PER_DAY);
    const end = requestedEnd.getTime() > maxEnd.getTime() ? maxEnd : requestedEnd;

    const startKey = jstDateKey(start);
    const endKey = jstDateKey(new Date(end.getTime() - MS_PER_DAY));

    const empty = (resolved: ResolvedPlace | null): NearbyJobsResult => ({
        place, resolved, radiusKm, startDate: startKey, endDate: endKey,
        jobs: [], checkedCount: 0, unknownLocation: { count: 0, sites: [] }, totalInRadius: 0,
    });

    if (normalizePlace(place).length < MIN_PLACE_LENGTH) return empty(null);

    // 地名の基準点: まず過去案件の住所から。無ければ地図サービス。
    const addressRows = await prisma.projectMaster.findMany({
        select: { prefecture: true, city: true, location: true, latitude: true, longitude: true },
    });
    let resolved = resolvePlaceFromAddresses(place, addressRows);
    if (!resolved) {
        resolved = await geocodeWithNominatim(place, dominantPrefecture(addressRows));
    }
    if (!resolved) return empty(null);

    const assignments = await prisma.projectAssignment.findMany({
        where: { date: { gte: start, lt: end } },
        orderBy: { date: 'asc' },
        select: {
            date: true,
            projectMasterId: true,
            assignedEmployeeId: true,
            memberCount: true,
            dateStatus: true,
            projectMaster: {
                select: {
                    name: true, title: true, honorific: true, createdBy: true,
                    prefecture: true, city: true, location: true, latitude: true, longitude: true,
                },
            },
        },
    });

    // 班名（浮き='unassigned' は班なし）
    const teamIds = Array.from(
        new Set(assignments.map((a) => a.assignedEmployeeId).filter((id) => id && id !== 'unassigned'))
    );
    const [teamUsers, ownerNames] = await Promise.all([
        teamIds.length > 0
            ? prisma.user.findMany({ where: { id: { in: teamIds } }, select: { id: true, displayName: true } })
            : Promise.resolve([]),
        resolveOwnerNames(assignments.map((a) => a.projectMaster?.createdBy ?? null)),
    ]);
    const teamById = new Map(teamUsers.map((u) => [u.id, u.displayName]));

    // 同じ現場に複数日の予定があっても1件にまとめる（日ごとに並べると他の現場が押し出されるため）
    const bySite = new Map<string, NearbyJob>();
    const unknownSites: string[] = [];
    for (const a of assignments) {
        const pm = a.projectMaster;
        const site = siteName(pm as PmLite);
        if (!pm || pm.latitude === null || pm.longitude === null) {
            // 住所（座標）未登録＝距離が出せない。件数と現場名を返して回答に添えさせる
            if (!unknownSites.includes(site)) unknownSites.push(site);
            continue;
        }
        const day: NearbyJobDay = {
            date: jstDateKey(a.date),
            team: a.assignedEmployeeId === 'unassigned' ? null : teamById.get(a.assignedEmployeeId) ?? null,
            memberCount: a.memberCount ?? 0,
            dateStatus: a.dateStatus === 'tentative' ? 'tentative' : 'confirmed',
        };
        const existing = bySite.get(a.projectMasterId);
        if (existing) {
            existing.schedule.push(day);
            continue;
        }
        bySite.set(a.projectMasterId, {
            site,
            distanceKm: Math.round(haversineKm(resolved, { latitude: pm.latitude, longitude: pm.longitude }) * 10) / 10,
            address: formatAddress(pm),
            schedule: [day],
            owners: ownersOf(pm as PmLite, ownerNames),
        });
    }

    const withDistance = Array.from(bySite.values());
    for (const job of withDistance) {
        job.schedule.sort((a, b) => a.date.localeCompare(b.date) || (a.team ?? '').localeCompare(b.team ?? ''));
    }
    withDistance.sort((a, b) => a.distanceKm - b.distanceKm || a.schedule[0].date.localeCompare(b.schedule[0].date));
    const inRadius = withDistance.filter((j) => j.distanceKm <= radiusKm);

    const jobs = inRadius.length > 0
        ? inRadius.slice(0, MAX_JOBS)
        : withDistance.slice(0, NEAREST_FALLBACK_COUNT).map((j) => ({ ...j, outsideRadius: true }));

    return {
        place,
        resolved,
        radiusKm,
        startDate: startKey,
        endDate: endKey,
        jobs,
        checkedCount: withDistance.length,
        unknownLocation: { count: unknownSites.length, sites: unknownSites.slice(0, MAX_UNKNOWN_SITES) },
        totalInRadius: inRadius.length,
    };
}
