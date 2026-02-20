'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

/**
 * アプリケーション全体のエラーをキャッチするError Boundary
 * Providerやコンポーネントでエラーが発生した場合にフォールバックUIを表示
 */
class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        // エラーログをコンソールに出力（本番環境ではログ収集サービスに送信推奨）
        console.error('ErrorBoundary caught an error:', error, errorInfo);
    }

    handleReload = (): void => {
        window.location.reload();
    };

    handleGoHome = (): void => {
        window.location.href = '/';
    };

    render(): ReactNode {
        if (this.state.hasError) {
            // カスタムフォールバックが提供されている場合はそれを使用
            if (this.props.fallback) {
                return this.props.fallback;
            }

            // デフォルトのエラーUI
            return (
                <div className="min-h-screen flex items-center justify-center bg-gray-100">
                    <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8 text-center">
                        <div className="mb-6">
                            <svg
                                className="mx-auto h-16 w-16 text-slate-500"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                aria-hidden="true"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                                />
                            </svg>
                        </div>
                        <h1 className="text-2xl font-bold text-gray-900 mb-4">
                            エラーが発生しました
                        </h1>
                        <p className="text-gray-600 mb-6">
                            申し訳ございません。予期せぬエラーが発生しました。
                            <br />
                            ページを再読み込みするか、ホームに戻ってください。
                        </p>
                        {process.env.NODE_ENV === 'development' && this.state.error && (
                            <details className="mb-6 text-left">
                                <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
                                    エラー詳細（開発環境のみ）
                                </summary>
                                <pre className="mt-2 p-3 bg-gray-100 rounded text-xs text-slate-600 overflow-auto max-h-40">
                                    {this.state.error.message}
                                    {'\n'}
                                    {this.state.error.stack}
                                </pre>
                            </details>
                        )}
                        <div className="flex gap-4 justify-center">
                            <button
                                onClick={this.handleReload}
                                className="px-4 py-2 bg-slate-800 text-white rounded-md hover:bg-slate-700 transition-colors"
                            >
                                再読み込み
                            </button>
                            <button
                                onClick={this.handleGoHome}
                                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition-colors"
                            >
                                ホームに戻る
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
