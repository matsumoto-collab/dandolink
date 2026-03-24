'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useMaterialStore } from '@/stores/materialStore';

export function useMaterialData() {
    const { status } = useSession();
    const store = useMaterialStore();

    useEffect(() => {
        if (status === 'authenticated' && !store.isCategoriesInitialized) {
            store.fetchCategories();
        }
    }, [status, store.isCategoriesInitialized]);

    return store;
}
