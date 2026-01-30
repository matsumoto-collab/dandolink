import {
    formatAssignment,
    formatProjectMaster,
    formatEstimate,
    formatInvoice,
    RawAssignment,
    RawProjectMaster,
    RawEstimate,
    RawInvoice,
} from '@/lib/formatters';

describe('Formatters', () => {
    // テスト用の日付
    const testDate = new Date('2024-01-15T09:00:00.000Z');
    const testCreatedAt = new Date('2024-01-10T08:00:00.000Z');
    const testUpdatedAt = new Date('2024-01-14T10:00:00.000Z');

    describe('formatAssignment', () => {
        it('should format dates to ISO strings', () => {
            const raw: RawAssignment = {
                id: 'assignment-1',
                date: testDate,
                workers: null,
                vehicles: null,
                confirmedWorkerIds: null,
                confirmedVehicleIds: null,
                createdAt: testCreatedAt,
                updatedAt: testUpdatedAt,
            };

            const result = formatAssignment(raw);

            expect(result.date).toBe('2024-01-15T09:00:00.000Z');
            expect(result.createdAt).toBe('2024-01-10T08:00:00.000Z');
            expect(result.updatedAt).toBe('2024-01-14T10:00:00.000Z');
        });

        it('should parse JSON string fields to arrays', () => {
            const raw: RawAssignment = {
                id: 'assignment-1',
                date: testDate,
                workers: '["worker1","worker2"]',
                vehicles: '["vehicle1"]',
                confirmedWorkerIds: '["confirmed1"]',
                confirmedVehicleIds: '["vehicle2","vehicle3"]',
                createdAt: testCreatedAt,
                updatedAt: testUpdatedAt,
            };

            const result = formatAssignment(raw);

            expect(result.workers).toEqual(['worker1', 'worker2']);
            expect(result.vehicles).toEqual(['vehicle1']);
            expect(result.confirmedWorkerIds).toEqual(['confirmed1']);
            expect(result.confirmedVehicleIds).toEqual(['vehicle2', 'vehicle3']);
        });

        it('should return empty arrays for null JSON fields', () => {
            const raw: RawAssignment = {
                id: 'assignment-1',
                date: testDate,
                workers: null,
                vehicles: null,
                confirmedWorkerIds: null,
                confirmedVehicleIds: null,
                createdAt: testCreatedAt,
                updatedAt: testUpdatedAt,
            };

            const result = formatAssignment(raw);

            expect(result.workers).toEqual([]);
            expect(result.vehicles).toEqual([]);
            expect(result.confirmedWorkerIds).toEqual([]);
            expect(result.confirmedVehicleIds).toEqual([]);
        });

        it('should format nested projectMaster if present', () => {
            const raw: RawAssignment = {
                id: 'assignment-1',
                date: testDate,
                workers: null,
                vehicles: null,
                confirmedWorkerIds: null,
                confirmedVehicleIds: null,
                createdAt: testCreatedAt,
                updatedAt: testUpdatedAt,
                projectMaster: {
                    id: 'pm-1',
                    title: 'Test Project',
                    createdBy: '["user1","user2"]',
                    createdAt: testCreatedAt,
                    updatedAt: testUpdatedAt,
                },
            };

            const result = formatAssignment(raw);

            expect(result.projectMaster).not.toBeNull();
            expect(result.projectMaster?.createdBy).toEqual(['user1', 'user2']);
            expect(result.projectMaster?.createdAt).toBe('2024-01-10T08:00:00.000Z');
        });

        it('should return null projectMaster if not present', () => {
            const raw: RawAssignment = {
                id: 'assignment-1',
                date: testDate,
                workers: null,
                vehicles: null,
                confirmedWorkerIds: null,
                confirmedVehicleIds: null,
                createdAt: testCreatedAt,
                updatedAt: testUpdatedAt,
                projectMaster: null,
            };

            const result = formatAssignment(raw);

            expect(result.projectMaster).toBeNull();
        });

        it('should preserve other fields', () => {
            const raw: RawAssignment = {
                id: 'assignment-1',
                date: testDate,
                workers: null,
                vehicles: null,
                confirmedWorkerIds: null,
                confirmedVehicleIds: null,
                createdAt: testCreatedAt,
                updatedAt: testUpdatedAt,
                memberCount: 5,
                remarks: 'Test remarks',
                isDispatchConfirmed: true,
            };

            const result = formatAssignment(raw);

            expect(result.id).toBe('assignment-1');
            expect(result.memberCount).toBe(5);
            expect(result.remarks).toBe('Test remarks');
            expect(result.isDispatchConfirmed).toBe(true);
        });
    });

    describe('formatProjectMaster', () => {
        it('should format dates to ISO strings', () => {
            const raw: RawProjectMaster = {
                id: 'pm-1',
                title: 'Test Project',
                createdBy: null,
                createdAt: testCreatedAt,
                updatedAt: testUpdatedAt,
                assemblyDate: testDate,
                demolitionDate: new Date('2024-02-15T09:00:00.000Z'),
            };

            const result = formatProjectMaster(raw);

            expect(result.createdAt).toBe('2024-01-10T08:00:00.000Z');
            expect(result.updatedAt).toBe('2024-01-14T10:00:00.000Z');
            expect(result.assemblyDate).toBe('2024-01-15T09:00:00.000Z');
            expect(result.demolitionDate).toBe('2024-02-15T09:00:00.000Z');
        });

        it('should handle null dates', () => {
            const raw: RawProjectMaster = {
                id: 'pm-1',
                title: 'Test Project',
                createdBy: null,
                createdAt: testCreatedAt,
                updatedAt: testUpdatedAt,
                assemblyDate: null,
                demolitionDate: undefined,
            };

            const result = formatProjectMaster(raw);

            expect(result.assemblyDate).toBeNull();
            expect(result.demolitionDate).toBeNull();
        });

        it('should parse createdBy JSON string', () => {
            const raw: RawProjectMaster = {
                id: 'pm-1',
                title: 'Test Project',
                createdBy: '["manager1","manager2"]',
                createdAt: testCreatedAt,
                updatedAt: testUpdatedAt,
            };

            const result = formatProjectMaster(raw);

            expect(result.createdBy).toEqual(['manager1', 'manager2']);
        });

        it('should format nested assignments', () => {
            const raw: RawProjectMaster = {
                id: 'pm-1',
                title: 'Test Project',
                createdBy: null,
                createdAt: testCreatedAt,
                updatedAt: testUpdatedAt,
                assignments: [
                    {
                        id: 'a-1',
                        date: testDate,
                        workers: '["w1"]',
                        vehicles: null,
                        confirmedWorkerIds: null,
                        confirmedVehicleIds: null,
                        createdAt: testCreatedAt,
                        updatedAt: testUpdatedAt,
                    },
                ],
            };

            const result = formatProjectMaster(raw);

            expect(result.assignments).toHaveLength(1);
            expect(result.assignments?.[0].date).toBe('2024-01-15T09:00:00.000Z');
            expect(result.assignments?.[0].workers).toEqual(['w1']);
        });
    });

    describe('formatEstimate', () => {
        it('should format dates and parse items', () => {
            const raw: RawEstimate = {
                id: 'est-1',
                estimateNumber: 'EST-001',
                title: 'Test Estimate',
                items: '[{"description":"Item 1","amount":1000}]',
                validUntil: testDate,
                createdAt: testCreatedAt,
                updatedAt: testUpdatedAt,
                subtotal: 1000,
                tax: 100,
                total: 1100,
            };

            const result = formatEstimate(raw);

            expect(result.items).toEqual([{ description: 'Item 1', amount: 1000 }]);
            expect(result.validUntil).toBe('2024-01-15T09:00:00.000Z');
            expect(result.createdAt).toBe('2024-01-10T08:00:00.000Z');
            expect(result.updatedAt).toBe('2024-01-14T10:00:00.000Z');
        });

        it('should return empty array for null items', () => {
            const raw: RawEstimate = {
                id: 'est-1',
                items: null,
                validUntil: testDate,
                createdAt: testCreatedAt,
                updatedAt: testUpdatedAt,
            };

            const result = formatEstimate(raw);

            expect(result.items).toEqual([]);
        });

        it('should preserve numeric fields', () => {
            const raw: RawEstimate = {
                id: 'est-1',
                items: '[]',
                validUntil: testDate,
                createdAt: testCreatedAt,
                updatedAt: testUpdatedAt,
                subtotal: 50000,
                tax: 5000,
                total: 55000,
            };

            const result = formatEstimate(raw);

            expect(result.subtotal).toBe(50000);
            expect(result.tax).toBe(5000);
            expect(result.total).toBe(55000);
        });
    });

    describe('formatInvoice', () => {
        it('should format dates and parse items', () => {
            const raw: RawInvoice = {
                id: 'inv-1',
                invoiceNumber: 'INV-001',
                title: 'Test Invoice',
                items: '[{"description":"Service","amount":2000}]',
                dueDate: testDate,
                paidDate: new Date('2024-01-20T10:00:00.000Z'),
                createdAt: testCreatedAt,
                updatedAt: testUpdatedAt,
            };

            const result = formatInvoice(raw);

            expect(result.items).toEqual([{ description: 'Service', amount: 2000 }]);
            expect(result.dueDate).toBe('2024-01-15T09:00:00.000Z');
            expect(result.paidDate).toBe('2024-01-20T10:00:00.000Z');
        });

        it('should handle null paidDate', () => {
            const raw: RawInvoice = {
                id: 'inv-1',
                items: '[]',
                dueDate: testDate,
                paidDate: null,
                createdAt: testCreatedAt,
                updatedAt: testUpdatedAt,
            };

            const result = formatInvoice(raw);

            expect(result.paidDate).toBeNull();
        });

        it('should return empty array for null items', () => {
            const raw: RawInvoice = {
                id: 'inv-1',
                items: null,
                dueDate: testDate,
                paidDate: null,
                createdAt: testCreatedAt,
                updatedAt: testUpdatedAt,
            };

            const result = formatInvoice(raw);

            expect(result.items).toEqual([]);
        });
    });
});
