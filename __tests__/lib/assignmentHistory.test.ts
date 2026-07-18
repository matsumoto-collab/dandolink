import {
    buildAssignmentHistoryEntries,
    collectHistoryResolutionIds,
    HISTORY_EMPTY_LABEL,
    type HistoryNameMaps,
} from '@/lib/assignmentHistory';

const baseCurrent = {
    // JST 8/5 0時 = UTC 8/4 15:00
    date: new Date('2026-08-04T15:00:00.000Z'),
    assignedEmployeeId: 'f1',
    dateStatus: 'confirmed',
    confirmDueDate: null as Date | null,
    memberCount: 2,
    vehicles: JSON.stringify(['3t幅狭']),
    meetingTime: null as string | null,
    remarks: null as string | null,
    dispatchRemark: null as string | null,
    estimatedHours: 8,
    constructionType: 'ct-1' as string | null,
    isDispatchConfirmed: false,
    confirmedWorkerIds: null as string | null,
    confirmedVehicleIds: null as string | null,
};

const emptyMaps: HistoryNameMaps = {
    users: new Map(),
    vehicles: new Map(),
    constructionTypes: new Map(),
};

describe('buildAssignmentHistoryEntries', () => {
    it('変更がなければ空配列（同値の送信は記録しない）', () => {
        const entries = buildAssignmentHistoryEntries({
            current: baseCurrent,
            body: { memberCount: 2, dateStatus: 'confirmed', vehicles: ['3t幅狭'] },
            nameMaps: emptyMaps,
        });
        expect(entries).toEqual([]);
    });

    it('date は ISO・foreman は ID で保存（既存の履歴パネル互換）', () => {
        const entries = buildAssignmentHistoryEntries({
            current: baseCurrent,
            body: {
                date: '2026-08-05T15:00:00.000Z',
                assignedEmployeeId: 'f2',
            },
            nameMaps: emptyMaps,
        });
        expect(entries).toContainEqual({
            changeType: 'date',
            previousValue: '2026-08-04T15:00:00.000Z',
            newValue: '2026-08-05T15:00:00.000Z',
        });
        expect(entries).toContainEqual({
            changeType: 'foreman',
            previousValue: 'f1',
            newValue: 'f2',
        });
    });

    it('人数・車両・集合時間は読みやすい文字列で記録する', () => {
        const entries = buildAssignmentHistoryEntries({
            current: baseCurrent,
            body: {
                memberCount: 3,
                vehicles: ['2t', '軽トラ'],
                meetingTime: '08:00',
            },
            nameMaps: emptyMaps,
        });
        expect(entries).toContainEqual({ changeType: 'memberCount', previousValue: '2人', newValue: '3人' });
        expect(entries).toContainEqual({ changeType: 'vehicles', previousValue: '3t幅狭', newValue: '2t, 軽トラ' });
        expect(entries).toContainEqual({ changeType: 'meetingTime', previousValue: HISTORY_EMPTY_LABEL, newValue: '08:00' });
    });

    it('confirmDueDate は JST の YYYY-MM-DD で記録する', () => {
        const entries = buildAssignmentHistoryEntries({
            current: baseCurrent,
            // JST 8/1 0時 = UTC 7/31 15:00
            body: { confirmDueDate: '2026-07-31T15:00:00.000Z' },
            nameMaps: emptyMaps,
        });
        expect(entries).toEqual([
            { changeType: 'confirmDueDate', previousValue: HISTORY_EMPTY_LABEL, newValue: '2026-08-01' },
        ]);
    });

    it('工事種別はマスタ名に解決して記録する', () => {
        const entries = buildAssignmentHistoryEntries({
            current: baseCurrent,
            body: { constructionType: 'ct-2' },
            nameMaps: {
                ...emptyMaps,
                constructionTypes: new Map([
                    ['ct-1', '組立'],
                    ['ct-2', '解体'],
                ]),
            },
        });
        expect(entries).toEqual([
            { changeType: 'constructionType', previousValue: '組立', newValue: '解体' },
        ]);
    });

    it('手配確定はフラグ・メンバー・車両を1エントリに統合し名前解決する', () => {
        const entries = buildAssignmentHistoryEntries({
            current: baseCurrent,
            body: {
                isDispatchConfirmed: true,
                confirmedWorkerIds: ['u1', 'u2'],
                confirmedVehicleIds: ['v1'],
            },
            nameMaps: {
                users: new Map([
                    ['u1', '東本'],
                    ['u2', 'ケキ'],
                ]),
                vehicles: new Map([['v1', '3t幅狭']]),
                constructionTypes: new Map(),
            },
        });
        expect(entries).toEqual([
            { changeType: 'dispatch', previousValue: '未確定', newValue: '確定（東本, ケキ｜3t幅狭）' },
        ]);
    });

    it('手配確定の解除は「確定（…）→ 未確定」になる', () => {
        const entries = buildAssignmentHistoryEntries({
            current: {
                ...baseCurrent,
                isDispatchConfirmed: true,
                confirmedWorkerIds: JSON.stringify(['u1']),
                confirmedVehicleIds: JSON.stringify([]),
            },
            body: { isDispatchConfirmed: false, confirmedWorkerIds: [], confirmedVehicleIds: [] },
            nameMaps: { ...emptyMaps, users: new Map([['u1', '東本']]) },
        });
        expect(entries).toEqual([
            { changeType: 'dispatch', previousValue: `確定（東本｜${HISTORY_EMPTY_LABEL}）`, newValue: '未確定' },
        ]);
    });
});

describe('collectHistoryResolutionIds', () => {
    it('手配確定・工事種別の変更時のみ解決対象IDを収集する', () => {
        const ids = collectHistoryResolutionIds({
            current: {
                ...baseCurrent,
                confirmedWorkerIds: JSON.stringify(['u1']),
                confirmedVehicleIds: JSON.stringify(['v0']),
            },
            body: {
                confirmedWorkerIds: ['u2'],
                confirmedVehicleIds: ['v1'],
                constructionType: 'ct-2',
            },
        });
        expect(ids.userIds.sort()).toEqual(['u1', 'u2']);
        expect(ids.vehicleIds.sort()).toEqual(['v0', 'v1']);
        expect(ids.constructionTypeIds.sort()).toEqual(['ct-1', 'ct-2']);
    });

    it('無関係の変更では何も収集しない', () => {
        const ids = collectHistoryResolutionIds({ current: baseCurrent, body: { memberCount: 5 } });
        expect(ids).toEqual({ userIds: [], vehicleIds: [], constructionTypeIds: [] });
    });
});
