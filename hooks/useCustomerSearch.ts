import { useState, useEffect, useMemo } from 'react';
import { Customer } from '@/types/customer';
import { logger } from '@/lib/logger';
import { matchesSearch } from '@/utils/searchNormalize';

export function useCustomerSearch() {
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchCustomers = async () => {
            setIsLoading(true);
            try {
                const res = await fetch('/api/customers');
                if (res.ok) {
                    const data = await res.json();
                    setCustomers(data);
                }
            } catch (error) {
                logger.error('Failed to fetch customers:', error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchCustomers();
    }, []);

    const filteredCustomers = useMemo(() => {
        return customers.filter(c =>
            matchesSearch(c.name, searchTerm) ||
            matchesSearch(c.shortName, searchTerm)
        );
    }, [customers, searchTerm]);

    return {
        customers,
        setCustomers,
        filteredCustomers,
        searchTerm,
        setSearchTerm,
        showDropdown,
        setShowDropdown,
        isLoading,
    };
}
