'use client';

import { SessionProvider } from 'next-auth/react';
import PushSubscriptionSync from './PushSubscriptionSync';

export default function AuthProvider({ children }: { children: React.ReactNode }) {
    return (
        <SessionProvider>
            <PushSubscriptionSync />
            {children}
        </SessionProvider>
    );
}
