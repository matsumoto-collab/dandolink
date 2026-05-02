'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import ChatRoomView from './ChatRoomView';
import { logger } from '@/lib/logger';

interface ProjectChatTabProps {
    projectId: string;
}

/**
 * 案件詳細モーダルのチャットタブに埋め込む。
 * 案件専用ルーム（type='project'）を ensure-room で取得・作成し、
 * その roomId で ChatRoomView を描画する。
 */
export default function ProjectChatTab({ projectId }: ProjectChatTabProps) {
    const { data: session } = useSession();
    const [roomId, setRoomId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setRoomId(null);
        setError(null);
        (async () => {
            try {
                const res = await fetch(`/api/chat/projects/${projectId}/ensure-room`, {
                    method: 'POST',
                });
                if (!res.ok) throw new Error('ensure-room failed');
                const data = await res.json();
                if (!cancelled) setRoomId(data.roomId);
            } catch (e) {
                logger.error('[ProjectChatTab] ensure-room', e);
                if (!cancelled) setError('チャットを開けませんでした');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [projectId]);

    if (error) {
        return (
            <div className="flex items-center justify-center py-12 text-sm text-rose-600">
                {error}
            </div>
        );
    }
    if (!roomId) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-500" />
            </div>
        );
    }
    return (
        <div className="h-[60vh] min-h-[400px] border border-slate-200 rounded-xl overflow-hidden">
            <ChatRoomView roomId={roomId} myUserId={session?.user?.id} />
        </div>
    );
}
