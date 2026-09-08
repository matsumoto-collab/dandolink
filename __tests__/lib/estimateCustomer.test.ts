import { resolveEstimateCustomer, applyEstimateCustomerToProject } from '@/lib/estimateCustomer';

const customers = [
    { id: 'c-other', name: 'その他', honorific: '御中' },
    { id: 'c-abc', name: '株式会社ABC建設', honorific: '御中' },
    { id: 'c-tanaka', name: '田中太郎', honorific: '様' },
];

describe('resolveEstimateCustomer', () => {
    it('見積書自身の顧客を案件の顧客より優先する（フォームで変更・保存した顧客がPDFに出る）', () => {
        expect(resolveEstimateCustomer({
            estimateCustomerId: 'c-abc', projectCustomerId: 'c-other', customers,
            fallbackName: 'その他',
        })).toEqual({ name: '株式会社ABC建設', honorific: '御中' });
    });

    it('見積書に顧客が無ければ案件の顧客を使う', () => {
        expect(resolveEstimateCustomer({
            estimateCustomerId: null, projectCustomerId: 'c-tanaka', customers,
        })).toEqual({ name: '田中太郎', honorific: '様' });
    });

    it('見積書の顧客がマスタに見つからなければ（削除済みなど）案件の顧客に落ちる', () => {
        expect(resolveEstimateCustomer({
            estimateCustomerId: 'c-deleted', projectCustomerId: 'c-abc', customers,
        })).toEqual({ name: '株式会社ABC建設', honorific: '御中' });
    });

    it('どちらも引けなければ案件のスナップショット名、敬称は既定の御中', () => {
        expect(resolveEstimateCustomer({
            estimateCustomerId: undefined, projectCustomerId: undefined, customers,
            fallbackName: '旧顧客名',
        })).toEqual({ name: '旧顧客名', honorific: '御中' });
        expect(resolveEstimateCustomer({ customers, fallbackName: '旧顧客名', fallbackHonorific: '様' }))
            .toEqual({ name: '旧顧客名', honorific: '様' });
    });

    it('何も無ければ空文字と御中', () => {
        expect(resolveEstimateCustomer({ customers: [] })).toEqual({ name: '', honorific: '御中' });
    });

    it('マスタの敬称が空なら御中で補う', () => {
        expect(resolveEstimateCustomer({
            estimateCustomerId: 'x', customers: [{ id: 'x', name: 'X社', honorific: '' }],
        })).toEqual({ name: 'X社', honorific: '御中' });
    });
});

describe('applyEstimateCustomerToProject（見積詳細モーダルの宛名）', () => {
    const project = { id: 'p1', title: '現場A', location: '東京', customer: 'その他', customerHonorific: '御中' };

    it('見積書の顧客名があれば案件の宛名を上書きし、現場名などはそのまま', () => {
        expect(applyEstimateCustomerToProject(project, '株式会社ABC建設', '様')).toEqual({
            ...project, customer: '株式会社ABC建設', customerHonorific: '様',
        });
    });

    it('敬称が無ければ御中', () => {
        expect(applyEstimateCustomerToProject(project, '株式会社ABC建設', undefined).customerHonorific).toBe('御中');
    });

    it('見積書の顧客名が空なら案件の宛名をそのまま返す', () => {
        expect(applyEstimateCustomerToProject(project, undefined, undefined)).toBe(project);
        expect(applyEstimateCustomerToProject(project, '', '様')).toBe(project);
    });
});
