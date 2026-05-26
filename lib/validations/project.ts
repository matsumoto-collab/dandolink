import { z } from 'zod';

export const constructionTypeSchema = z.string().min(1);

export const createProjectMasterSchema = z.object({
    title: z
        .string()
        .max(200, '案件名は200文字以内で入力してください')
        .optional()
        .default(''),
    name: z.string().max(100, '名前は100文字以内で入力してください').optional().nullable(),
    honorific: z.string().max(20).optional().nullable(),
    constructionSuffixId: z.string().optional().nullable(),
    siteShortName: z.string().max(100, '場所は100文字以内で入力してください').optional().nullable(),
    customerId: z.string().optional().nullable(),
    customerName: z.string().max(200).optional().nullable(),
    customerShortName: z.string().max(100).optional().nullable(),
    constructionType: constructionTypeSchema.optional(),
    constructionContent: z.string().optional().nullable(),
    postalCode: z.string().regex(/^\d{3}-?\d{4}$/, '有効な郵便番号を入力してください').optional().nullable(),
    prefecture: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    location: z.string().max(500).optional().nullable(),
    plusCode: z.string().optional().nullable(),
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
    area: z.number().optional().nullable(),
    areaRemarks: z.string().optional().nullable(),
    estimatedAssemblyWorkers: z.number().int().min(0).optional().nullable(),
    estimatedDemolitionWorkers: z.number().int().min(0).optional().nullable(),
    contractAmount: z.number().min(0).optional().nullable(),
    materialCost: z.number().min(0).optional().nullable(),
    otherExpenses: z.number().min(0).optional().nullable(),
    subcontractorCosts: z
        .array(
            z.object({
                constructionTypeId: z.string().min(1),
                amount: z.number().min(0),
                transportCost: z.number().min(0).nullable().optional(),
            })
        )
        .optional(),
    scaffoldingSpec: z.unknown().optional().nullable(),
    description: z.string().optional().nullable(),
    remarks: z.string().max(2000).optional().nullable(),
    createdBy: z.array(z.string()).optional(),
    status: z.enum(['active', 'completed', 'cancelled']).optional(),
});

export const updateProjectMasterSchema = createProjectMasterSchema.partial();

export type CreateProjectMasterInput = z.infer<typeof createProjectMasterSchema>;
export type UpdateProjectMasterInput = z.infer<typeof updateProjectMasterSchema>;
