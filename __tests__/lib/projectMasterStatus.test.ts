/**
 * @jest-environment node
 */
import {
    resolveProjectListStatus,
    matchesProjectListStatus,
    PROJECT_LIST_STATUS_OPTIONS,
    DEFAULT_PROJECT_LIST_STATUS_FILTER,
} from '@/lib/projectMasterStatus';

describe('resolveProjectListStatus', () => {
    it('配置がある active は 進行中', () => {
        expect(resolveProjectListStatus({ status: 'active', assignmentCount: 3 })).toBe('active');
    });

    it('配置が無い active は 未着工', () => {
        expect(resolveProjectListStatus({ status: 'active', assignmentCount: 0 })).toBe('unstarted');
    });

    it('assignmentCount 未設定（undefined/null）は 未着工 扱い', () => {
        expect(resolveProjectListStatus({ status: 'active' })).toBe('unstarted');
        expect(resolveProjectListStatus({ status: 'active', assignmentCount: null })).toBe('unstarted');
    });

    it('完了は配置の有無によらず 完了（配置ゼロでも未着工にしない）', () => {
        expect(resolveProjectListStatus({ status: 'completed', assignmentCount: 5 })).toBe('completed');
        expect(resolveProjectListStatus({ status: 'completed', assignmentCount: 0 })).toBe('completed');
    });

    it('キャンセルはそのまま cancelled', () => {
        expect(resolveProjectListStatus({ status: 'cancelled', assignmentCount: 0 })).toBe('cancelled');
    });

    it('status 未設定は active とみなして配置件数で分ける', () => {
        expect(resolveProjectListStatus({ assignmentCount: 1 })).toBe('active');
        expect(resolveProjectListStatus({})).toBe('unstarted');
    });
});

describe('matchesProjectListStatus', () => {
    const running = { status: 'active', assignmentCount: 2 };
    const unstarted = { status: 'active', assignmentCount: 0 };
    const done = { status: 'completed', assignmentCount: 2 };

    it("'all' は全て通す", () => {
        for (const pm of [running, unstarted, done]) {
            expect(matchesProjectListStatus(pm, 'all')).toBe(true);
        }
    });

    it('進行中フィルタは未着工を除外する', () => {
        expect(matchesProjectListStatus(running, 'active')).toBe(true);
        expect(matchesProjectListStatus(unstarted, 'active')).toBe(false);
        expect(matchesProjectListStatus(done, 'active')).toBe(false);
    });

    it('未着工フィルタは配置ゼロの active だけ通す', () => {
        expect(matchesProjectListStatus(unstarted, 'unstarted')).toBe(true);
        expect(matchesProjectListStatus(running, 'unstarted')).toBe(false);
        expect(matchesProjectListStatus(done, 'unstarted')).toBe(false);
    });

    it('完了フィルタは完了だけ通す', () => {
        expect(matchesProjectListStatus(done, 'completed')).toBe(true);
        expect(matchesProjectListStatus(running, 'completed')).toBe(false);
        expect(matchesProjectListStatus(unstarted, 'completed')).toBe(false);
    });

    it("'open'（進行中/未着工）は進行中と未着工の両方を通し、完了は除外する", () => {
        expect(matchesProjectListStatus(running, 'open')).toBe(true);
        expect(matchesProjectListStatus(unstarted, 'open')).toBe(true);
        expect(matchesProjectListStatus(done, 'open')).toBe(false);
        expect(matchesProjectListStatus({ status: 'cancelled', assignmentCount: 0 }, 'open')).toBe(false);
    });
});

describe('絞り込みセレクトの選択肢', () => {
    it('5択が指定の並びで揃っている', () => {
        expect(PROJECT_LIST_STATUS_OPTIONS.map((o) => o.value)).toEqual([
            'open', 'active', 'unstarted', 'completed', 'all',
        ]);
        expect(PROJECT_LIST_STATUS_OPTIONS.map((o) => o.label)).toEqual([
            '進行中/未着工', '進行中', '未着工', '完了', '全てのステータス',
        ]);
    });

    it('既定値は「進行中/未着工」で、選択肢に含まれている', () => {
        expect(DEFAULT_PROJECT_LIST_STATUS_FILTER).toBe('open');
        expect(PROJECT_LIST_STATUS_OPTIONS.some((o) => o.value === DEFAULT_PROJECT_LIST_STATUS_FILTER)).toBe(true);
    });
});
