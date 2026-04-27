import type { Config } from "tailwindcss";

const config: Config = {
    content: [
        "./pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./components/**/*.{js,ts,jsx,tsx,mdx}",
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        // lg/xl/2xl に「16:10 以上のアスペクト比」を要求することで、
        // iPad 横向き（4:3 〜 1.5:1）はデスクトップ扱いせずモバイルレイアウトを維持する
        // （サイドバーや lg:left-48 等の "デスクトップ前提"スタイルが iPad 横で発火しなくなる）
        screens: {
            'sm': '640px',
            'md': '768px',
            'lg': { 'raw': '(min-width: 1024px) and (min-aspect-ratio: 16/10)' },
            'xl': { 'raw': '(min-width: 1280px) and (min-aspect-ratio: 16/10)' },
            '2xl': { 'raw': '(min-width: 1536px) and (min-aspect-ratio: 16/10)' },
        },
        extend: {
            fontFamily: {
                sans: ['var(--font-noto)', 'var(--font-inter)', 'system-ui', 'sans-serif'],
            },
            colors: {
                primary: {
                    50: '#f0fdfa',
                    100: '#ccfbf1',
                    200: '#99f6e4',
                    300: '#5eead4',
                    400: '#2dd4bf',
                    500: '#14b8a6',
                    600: '#0d9488',
                    700: '#0f766e',
                    800: '#115e59',
                    900: '#134e4a',
                },
            },
            animation: {
                'page-enter': 'page-enter 250ms ease-out',
            },
        },
    },
    plugins: [],
};
export default config;
