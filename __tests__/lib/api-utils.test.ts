import {
    parseJsonField,
    stringifyJsonField,
    parseJsonFields,
} from '@/lib/json-utils';

describe('API utils - JSON helpers', () => {
    describe('parseJsonField', () => {
        it('parses valid JSON string', () => {
            expect(parseJsonField('["a","b"]', [])).toEqual(['a', 'b']);
            expect(parseJsonField('{"key":"value"}', {})).toEqual({ key: 'value' });
            expect(parseJsonField('123', 0)).toBe(123);
        });

        it('returns default for null/undefined', () => {
            expect(parseJsonField(null, ['default'])).toEqual(['default']);
            expect(parseJsonField(undefined, 'default')).toBe('default');
        });

        it('returns default for empty string', () => {
            expect(parseJsonField('', [])).toEqual([]);
        });

        it('returns default for invalid JSON', () => {
            expect(parseJsonField('not json', [])).toEqual([]);
            expect(parseJsonField('{invalid}', { fallback: true })).toEqual({ fallback: true });
        });
    });

    describe('stringifyJsonField', () => {
        it('stringifies values', () => {
            expect(stringifyJsonField(['a', 'b'])).toBe('["a","b"]');
            expect(stringifyJsonField({ key: 'value' })).toBe('{"key":"value"}');
        });

        it('returns null for null/undefined', () => {
            expect(stringifyJsonField(null)).toBeNull();
            expect(stringifyJsonField(undefined)).toBeNull();
        });
    });

    describe('parseJsonFields', () => {
        it('parses multiple JSON fields in a record', () => {
            const record = {
                id: '1',
                name: 'Test',
                items: '["item1","item2"]',
                config: '{"enabled":true}',
            };
            const result = parseJsonFields(record, {
                items: [],
                config: {},
            });
            expect(result.items).toEqual(['item1', 'item2']);
            expect(result.config).toEqual({ enabled: true });
            expect(result.id).toBe('1');
            expect(result.name).toBe('Test');
        });

        it('uses defaults for invalid JSON', () => {
            const record = { data: 'invalid' };
            const result = parseJsonFields(record, { data: ['default'] });
            expect(result.data).toEqual(['default']);
        });
    });
});
