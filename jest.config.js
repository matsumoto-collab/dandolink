const nextJest = require('next/jest');

const createJestConfig = nextJest({
    // Next.jsアプリのルートディレクトリ
    dir: './',
});

/** @type {import('jest').Config} */
const config = {
    // テスト環境
    testEnvironment: 'jsdom',

    // セットアップファイル
    setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],

    // テストファイルのパターン
    testMatch: [
        '**/__tests__/**/*.(test|spec).(ts|tsx|js|jsx)',
    ],

    // 除外パターン
    testPathIgnorePatterns: [
        '<rootDir>/node_modules/',
        '<rootDir>/.next/',
        '<rootDir>/e2e/',
    ],

    // モジュール名マッピング（@/エイリアス対応）
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/$1',
    },

    // カバレッジ設定
    collectCoverageFrom: [
        'app/**/*.{ts,tsx}',
        'components/**/*.{ts,tsx}',
        'contexts/**/*.{ts,tsx}',
        'hooks/**/*.{ts,tsx}',
        'utils/**/*.{ts,tsx}',
        'lib/**/*.{ts,tsx}',
        'stores/**/*.{ts,tsx}',
        '!**/*.d.ts',
        '!**/node_modules/**',
    ],
};

module.exports = createJestConfig(config);
