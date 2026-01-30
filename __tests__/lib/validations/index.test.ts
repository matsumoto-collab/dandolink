/**
 * lib/validations/index.ts のテスト
 * Zodスキーマのバリデーションテスト
 */

import {
    emailSchema,
    passwordSchema,
    phoneSchema,
    userRoleSchema,
    createUserSchema,
    updateUserSchema,
    contactPersonSchema,
    createCustomerSchema,
    constructionTypeSchema,
    createProjectMasterSchema,
    createAssignmentSchema,
    workItemSchema,
    createDailyReportSchema,
    validateRequest,
} from '@/lib/validations';

describe('Validation Schemas', () => {
    describe('emailSchema', () => {
        it('should accept valid email', () => {
            const result = emailSchema.safeParse('test@example.com');
            expect(result.success).toBe(true);
        });

        it('should reject invalid email', () => {
            const result = emailSchema.safeParse('invalid-email');
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues[0].message).toContain('メールアドレス');
            }
        });

        it('should reject empty string', () => {
            const result = emailSchema.safeParse('');
            expect(result.success).toBe(false);
        });
    });

    describe('passwordSchema', () => {
        it('should accept valid password with letters and numbers', () => {
            const result = passwordSchema.safeParse('Password123');
            expect(result.success).toBe(true);
        });

        it('should reject password without numbers', () => {
            const result = passwordSchema.safeParse('OnlyLetters');
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues[0].message).toContain('英字と数字');
            }
        });

        it('should reject password without letters', () => {
            const result = passwordSchema.safeParse('12345678');
            expect(result.success).toBe(false);
        });

        it('should reject password shorter than 8 characters', () => {
            const result = passwordSchema.safeParse('Pass1');
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues[0].message).toContain('8文字以上');
            }
        });

        it('should reject password longer than 100 characters', () => {
            const result = passwordSchema.safeParse('a'.repeat(99) + '1234');
            expect(result.success).toBe(false);
        });
    });

    describe('phoneSchema', () => {
        it('should accept valid phone number', () => {
            const result = phoneSchema.safeParse('03-1234-5678');
            expect(result.success).toBe(true);
        });

        it('should accept phone with international format', () => {
            const result = phoneSchema.safeParse('+81-3-1234-5678');
            expect(result.success).toBe(true);
        });

        it('should accept null', () => {
            const result = phoneSchema.safeParse(null);
            expect(result.success).toBe(true);
        });

        it('should accept undefined', () => {
            const result = phoneSchema.safeParse(undefined);
            expect(result.success).toBe(true);
        });

        it('should reject phone with letters', () => {
            const result = phoneSchema.safeParse('03-abcd-5678');
            expect(result.success).toBe(false);
        });
    });

    describe('userRoleSchema', () => {
        const validRoles = ['admin', 'manager', 'foreman1', 'foreman2', 'worker', 'partner'];

        validRoles.forEach((role) => {
            it(`should accept role: ${role}`, () => {
                const result = userRoleSchema.safeParse(role);
                expect(result.success).toBe(true);
            });
        });

        it('should reject invalid role', () => {
            const result = userRoleSchema.safeParse('superuser');
            expect(result.success).toBe(false);
        });
    });

    describe('createUserSchema', () => {
        const validUser = {
            username: 'testuser',
            email: 'test@example.com',
            displayName: 'テストユーザー',
            password: 'Password123',
            role: 'worker' as const,
        };

        it('should accept valid user data', () => {
            const result = createUserSchema.safeParse(validUser);
            expect(result.success).toBe(true);
        });

        it('should reject username shorter than 3 characters', () => {
            const result = createUserSchema.safeParse({ ...validUser, username: 'ab' });
            expect(result.success).toBe(false);
        });

        it('should reject username with special characters', () => {
            const result = createUserSchema.safeParse({ ...validUser, username: 'user@name' });
            expect(result.success).toBe(false);
        });

        it('should accept username with underscore', () => {
            const result = createUserSchema.safeParse({ ...validUser, username: 'test_user' });
            expect(result.success).toBe(true);
        });

        it('should reject empty displayName', () => {
            const result = createUserSchema.safeParse({ ...validUser, displayName: '' });
            expect(result.success).toBe(false);
        });
    });

    describe('updateUserSchema', () => {
        it('should accept partial update', () => {
            const result = updateUserSchema.safeParse({ displayName: '新しい名前' });
            expect(result.success).toBe(true);
        });

        it('should accept empty object', () => {
            const result = updateUserSchema.safeParse({});
            expect(result.success).toBe(true);
        });

        it('should reject invalid email in partial update', () => {
            const result = updateUserSchema.safeParse({ email: 'invalid' });
            expect(result.success).toBe(false);
        });
    });

    describe('contactPersonSchema', () => {
        it('should accept valid contact person', () => {
            const result = contactPersonSchema.safeParse({
                name: '担当太郎',
                position: '部長',
                phone: '03-1234-5678',
                email: 'contact@example.com',
            });
            expect(result.success).toBe(true);
        });

        it('should require name', () => {
            const result = contactPersonSchema.safeParse({
                position: '部長',
            });
            expect(result.success).toBe(false);
        });

        it('should accept contact without optional fields', () => {
            const result = contactPersonSchema.safeParse({
                name: '担当太郎',
            });
            expect(result.success).toBe(true);
        });
    });

    describe('createCustomerSchema', () => {
        it('should accept valid customer', () => {
            const result = createCustomerSchema.safeParse({
                name: '株式会社テスト',
                shortName: 'テスト社',
                email: 'info@test.co.jp',
                phone: '03-1234-5678',
                address: '東京都渋谷区1-2-3',
            });
            expect(result.success).toBe(true);
        });

        it('should require name', () => {
            const result = createCustomerSchema.safeParse({
                email: 'info@test.co.jp',
            });
            expect(result.success).toBe(false);
        });

        it('should reject name longer than 200 characters', () => {
            const result = createCustomerSchema.safeParse({
                name: 'a'.repeat(201),
            });
            expect(result.success).toBe(false);
        });
    });

    describe('constructionTypeSchema', () => {
        it('should accept assembly', () => {
            const result = constructionTypeSchema.safeParse('assembly');
            expect(result.success).toBe(true);
        });

        it('should accept demolition', () => {
            const result = constructionTypeSchema.safeParse('demolition');
            expect(result.success).toBe(true);
        });

        it('should accept other', () => {
            const result = constructionTypeSchema.safeParse('other');
            expect(result.success).toBe(true);
        });

        it('should reject invalid type', () => {
            const result = constructionTypeSchema.safeParse('construction');
            expect(result.success).toBe(false);
        });
    });

    describe('createProjectMasterSchema', () => {
        it('should accept valid project master', () => {
            const result = createProjectMasterSchema.safeParse({
                title: 'テスト案件',
                customerId: 'customer-1',
                constructionType: 'assembly',
                location: '東京都新宿区',
                area: 500,
                contractAmount: 1000000,
            });
            expect(result.success).toBe(true);
        });

        it('should require title', () => {
            const result = createProjectMasterSchema.safeParse({
                constructionType: 'assembly',
            });
            expect(result.success).toBe(false);
        });

        it('should validate postal code format', () => {
            const validPostal = createProjectMasterSchema.safeParse({
                title: 'テスト',
                postalCode: '123-4567',
            });
            expect(validPostal.success).toBe(true);

            const invalidPostal = createProjectMasterSchema.safeParse({
                title: 'テスト',
                postalCode: '12345',
            });
            expect(invalidPostal.success).toBe(false);
        });

        it('should accept valid status values', () => {
            ['active', 'completed', 'cancelled'].forEach((status) => {
                const result = createProjectMasterSchema.safeParse({
                    title: 'テスト',
                    status,
                });
                expect(result.success).toBe(true);
            });
        });
    });

    describe('createAssignmentSchema', () => {
        const validAssignment = {
            projectMasterId: 'pm-1',
            assignedEmployeeId: 'emp-1',
            date: '2024-01-15',
        };

        it('should accept valid assignment', () => {
            const result = createAssignmentSchema.safeParse(validAssignment);
            expect(result.success).toBe(true);
        });

        it('should require projectMasterId', () => {
            const result = createAssignmentSchema.safeParse({
                assignedEmployeeId: 'emp-1',
                date: '2024-01-15',
            });
            expect(result.success).toBe(false);
        });

        it('should require assignedEmployeeId', () => {
            const result = createAssignmentSchema.safeParse({
                projectMasterId: 'pm-1',
                date: '2024-01-15',
            });
            expect(result.success).toBe(false);
        });

        it('should require date', () => {
            const result = createAssignmentSchema.safeParse({
                projectMasterId: 'pm-1',
                assignedEmployeeId: 'emp-1',
            });
            expect(result.success).toBe(false);
        });

        it('should accept optional fields', () => {
            const result = createAssignmentSchema.safeParse({
                ...validAssignment,
                memberCount: 5,
                workers: ['w1', 'w2'],
                vehicles: ['v1'],
                meetingTime: '08:00',
                sortOrder: 1,
                remarks: 'テスト備考',
            });
            expect(result.success).toBe(true);
        });
    });

    describe('workItemSchema', () => {
        it('should accept valid work item', () => {
            const result = workItemSchema.safeParse({
                projectId: 'proj-1',
                projectTitle: 'テスト案件',
                workMinutes: 480,
                remarks: '作業メモ',
            });
            expect(result.success).toBe(true);
        });

        it('should require projectId', () => {
            const result = workItemSchema.safeParse({
                workMinutes: 480,
            });
            expect(result.success).toBe(false);
        });

        it('should reject negative workMinutes', () => {
            const result = workItemSchema.safeParse({
                projectId: 'proj-1',
                workMinutes: -30,
            });
            expect(result.success).toBe(false);
        });
    });

    describe('createDailyReportSchema', () => {
        const validReport = {
            date: '2024-01-15',
            foremanId: 'foreman-1',
            workItems: [
                { projectId: 'proj-1', workMinutes: 480 },
            ],
        };

        it('should accept valid daily report', () => {
            const result = createDailyReportSchema.safeParse(validReport);
            expect(result.success).toBe(true);
        });

        it('should require at least one work item', () => {
            const result = createDailyReportSchema.safeParse({
                ...validReport,
                workItems: [],
            });
            expect(result.success).toBe(false);
        });

        it('should accept Date object for date', () => {
            const result = createDailyReportSchema.safeParse({
                ...validReport,
                date: new Date('2024-01-15'),
            });
            expect(result.success).toBe(true);
        });

        it('should default loading minutes to 0', () => {
            const result = createDailyReportSchema.safeParse(validReport);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.morningLoadingMinutes).toBe(0);
                expect(result.data.eveningLoadingMinutes).toBe(0);
            }
        });
    });

    describe('validateRequest', () => {
        it('should return success true with parsed data', () => {
            const result = validateRequest(emailSchema, 'test@example.com');
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data).toBe('test@example.com');
            }
        });

        it('should return success false with error message', () => {
            const result = validateRequest(emailSchema, 'invalid');
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error).toContain('メールアドレス');
                expect(result.details).toBeDefined();
            }
        });

        it('should work with complex schemas', () => {
            const result = validateRequest(createUserSchema, {
                username: 'testuser',
                email: 'test@example.com',
                displayName: 'テスト',
                password: 'Password123',
                role: 'worker',
            });
            expect(result.success).toBe(true);
        });

        it('should return first error for multiple validation errors', () => {
            const result = validateRequest(createUserSchema, {
                username: 'x', // too short
                email: 'invalid', // invalid email
                displayName: '', // empty
                password: '123', // too short, no letters
                role: 'invalid', // invalid role
            });
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.details).toBeDefined();
                expect(result.details!.length).toBeGreaterThan(1);
            }
        });
    });
});
