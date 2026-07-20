/**
 * @jest-environment node
 *
 * lib/anthropic がサーバー専用ガード（window があると throw）を持つため node 環境で走らせる。
 */
import { resolveListableTeamNames, annotateTeams } from '@/lib/availabilityAssistant';
import type { CrewAvailabilityRow } from '@/lib/crewAvailability';

/**
 * 「どの班を列挙してよいか」の判定（コード側で完結させる部分）のテスト。
 *
 * 2026-07-20 の事故（プロンプトに班名を列挙していたため、AIが同名の案件担当者
 * 「今井さん」まで対象と誤解し浮いている現場を握り潰した）を受け、判定をコードへ移した。
 * ここが壊れると、除外班が列挙に出る／明示的に聞いても答えないという劣化が起きる。
 */

function row(team: string): CrewAvailabilityRow {
    return { team, status: 'ok', jobs: [], usedHours: 0, freeHours: 8, usedMembers: 0, negotiableMembers: 0 };
}

describe('resolveListableTeamNames', () => {
    it('班名に言及がなければ何も列挙対象に戻さない', () => {
        expect(resolveListableTeamNames('明日空いている班はある？').size).toBe(0);
    });

    it('班名を挙げて聞かれたその班だけを列挙対象に戻す', () => {
        const listable = resolveListableTeamNames('修栄工業の予定を教えて');
        expect(listable.has('修栄工業')).toBe(true);
        expect(listable.has('阿部工業')).toBe(false);
    });

    it('複数の班名を挙げられたら全て列挙対象に戻す', () => {
        const listable = resolveListableTeamNames('修栄工業と阿部工業はどう？');
        expect(listable.has('修栄工業')).toBe(true);
        expect(listable.has('阿部工業')).toBe(true);
    });

    it('「全部の班」指定なら全て列挙対象に戻す', () => {
        expect(resolveListableTeamNames('全部の班の予定を教えて').size).toBe(8);
        expect(resolveListableTeamNames('全班の状況は？').size).toBe(8);
        expect(resolveListableTeamNames('すべての班を出して').size).toBe(8);
    });
});

describe('annotateTeams', () => {
    it('除外対象の班は listableInEnumeration=false、それ以外は true', () => {
        const teams = [row('東本'), row('龍成工業'), row('山建'), row('修栄工業'), row('今井')];
        const annotated = annotateTeams(teams, new Set());
        const byTeam = new Map(annotated.map((t) => [t.team, t.listableInEnumeration]));

        // 協力業者でも龍成工業・山建は通常どおり回答対象（kei指定）
        expect(byTeam.get('東本')).toBe(true);
        expect(byTeam.get('龍成工業')).toBe(true);
        expect(byTeam.get('山建')).toBe(true);
        expect(byTeam.get('修栄工業')).toBe(false);
        expect(byTeam.get('今井')).toBe(false);
    });

    it('明示的に聞かれた班は listableInEnumeration=true に戻る', () => {
        const annotated = annotateTeams([row('修栄工業'), row('阿部工業')], new Set(['修栄工業']));
        expect(annotated.find((t) => t.team === '修栄工業')?.listableInEnumeration).toBe(true);
        expect(annotated.find((t) => t.team === '阿部工業')?.listableInEnumeration).toBe(false);
    });

    it('元の行の内容（人数・空き時間）は変更しない', () => {
        const original: CrewAvailabilityRow = {
            team: '修栄工業', status: 'ok', jobs: [], usedHours: 5, freeHours: 3, usedMembers: 2, negotiableMembers: 1,
        };
        const [annotated] = annotateTeams([original], new Set());
        expect(annotated).toMatchObject({ usedHours: 5, freeHours: 3, usedMembers: 2, negotiableMembers: 1 });
    });
});
