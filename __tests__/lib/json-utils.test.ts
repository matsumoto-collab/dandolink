import {
    parseJsonField,
    stringifyJsonField,
    parseJsonFields,
} from '@/lib/json-utils';

describe('json-utils', () => {
    describe('parseJsonField', () => {
        it('should parse valid JSON string', () => {
            const result = parseJsonField('["a", "b", "c"]', []);
            expect(result).toEqual(['a', 'b', 'c']);
        });

        it('should return default value for null', () => {
            const result = parseJsonField(null, ['default']);
            expect(result).toEqual(['default']);
        });

        it('should return default value for undefined', () => {
            const result = parseJsonField(undefined, { key: 'value' });
            expect(result).toEqual({ key: 'value' });
        });

        it('should return default value for empty string', () => {
            const result = parseJsonField('', []);
            expect(result).toEqual([]);
        });

        it('should return default value for invalid JSON', () => {
            const result = parseJsonField('not valid json', 'default');
            expect(result).toBe('default');
        });

        it('should parse nested objects', () => {
            const json = '{"nested": {"key": "value"}}';
            const result = parseJsonField(json, {});
            expect(result).toEqual({ nested: { key: 'value' } });
        });
    });

    describe('stringifyJsonField', () => {
        it('should stringify array', () => {
            const result = stringifyJsonField(['a', 'b']);
            expect(result).toBe('["a","b"]');
        });

        it('should stringify object', () => {
            const result = stringifyJsonField({ key: 'value' });
            expect(result).toBe('{"key":"value"}');
        });

        it('should return null for null input', () => {
            const result = stringifyJsonField(null);
            expect(result).toBeNull();
        });

        it('should return null for undefined input', () => {
            const result = stringifyJsonField(undefined);
            expect(result).toBeNull();
        });

        it('should stringify primitive values', () => {
            expect(stringifyJsonField(123)).toBe('123');
            expect(stringifyJsonField('text')).toBe('"text"');
            expect(stringifyJsonField(true)).toBe('true');
        });
    });

    describe('parseJsonFields', () => {
        it('should parse multiple JSON fields in a record', () => {
            const record = {
                id: '1',
                name: 'Test',
                items: '["item1", "item2"]',
                config: '{"enabled": true}',
            };
            const result = parseJsonFields(record, {
                items: [],
                config: {},
            });

            expect(result.id).toBe('1');
            expect(result.name).toBe('Test');
            expect(result.items).toEqual(['item1', 'item2']);
            expect(result.config).toEqual({ enabled: true });
        });

        it('should use default values for invalid JSON fields', () => {
            const record = {
                id: '1',
                data: 'invalid json',
            };
            const result = parseJsonFields(record, {
                data: { default: true },
            });

            expect(result.data).toEqual({ default: true });
        });

        it('should not modify non-string fields', () => {
            const record = {
                id: '1',
                count: 42,
                active: true,
            };
            const result = parseJsonFields(record, {
                count: 0,
                active: false,
            });

            expect(result.count).toBe(42);
            expect(result.active).toBe(true);
        });

        it('should handle empty record', () => {
            const record = {};
            const result = parseJsonFields(record, { field: [] });
            expect(result).toEqual({});
        });
    });
});
