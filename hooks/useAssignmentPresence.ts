'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { AssignmentEditingState, EditingUser } from '@/types/calendar';

interface PresenceState {
    [key: string]: AssignmentEditingState[];
}

export function useAssignmentPresence() {
    const { data: session } = useSession();
    const channelRef = useRef<RealtimeChannel | null>(null);
    const [editingUsers, setEditingUsers] = useState<Map<string, EditingUser[]>>(new Map());
    const currentEditingIdRef = useRef<string | null>(null);

    // Presenceチャンネルのセットアップ
    useEffect(() => {
        if (!session?.user) return;

        let channel: RealtimeChannel | null = null;

        const setupPresence = async () => {
            try {
                const { supabase } = await import('@/lib/supabase');

                channel = supabase.channel('assignment_editing', {
                    config: {
                        presence: {
                            key: session.user.id,
                        },
                    },
                });

                channel
                    .on('presence', { event: 'sync' }, () => {
                        const state = channel?.presenceState<AssignmentEditingState>() || {};
                        updateEditingUsers(state);
                    })
                    .on('presence', { event: 'join' }, ({ newPresences }) => {
                        console.log('User joined editing:', newPresences);
                    })
                    .on('presence', { event: 'leave' }, ({ leftPresences }) => {
                        console.log('User left editing:', leftPresences);
                    })
                    .subscribe(async (status) => {
                        if (status === 'SUBSCRIBED') {
                            channelRef.current = channel;
                        }
                    });
            } catch (error) {
                console.error('Failed to setup presence:', error);
            }
        };

        setupPresence();

        return () => {
            const channelToRemove = channel;
            if (channelToRemove) {
                import('@/lib/supabase')
                    .then(({ supabase }) => {
                        supabase.removeChannel(channelToRemove);
                    })
                    .catch(() => {});
            }
            channelRef.current = null;
        };
    }, [session?.user]);

    // Presence状態からeditingUsersマップを更新
    const updateEditingUsers = useCallback((state: PresenceState) => {
        const newMap = new Map<string, EditingUser[]>();

        Object.values(state).forEach((presences) => {
            presences.forEach((presence) => {
                if (presence.assignmentId) {
                    const existing = newMap.get(presence.assignmentId) || [];
                    existing.push({
                        id: presence.userId,
                        name: presence.userName,
                        startedAt: new Date(presence.startedAt),
                    });
                    newMap.set(presence.assignmentId, existing);
                }
            });
        });

        setEditingUsers(newMap);
    }, []);

    // 編集開始を通知
    const startEditing = useCallback(async (assignmentId: string) => {
        if (!session?.user || !channelRef.current) return;

        // 既に別の案件を編集中なら先に終了
        if (currentEditingIdRef.current && currentEditingIdRef.current !== assignmentId) {
            await stopEditing();
        }

        currentEditingIdRef.current = assignmentId;

        const presenceData: AssignmentEditingState = {
            assignmentId,
            userId: session.user.id,
            userName: session.user.name || session.user.email || '不明',
            startedAt: new Date().toISOString(),
        };

        try {
            await channelRef.current.track(presenceData);
        } catch (error) {
            console.error('Failed to track presence:', error);
        }
    }, [session?.user]);

    // 編集終了を通知
    const stopEditing = useCallback(async () => {
        if (!channelRef.current) return;

        currentEditingIdRef.current = null;

        try {
            await channelRef.current.untrack();
        } catch (error) {
            console.error('Failed to untrack presence:', error);
        }
    }, []);

    // 指定したassignmentIdを編集中のユーザーを取得（自分を除く）
    const getEditingUsers = useCallback((assignmentId: string): EditingUser[] => {
        const users = editingUsers.get(assignmentId) || [];
        // 自分自身は除外
        return users.filter(u => u.id !== session?.user?.id);
    }, [editingUsers, session?.user?.id]);

    // 誰かが編集中かどうか（自分を除く）
    const isBeingEdited = useCallback((assignmentId: string): boolean => {
        return getEditingUsers(assignmentId).length > 0;
    }, [getEditingUsers]);

    return {
        startEditing,
        stopEditing,
        getEditingUsers,
        isBeingEdited,
        editingUsers,
    };
}
