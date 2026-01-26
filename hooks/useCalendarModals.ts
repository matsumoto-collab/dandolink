import { useState, useCallback } from 'react';
import { Project, CalendarEvent, ProjectMaster } from '@/types/calendar';

interface CellContext {
    employeeId: string;
    date: Date;
}

export function useCalendarModals(
    projects: Project[],
    events: CalendarEvent[],
    addProject: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>
) {
    // プロジェクトモーダル
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalInitialData, setModalInitialData] = useState<Partial<Project>>({});

    // 案件マスター検索モーダル
    const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
    const [cellContext, setCellContext] = useState<CellContext | null>(null);

    // 手配確定モーダル
    const [isDispatchModalOpen, setIsDispatchModalOpen] = useState(false);
    const [dispatchProject, setDispatchProject] = useState<Project | null>(null);

    // コピーモーダル
    const [isCopyModalOpen, setIsCopyModalOpen] = useState(false);
    const [copyEvent, setCopyEvent] = useState<CalendarEvent | null>(null);

    // 案件登録方法選択モーダル
    const [isSelectionModalOpen, setIsSelectionModalOpen] = useState(false);

    // セルクリック時に選択モーダルを表示
    const handleCellClick = useCallback((employeeId: string, date: Date) => {
        setCellContext({ employeeId, date });
        setIsSelectionModalOpen(true);
    }, []);

    // 既存案件から作成を選択
    const handleSelectExisting = useCallback(() => {
        setIsSelectionModalOpen(false);
        setIsSearchModalOpen(true);
    }, []);

    // 新規作成を選択
    const handleCreateNew = useCallback(() => {
        if (!cellContext) return;
        setIsSelectionModalOpen(false);
        setModalInitialData({
            startDate: cellContext.date,
            assignedEmployeeId: cellContext.employeeId,
        });
        setIsModalOpen(true);
    }, [cellContext]);

    // 選択モーダルをキャンセル
    const handleSelectionCancel = useCallback(() => {
        setIsSelectionModalOpen(false);
        setCellContext(null);
    }, []);

    // 案件マスターを選択したら配置を作成
    const handleSelectProjectMaster = useCallback((projectMaster: ProjectMaster) => {
        if (!cellContext) return;

        const newProject: Omit<Project, 'id' | 'createdAt' | 'updatedAt'> = {
            title: projectMaster.title,
            customer: projectMaster.customerName,
            location: projectMaster.location,
            startDate: cellContext.date,
            endDate: cellContext.date,
            assignedEmployeeId: cellContext.employeeId,
            constructionType: projectMaster.constructionType || 'assembly',
            constructionContent: projectMaster.constructionContent,
            status: 'pending',
            remarks: projectMaster.remarks,
            workers: [],
            vehicles: [],
            trucks: [],
            category: 'construction',
            color: '',
            projectMasterId: projectMaster.id,
        };

        addProject(newProject as Project);
        setIsSearchModalOpen(false);
        setCellContext(null);
    }, [cellContext, addProject]);

    // イベントクリック時に編集モーダルを開く
    const handleEventClick = useCallback((eventId: string) => {
        const projectId = eventId.replace(/-assembly$|-demolition$/, '');
        const project = projects.find(p => p.id === projectId);
        if (project) {
            setModalInitialData(project);
            setIsModalOpen(true);
        }
    }, [projects]);

    // プロジェクトモーダルを閉じる
    const handleCloseModal = useCallback(() => {
        setIsModalOpen(false);
        setModalInitialData({});
    }, []);

    // 検索モーダルを閉じる
    const handleCloseSearchModal = useCallback(() => {
        setIsSearchModalOpen(false);
        setCellContext(null);
    }, []);

    // 手配確定モーダルを開く
    const handleOpenDispatchModal = useCallback((projectId: string) => {
        const project = projects.find(p => p.id === projectId);
        if (project) {
            setDispatchProject(project);
            setIsDispatchModalOpen(true);
        }
    }, [projects]);

    // 手配確定モーダルを閉じる
    const handleCloseDispatchModal = useCallback(() => {
        setIsDispatchModalOpen(false);
        setDispatchProject(null);
    }, []);

    // コピーイベントクリック
    const handleCopyEvent = useCallback((eventId: string) => {
        const event = events.find(e => e.id === eventId);
        if (event) {
            setCopyEvent(event);
            setIsCopyModalOpen(true);
        }
    }, [events]);

    // コピーモーダルを閉じる
    const handleCloseCopyModal = useCallback(() => {
        setIsCopyModalOpen(false);
        setCopyEvent(null);
    }, []);

    // コピー実行
    const handleCopyAssignment = useCallback(async (startDate: Date, endDate: Date, employeeId: string) => {
        if (!copyEvent) return;

        const projectId = copyEvent.id.replace(/-assembly$|-demolition$/, '');
        const sourceProject = projects.find(p => p.id === projectId);
        if (!sourceProject) return;

        const currentDate = new Date(startDate);
        while (currentDate <= endDate) {
            const newProject: Omit<Project, 'id' | 'createdAt' | 'updatedAt'> = {
                title: sourceProject.title,
                customer: sourceProject.customer,
                location: sourceProject.location,
                startDate: new Date(currentDate),
                endDate: new Date(currentDate),
                assignedEmployeeId: employeeId,
                constructionType: sourceProject.constructionType || 'assembly',
                status: 'pending',
                remarks: sourceProject.remarks,
                workers: sourceProject.workers || [],
                vehicles: sourceProject.vehicles || [],
                trucks: sourceProject.trucks || [],
                category: sourceProject.category || 'construction',
                color: sourceProject.color || '',
                projectMasterId: sourceProject.projectMasterId,
            };

            await addProject(newProject as Project);
            currentDate.setDate(currentDate.getDate() + 1);
        }
    }, [copyEvent, projects, addProject]);

    return {
        // プロジェクトモーダル
        isModalOpen,
        modalInitialData,
        handleEventClick,
        handleCloseModal,
        setModalInitialData,
        setIsModalOpen,

        // 検索モーダル
        isSearchModalOpen,
        cellContext,
        handleSelectProjectMaster,
        handleCloseSearchModal,

        // 選択モーダル
        isSelectionModalOpen,
        handleCellClick,
        handleSelectExisting,
        handleCreateNew,
        handleSelectionCancel,

        // 手配確定モーダル
        isDispatchModalOpen,
        dispatchProject,
        handleOpenDispatchModal,
        handleCloseDispatchModal,

        // コピーモーダル
        isCopyModalOpen,
        copyEvent,
        handleCopyEvent,
        handleCloseCopyModal,
        handleCopyAssignment,
    };
}
