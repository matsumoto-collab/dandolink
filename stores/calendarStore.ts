import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import { CalendarStore, CalendarState, assignmentToProject } from './calendarSlices/types';
import { createProjectMasterSlice } from './calendarSlices/projectMasterSlice';
import { createForemanSlice } from './calendarSlices/foremanSlice';
import { createDailyReportSlice } from './calendarSlices/dailyReportSlice';
import { createAssignmentSlice } from './calendarSlices/assignmentSlice';
import { createVacationSlice } from './calendarSlices/vacationSlice';
import { createRemarkSlice } from './calendarSlices/remarkSlice';

const initialState: CalendarState = {
    projectMasters: [],
    projectMastersLoading: false,
    projectMastersError: null,
    projectMastersInitialized: false,
    displayedForemanIds: [],
    allForemen: [],
    foremanSettingsLoading: false,
    foremanSettingsInitialized: false,
    dailyReports: [],
    dailyReportsLoading: false,
    dailyReportsInitialized: false,
    assignments: [],
    projectsLoading: false,
    projectsInitialized: false,
    vacations: {},
    vacationsLoading: false,
    vacationsInitialized: false,
    remarks: {},
    remarksLoading: false,
    remarksInitialized: false,
};

export const useCalendarStore = create<CalendarStore>()(
    subscribeWithSelector((...a) => ({
        ...createProjectMasterSlice(...a),
        ...createForemanSlice(...a),
        ...createDailyReportSlice(...a),
        ...createAssignmentSlice(...a),
        ...createVacationSlice(...a),
        ...createRemarkSlice(...a),
        reset: () => a[0](initialState),
    }))
);

// Re-export types and classes
export { ConflictUpdateError } from './calendarSlices/types';
export type { CalendarStore } from './calendarSlices/types';

// Selectors
export const selectProjectMasters = (state: CalendarStore) => state.projectMasters;
export const selectProjectMastersLoading = (state: CalendarStore) => state.projectMastersLoading;
export const selectDisplayedForemanIds = (state: CalendarStore) => state.displayedForemanIds;
export const selectAllForemen = (state: CalendarStore) => state.allForemen;
export const selectDailyReports = (state: CalendarStore) => state.dailyReports;
export const selectDailyReportsLoading = (state: CalendarStore) => state.dailyReportsLoading;
export const selectProjects = (state: CalendarStore) => state.assignments.map(assignmentToProject);
export const selectProjectsLoading = (state: CalendarStore) => state.projectsLoading;
export const selectProjectsInitialized = (state: CalendarStore) => state.projectsInitialized;

export const selectVacations = (state: CalendarStore) => state.vacations;
export const selectVacationsLoading = (state: CalendarStore) => state.vacationsLoading;
export const selectVacationsInitialized = (state: CalendarStore) => state.vacationsInitialized;

export const selectRemarks = (state: CalendarStore) => state.remarks;
export const selectRemarksLoading = (state: CalendarStore) => state.remarksLoading;
export const selectRemarksInitialized = (state: CalendarStore) => state.remarksInitialized;
