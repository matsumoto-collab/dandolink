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
