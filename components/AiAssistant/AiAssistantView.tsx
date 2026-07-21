'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Sparkles, Send, Mic, Square, Volume2, VolumeX } from 'lucide-react';
import toast from 'react-hot-toast';
import { logger } from '@/lib/logger';

// Web Speech API（ブラウザ音声入力）。lib.dom に型が無いため必要最小限を自前定義。
// iOS Safari / Android Chrome は webkit プレフィックス。非対応ブラウザではボタン自体を出さない。
interface SpeechRecognitionLike {
    lang: string;
    interimResults: boolean;
    continuous: boolean;
    onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
    onend: (() => void) | null;
    onerror: ((e: { error?: string }) => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as Record<string, unknown>;
    return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
}

// iOS では webkitSpeechRecognition が「存在するのに正常動作しない」（セッションが固まり
// タッチ入力まで塞ぐ・PWAでは権限プロンプトも出ない）事例があるため使わない。
// iPhone/iPad はキーボード標準の音声入力（🎤）が確実に動くのでそちらを案内する。
function detectIOS(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    const iPadOS = navigator.platform === 'MacIntel' && ((navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints ?? 0) > 1;
    return /iPhone|iPad|iPod/.test(ua) || iPadOS;
}

/** 聞き取り開始後、結果も終了イベントも来ないまま固まったら強制解除するまでの時間 */
const SPEECH_WATCHDOG_MS = 12000;

/** 自動読み上げ設定の保存キー */
const AUTO_SPEAK_STORAGE_KEY = 'dandolink:aiAssistant:autoSpeak';

/** 読み上げ用にテキストを整える（万一残った記号の除去・括弧の参考情報は読まない） */
function toSpeechText(text: string): string {
    return text
        .replace(/[*#`_~]/g, '')
        .replace(/（参考[^）]*）|\(参考[^)]*\)/g, '')
        .replace(/・/g, '。')
        .replace(/\n+/g, '。')
        .replace(/。{2,}/g, '。');
}

/**
 * AIが浮きメモを書いた後、カレンダーのメモ表示を追いつかせる。
 * カレンダーストア・broadcastは重いので、書き込みがあったときだけ動的importする。
 * 他端末へは broadcast（'cell_remark_updated'）で通知する（未接続なら相手側の
 * ポーリングで最大2分後に追いつく＝従来どおり）。
 */
async function syncFloatingMemos(dateKeys: string[]): Promise<void> {
    try {
        const [{ useCalendarStore }, { sendBroadcast }] = await Promise.all([
            import('@/stores/calendarStore'),
            import('@/lib/broadcastChannel'),
        ]);
        await useCalendarStore.getState().fetchCellRemarks();
        dateKeys.forEach((dateKey) => sendBroadcast('cell_remark_updated', { foremanId: 'unassigned', dateKey }));
    } catch (e) {
        logger.error('[AiAssistant] 浮きメモの反映に失敗', e);
    }
}

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

/**
 * メッセージ一覧（会話ログ＋ローディング表示）。
 * 入力欄のタイピングや音声認識の途中結果では再描画しないよう React.memo で分離。
 * 親の再レンダー（messages / isLoading / speakingIndex 等の変化）時のみ更新される。
 */
const MessageList = React.memo(function MessageList({
    messages,
    isLoading,
    speakSupported,
    speakingIndex,
    onSpeak,
}: {
    messages: ChatMessage[];
    isLoading: boolean;
    speakSupported: boolean;
    speakingIndex: number | null;
    onSpeak: (text: string, index: number) => void;
}) {
    return (
        <div className="space-y-3">
            {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                        className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm ${
                            m.role === 'user'
                                ? 'bg-teal-600 text-white rounded-br-md'
                                : 'bg-white border border-slate-200 text-slate-800 rounded-bl-md shadow-sm'
                        }`}
                    >
                        <div className="whitespace-pre-wrap break-words">{m.content}</div>
                        {m.role === 'assistant' && speakSupported && (
                            <button
                                type="button"
                                onClick={() => onSpeak(m.content, i)}
                                className={`mt-1.5 flex items-center gap-1 text-[11px] transition-colors ${
                                    speakingIndex === i ? 'text-teal-600 font-medium' : 'text-slate-400 hover:text-slate-600'
                                }`}
                                aria-label={speakingIndex === i ? '読み上げを停止' : '音声で聞く'}
                            >
                                {speakingIndex === i ? (
                                    <>
                                        <Square className="w-3 h-3" />
                                        停止
                                    </>
                                ) : (
                                    <>
                                        <Volume2 className="w-3 h-3" />
                                        音声で聞く
                                    </>
                                )}
                            </button>
                        )}
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
    );
});

/**
 * 入力欄（自動読み上げトグル・テキスト入力・音声入力・送信）。
 * input state と音声認識まわりを親から切り離し、タイピングや音声の途中結果で
 * 親（会話ログ）を再描画させないための子コンポーネント。
 */
function ChatInputBar({
    disabled,
    onSend,
    autoSpeak,
    speakSupported,
    onToggleAutoSpeak,
}: {
    disabled: boolean;
    onSend: (question: string) => void;
    autoSpeak: boolean;
    speakSupported: boolean;
    onToggleAutoSpeak: () => void;
}) {
    const [input, setInput] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    // 音声入力（対応ブラウザのみ・iOSは除外。SSRとの不一致を避けるためマウント後に判定）
    const [speechSupported, setSpeechSupported] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
    const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 認識を確実に終了させ UI を解放する（onend が来ない環境でも固まらないように）
    const stopListening = useCallback((mode: 'stop' | 'abort' = 'abort') => {
        if (watchdogRef.current) {
            clearTimeout(watchdogRef.current);
            watchdogRef.current = null;
        }
        const rec = recognitionRef.current;
        recognitionRef.current = null;
        if (rec) {
            rec.onresult = null;
            rec.onend = null;
            rec.onerror = null;
            try {
                if (mode === 'stop') rec.stop();
                else rec.abort();
            } catch {
                // すでに終了している等は無視
            }
        }
        setIsListening(false);
    }, []);

    useEffect(() => {
        setSpeechSupported(getSpeechRecognitionCtor() !== null && !detectIOS());
        // 画面を離れた/バックグラウンドに回ったら聞き取りを必ず解放（読み上げ停止は親側で対応）
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') {
                stopListening();
            }
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            stopListening();
        };
    }, [stopListening]);

    // 無反応のまま固まる環境対策: 一定時間 結果も終了も来なければ強制解除
    const armWatchdog = useCallback(() => {
        if (watchdogRef.current) clearTimeout(watchdogRef.current);
        watchdogRef.current = setTimeout(() => {
            stopListening();
            toast('音声を聞き取れませんでした。もう一度お試しください');
        }, SPEECH_WATCHDOG_MS);
    }, [stopListening]);

    const toggleVoiceInput = useCallback(() => {
        if (isListening) {
            stopListening('stop');
            return;
        }
        const Ctor = getSpeechRecognitionCtor();
        if (!Ctor) return;
        try {
            const rec = new Ctor();
            rec.lang = 'ja-JP';
            rec.interimResults = true; // 聞き取り途中の文字もリアルタイムで入力欄に流す
            rec.continuous = false;    // 発話が途切れたら自動で停止
            rec.onresult = (e) => {
                const transcript = Array.from({ length: e.results.length }, (_, i) => e.results[i]?.[0]?.transcript ?? '').join('');
                setInput(transcript);
                armWatchdog(); // 結果が流れている間は延命
            };
            rec.onend = () => stopListening();
            rec.onerror = (e) => {
                stopListening();
                if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                    toast.error('マイクの使用が許可されていません。ブラウザの設定を確認してください');
                } else if (e.error === 'no-speech') {
                    toast('音声が聞き取れませんでした。もう一度お試しください');
                } else if (e.error !== 'aborted') {
                    toast.error('音声入力でエラーが発生しました');
                }
            };
            recognitionRef.current = rec;
            setInput('');
            rec.start();
            setIsListening(true);
            armWatchdog();
        } catch (err) {
            logger.error('[AiAssistant] 音声入力の開始に失敗', err);
            stopListening();
            toast.error('この端末では音声入力を開始できませんでした');
        }
    }, [isListening, stopListening, armWatchdog]);

    const handleSend = useCallback(() => {
        const question = input.trim();
        if (!question || disabled) return;
        // 聞き取り中に送信されたら認識を止める（旧: 親 send 内にあった処理をここへ移動）
        stopListening();
        onSend(question);
        setInput('');
        inputRef.current?.focus();
    }, [input, disabled, stopListening, onSend]);

    return (
        <div className="flex-shrink-0 border-t border-slate-200 bg-white px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
            {speakSupported && (
                <div className="flex justify-end mb-1.5">
                    <button
                        type="button"
                        onClick={onToggleAutoSpeak}
                        className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                            autoSpeak
                                ? 'border-teal-300 bg-teal-50 text-teal-700'
                                : 'border-slate-200 text-slate-400 hover:text-slate-600'
                        }`}
                        aria-label="回答の自動読み上げを切り替え"
                    >
                        {autoSpeak ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                        自動読み上げ{autoSpeak ? 'ON' : 'OFF'}
                    </button>
                </div>
            )}
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    handleSend();
                }}
                className="flex gap-2"
            >
                <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={isListening ? '聞き取り中…話してください' : '例: 8月5日に解体1件（3人）入れたい'}
                    maxLength={500}
                    className={`flex-1 min-w-0 px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent ${
                        isListening ? 'border-red-300 ring-2 ring-red-200' : 'border-slate-300 focus:ring-teal-500'
                    }`}
                    disabled={disabled}
                />
                {speechSupported && (
                    <button
                        type="button"
                        onClick={toggleVoiceInput}
                        disabled={disabled}
                        className={`px-3 py-2.5 rounded-xl border transition-colors flex-shrink-0 disabled:opacity-40 ${
                            isListening
                                ? 'bg-red-500 border-red-500 text-white animate-pulse'
                                : 'border-slate-300 text-slate-500 hover:bg-slate-50'
                        }`}
                        aria-label={isListening ? '音声入力を停止' : '音声で入力'}
                        title={isListening ? '音声入力を停止' : '音声で入力'}
                    >
                        {isListening ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </button>
                )}
                <button
                    type="submit"
                    disabled={disabled || !input.trim()}
                    className="px-4 py-2.5 bg-teal-600 text-white rounded-xl hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                    aria-label="送信"
                >
                    <Send className="w-4 h-4" />
                </button>
            </form>
        </div>
    );
}

export default function AiAssistantView() {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    // 音声読み上げ（SpeechSynthesis。認識と違い iOS でも安定して動く）
    const [speakSupported, setSpeakSupported] = useState(false);
    const [autoSpeak, setAutoSpeak] = useState(false);
    const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);

    const stopSpeaking = useCallback(() => {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
        setSpeakingIndex(null);
    }, []);

    /** index 番目のメッセージを読み上げる。同じものをもう一度押すと停止 */
    const speak = useCallback((text: string, index: number) => {
        if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
        if (speakingIndex === index) {
            stopSpeaking();
            return;
        }
        const synth = window.speechSynthesis;
        synth.cancel();
        const utterance = new SpeechSynthesisUtterance(toSpeechText(text));
        utterance.lang = 'ja-JP';
        utterance.rate = 1.05;
        utterance.onend = () => setSpeakingIndex(null);
        utterance.onerror = () => setSpeakingIndex(null);
        setSpeakingIndex(index);
        synth.speak(utterance);
    }, [speakingIndex, stopSpeaking]);

    const toggleAutoSpeak = useCallback(() => {
        setAutoSpeak((prev) => {
            const next = !prev;
            try {
                localStorage.setItem(AUTO_SPEAK_STORAGE_KEY, next ? '1' : '0');
            } catch {
                // プライベートモード等で保存できなくても動作は継続
            }
            if (!next) stopSpeaking();
            return next;
        });
    }, [stopSpeaking]);

    useEffect(() => {
        setSpeakSupported(typeof window !== 'undefined' && 'speechSynthesis' in window);
        try {
            setAutoSpeak(localStorage.getItem(AUTO_SPEAK_STORAGE_KEY) === '1');
        } catch {
            // localStorage 不可なら既定OFFのまま
        }
        // 画面を離れた/バックグラウンドに回ったら読み上げを必ず停止（聞き取り停止は入力欄側で対応）
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') {
                stopSpeaking();
            }
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            stopSpeaking();
        };
    }, [stopSpeaking]);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages, isLoading]);

    const send = useCallback(async (text: string) => {
        const question = text.trim();
        if (!question || isLoading) return;

        // ※聞き取り中に送信されたら認識を止める処理は ChatInputBar 側へ移動済み

        const history = messages.slice(-10);
        setMessages((prev) => [...prev, { role: 'user', content: question }]);
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
            const answer = String(data.answer ?? '');
            setMessages((prev) => [...prev, { role: 'assistant', content: answer }]);
            // 浮きメモを書いたらカレンダー側へ即時反映（この端末＝ストア再取得／他端末＝broadcast）。
            // カレンダーは cellRemarksInitialized が立っていると再訪しても取り直さないため、
            // ここで明示的に取り直さないとリロードするまでメモが出ない。
            if (Array.isArray(data.memoDates) && data.memoDates.length > 0) {
                void syncFloatingMemos(data.memoDates as string[]);
            }
            // 自動読み上げON: 追加される応答の位置は「送信前の件数 + ユーザー発言1 + 応答」の末尾
            if (autoSpeak && answer) {
                speak(answer, messages.length + 1);
            }
        } catch (e) {
            logger.error('[AiAssistant] 照会に失敗', e);
            setMessages((prev) => [...prev, { role: 'assistant', content: 'エラーが発生しました。時間をおいてもう一度お試しください。' }]);
        } finally {
            setIsLoading(false);
        }
    }, [messages, isLoading, autoSpeak, speak]);

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
                    <MessageList
                        messages={messages}
                        isLoading={isLoading}
                        speakSupported={speakSupported}
                        speakingIndex={speakingIndex}
                        onSpeak={speak}
                    />
                )}
            </div>

            {/* 入力欄 */}
            <ChatInputBar
                disabled={isLoading}
                onSend={send}
                autoSpeak={autoSpeak}
                speakSupported={speakSupported}
                onToggleAutoSpeak={toggleAutoSpeak}
            />
        </div>
    );
}
