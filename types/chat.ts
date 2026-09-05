/** チャット機能の型定義 */

export interface ChatMember {
    userId: string;
    role: string;          // 'owner' | 'member'
    isMuted?: boolean;
    isPinned?: boolean;
    displayName: string;
    userRole: string | null;  // ユーザーのシステムロール（admin/manager/foreman1...）
}

export interface ChatRoomSummary {
    id: string;
    type: string;          // 'dm' | 'group' | 'project'
    name: string | null;
    projectMasterId: string | null;
    lastMessageAt: string | Date | null;
    lastMessagePreview: string | null;
    isArchived: boolean;
    isMuted: boolean;
    isPinned: boolean;
    unreadCount: number;
    members: ChatMember[];
}

export interface MessageMention {
    id: string;
    messageId: string;
    targetType: 'user' | 'project' | 'role';
    targetId: string;
    label?: string | null;
}

export interface MessageAttachment {
    id: string;
    messageId: string;
    fileType: string;       // 'image' | 'pdf'
    storagePath: string;
    thumbnailPath: string | null;
    signedUrl: string | null;
    thumbnailSignedUrl: string | null;
    mimeType: string;
    fileSize: number;
    width: number | null;
    height: number | null;
}

export interface MessageRead {
    userId: string;
    readAt: string | Date;
}

export interface MessageReaction {
    id: string;
    userId: string;
    emoji: string;
}

export interface ChatMessage {
    id: string;
    roomId: string;
    senderId: string;
    body: string;
    contentType: string;
    parentId: string | null;
    editedAt: string | Date | null;
    deletedAt: string | Date | null;
    createdAt: string | Date;
    mentions: MessageMention[];
    attachments: MessageAttachment[];
    reads: MessageRead[];
    reactions?: MessageReaction[];
}

/**
 * 案件チャットのヘッダー「予定」ボタンで出す配置（予定）1件。
 * GET /api/chat/rooms/[roomId]/schedule のレスポンス items の要素。
 */
export interface ProjectScheduleItem {
    id: string;
    /** JST の YYYY-MM-DD */
    dateKey: string;
    foremanName: string;
    memberCount: number;
    estimatedHours: number;
    constructionTypeName: string | null;
    isDispatchConfirmed: boolean;
    /** 日付が仮押さえ（dateStatus === 'tentative'） */
    isTentative: boolean;
    meetingTime: string | null;
}

/** GET /api/chat/rooms/[roomId]/schedule のレスポンス */
export interface ProjectScheduleResponse {
    projectMasterId: string;
    /** JST の今日（YYYY-MM-DD）。過去/今後の判定に使う */
    todayKey: string;
    items: ProjectScheduleItem[];
}
