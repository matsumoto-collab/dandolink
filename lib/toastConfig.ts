// react-hot-toast の表示時間。layout.tsx の <Toaster toastOptions> と
// components/ui/ToastWatchdog.tsx の強制クローズ期限の両方が参照する唯一のソース。
export const TOAST_DURATIONS = {
    default: 4000,
    success: 3000,
    error: 5000,
} as const;
