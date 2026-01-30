import { useCallback } from 'react';

interface AddressResult {
    prefecture: string;
    city: string;
}

export function usePostalCodeAutofill() {
    const fetchAddress = useCallback(async (postalCode: string): Promise<AddressResult | null> => {
        const cleanCode = postalCode.replace(/[^0-9]/g, '');

        if (cleanCode.length !== 7) {
            return null;
        }

        try {
            const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${cleanCode}`);
            const data = await res.json();

            if (data.results && data.results[0]) {
                const result = data.results[0];
                return {
                    prefecture: result.address1,
                    city: result.address2 + result.address3,
                };
            }
            return null;
        } catch (error) {
            console.error('Failed to fetch address:', error);
            return null;
        }
    }, []);

    return { fetchAddress };
}
