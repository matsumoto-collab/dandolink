'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Sparkles, Send } from 'lucide-react';
import { logger } from '@/lib/logger';

/**
 * スケジュールAI照会（設計書 §6）。
 *
 * 「◯月◯日に解体1件（3人）入れたい。空けられそうなところは？」のような質問に、
 * 班別の空き・仮予定（調整候補）・浮きを答える社内アシスタント。
 * 数字は全てサーバーのDB集計（lib/crewAvailability.ts）で、AIは言葉の解釈と文章化のみ。
 * AIは「空けられます」と断言せず、調整候補と聞くべき担当者の提示までを行う。
 */

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

const QUICK_QUESTIONS = [
    '今日の空き状況は？',
    '明日、空いている班はある？',
    '今浮いている現場はある？',
];

export default function AiAssistantView() {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages, isLoading]);

    const send = useCallback(async (text: string) => {
        const question = text.trim();
        if (!question || isLoading) return;

        const history = messages.slice(-10);
        setMessages((prev) => [...prev, { role: 'user', content: question }]);
        setInput('');
        setIsLoading(true);
        try {
            const res = await fetch('/api/ai/availability', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question, history }),
            });
            if (res.status === 429) {
                setMessages((prev) => [...prev, { role: 'assistant', content: '質問が集中しています。少し待ってからもう一度お試しください。' }]);
                return;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setMessages((prev) => [...prev, { role: 'assistant', content: String(data.answer ?? '') }]);
        } catch (e) {
            logger.error('[AiAssistant] 照会に失敗', e);
            setMessages((prev) => [...prev, { role: 'assistant', content: 'エラーが発生しました。時間をおいてもう一度お試しください。' }]);
        } finally {
            setIsLoading(false);
            inputRef.current?.focus();
        }
    }, [messages, isLoading]);

    return (
        <div className="h-full flex flex-col max-w-3xl mx-auto w-full">
            {/* メッセージ領域 */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
                {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center px-4">
                        <div className="w-12 h-12 rounded-2xl bg-teal-100 flex items-center justify-center mb-3">
                            <Sparkles className="w-6 h-6 text-teal-600" />
                        </div>
                        <h2 className="font-bold text-slate-800 mb-1">スケジュールAI照会</h2>
                        <p className="text-sm text-slate-500 mb-1 max-w-md">
                            班別の空き・仮予定（動かせるかもしれない予定）・浮いている現場を聞けます。
                        </p>
                        <p className="text-xs text-slate-400 mb-5 max-w-md">
                            ※数字はシステムの集計値です。仮予定を動かせるかどうかは担当者に確認してください。
                        </p>
                        <div className="flex flex-col gap-2 w-full max-w-sm">
                            {QUICK_QUESTIONS.map((q) => (
                                <button
                                    key={q}
                                    onClick={() => send(q)}
                                    className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-700 hover:border-teal-300 hover:bg-teal-50/50 transition-colors text-left"
                                >
                                    {q}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {messages.map((m, i) => (
                            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div
                                    className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap break-words ${
                                        m.role === 'user'
                                            ? 'bg-teal-600 text-white rounded-br-md'
                                            : 'bg-white border border-slate-200 text-slate-800 rounded-bl-md shadow-sm'
                                    }`}
                                >
                                    {m.content}
                                </div>
                            </div>
                        ))}
                        {isLoading && (
                            <div className="flex justify-start">
                                <div className="px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-white border border-slate-200 shadow-sm">
                                    <div className="flex gap-1">
                                        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* 入力欄 */}
            <div className="flex-shrink-0 border-t border-slate-200 bg-white px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        send(input);
                    }}
                    className="flex gap-2"
                >
                    <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="例: 8月5日に解体1件（3人）入れたい。空けられそうなところは？"
                        maxLength={500}
                        className="flex-1 px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                        disabled={isLoading}
                    />
                    <button
                        type="submit"
                        disabled={isLoading || !input.trim()}
                        className="px-4 py-2.5 bg-teal-600 text-white rounded-xl hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                        aria-label="送信"
                    >
                        <Send className="w-4 h-4" />
                    </button>
                </form>
            </div>
        </div>
    );
}
