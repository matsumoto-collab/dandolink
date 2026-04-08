// Re-export all validations for backward compatibility
export { emailSchema, passwordSchema, phoneSchema, validateRequest } from './common';
export { userRoleSchema, createUserSchema, createSupportUserSchema, updateUserSchema } from './user';
export type { CreateUserInput, UpdateUserInput } from './user';
export { contactPersonSchema, createCustomerSchema, updateCustomerSchema } from './customer';
export type { CreateCustomerInput, UpdateCustomerInput } from './customer';
export { constructionTypeSchema, createProjectMasterSchema, updateProjectMasterSchema } from './project';
export type { CreateProjectMasterInput, UpdateProjectMasterInput } from './project';
export { createAssignmentSchema, updateAssignmentSchema, batchUpdateAssignmentsSchema } from './assignment';
export type { CreateAssignmentInput, UpdateAssignmentInput } from './assignment';
export { workItemSchema, createDailyReportSchema, updateDailyReportSchema, createDailyReportApiSchema } from './dailyReport';
export type { CreateDailyReportInput, UpdateDailyReportInput } from './dailyReport';
export { createInvoiceSchema, updateInvoiceSchema, createEstimateSchema, updateEstimateSchema } from './finance';
export { cellRemarkSchema, calendarRemarkSchema, vacationSchema, memberAdjustmentSchema, displayedForemanIdsSchema } from './calendar';
export {
    costMasterSchema, nameOnlySchema, unitPriceCategorySchema, unitPriceSpecificationSchema,
    unitPriceTemplateSchema, unitPriceMasterSchema, companyInfoSchema, systemSettingsSchema,
    scaffoldingSpecItemSchema, memberCountHistoryCreateSchema, memberCountHistoryUpdateSchema,
    memberCountHistoryDeleteSchema, loadingListConfirmSchema, loadingCheckSchema,
    materialRequisitionCreateSchema, materialRequisitionUpdateSchema, projectMaterialsUpdateSchema,
} from './master';
