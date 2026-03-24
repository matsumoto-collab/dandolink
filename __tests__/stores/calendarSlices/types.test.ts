import {
    ConflictUpdateError,
    parseProjectMasterDates,
    parseDailyReportDates,
    assignmentToProject
} from '@/stores/calendarSlices/types';
import { CONSTRUCTION_TYPE_COLORS } from '@/types/calendar';

describe('calendarSlices types and helpers', () => {
    describe('ConflictUpdateError', () => {
        it('正しくエラーインスタンスが生成される', () => {
            const mockData = { id: 'test' } as any;
            const error = new ConflictUpdateError('Conflict happened', mockData);
            
            expect(error.name).toBe('ConflictUpdateError');
            expect(error.message).toBe('Conflict happened');
            expect(error.code).toBe('CONFLICT');
            expect(error.latestData).toBe(mockData);
        });
    });

    describe('Date Parsers', () => {
        it('parseProjectMasterDates: 文字列の日付をDateオブジェクトに変換する', () => {
            const input = {
                id: '1',
                createdAt: '2026-03-12T00:00:00.000Z',
                updatedAt: '2026-03-13T00:00:00.000Z',
            } as any;
            
            const result = parseProjectMasterDates(input);
            expect(result.createdAt).toBeInstanceOf(Date);
            expect(result.updatedAt).toBeInstanceOf(Date);
        });

        it('parseDailyReportDates: 文字列の日付をDateオブジェクトに変換する', () => {
             const input = {
                id: '1',
                date: '2026-03-12T00:00:00.000Z',
                createdAt: '2026-03-12T00:00:00.000Z',
                updatedAt: '2026-03-13T00:00:00.000Z',
            } as any;
            
            const result = parseDailyReportDates(input);
            expect(result.date).toBeInstanceOf(Date);
            expect(result.createdAt).toBeInstanceOf(Date);
            expect(result.updatedAt).toBeInstanceOf(Date);
        });
    });

    describe('assignmentToProject', () => {
        it('nameが存在する場合、name+honorificをtitleに設定する', () => {
            const assignment = {
                id: 'a1',
                date: new Date('2026-03-12'),
                constructionType: 'assembly',
                projectMaster: {
                    title: '旧タイトル',
                    name: '田中',
                    honorific: '様',
                    constructionType: 'demolition', // assignment側が優先されるはず
                }
            } as any;

            const project = assignmentToProject(assignment);
            
            expect(project.id).toBe('a1');
            expect(project.title).toBe('田中様');
            expect(project.name).toBe('田中');
            expect(project.honorific).toBe('様');
            expect(project.constructionType).toBe('assembly');
            expect(project.color).toBe(CONSTRUCTION_TYPE_COLORS.assembly);
        });

        it('nameが存在しない場合、titleをフォールバックとして使用する', () => {
            const assignment = {
                id: 'a2',
                date: new Date('2026-03-12'),
                projectMaster: {
                    title: '山田邸解体',
                    constructionType: 'demolition',
                }
            } as any;

            const project = assignmentToProject(assignment);
            
            expect(project.title).toBe('山田邸解体');
            expect(project.name).toBe('山田邸解体');
            expect(project.honorific).toBe('');
            expect(project.constructionType).toBe('demolition');
            expect(project.color).toBe(CONSTRUCTION_TYPE_COLORS.demolition);
        });

        it('projectMasterも存在しない最もミニマルなケース', () => {
            const assignment = {
                id: 'a3',
                date: new Date('2026-03-12'),
            } as any;

            const project = assignmentToProject(assignment);
            
            expect(project.title).toBe('不明な案件');
            expect(project.name).toBe('');
            expect(project.constructionType).toBe('other');
            expect(project.color).toBe(CONSTRUCTION_TYPE_COLORS.other);
        });
    });
});
