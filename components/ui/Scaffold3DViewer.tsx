'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, Loader2, RotateCcw } from 'lucide-react';
import type { Scaffold3DPayload } from '@/lib/dxf3d';

// パース図(DXF由来)の3Dビューア。lib/dxf3d.ts が生成したペイロードJSONを署名URLから取得して描画する。
// three.js はこのコンポーネントを dynamic import した時にだけ読み込まれる（バンドル分離）。
// 操作: ドラッグ/1本指=回転, ホイール/ピンチ=ズーム, 右ドラッグ/2本指=移動

interface Props {
    url: string; // ペイロードJSONの署名URL
    fileName: string;
    onClose: () => void;
}

// レイヤーの色（支払予定バッジ等と喧嘩しない落ち着いたパレット）
const PALETTE = ['#4f8ac9', '#e07b39', '#4caf7d', '#c94f6d', '#8a6fc9', '#c9b44f', '#4fc9c1', '#94a3b8', '#d98cb3', '#7d8f4c'];

interface LayerUi {
    name: string;
    color: string;
    tris: number;
    visible: boolean;
}

export function Scaffold3DViewer({ url, fileName, onClose }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const [layers, setLayers] = useState<LayerUi[]>([]);
    const [triangleCount, setTriangleCount] = useState(0);
    // three.js のメッシュ・カメラ操作へReactのUIから触るためのフック
    const apiRef = useRef<{ setVisible: (index: number, visible: boolean) => void; resetView: () => void } | null>(null);

    useEffect(() => {
        let disposed = false;
        let cleanup: (() => void) | null = null;

        (async () => {
            try {
                // three.js を遅延ロード（ビューアを開いた時だけ）
                const [THREE, { OrbitControls }, res] = await Promise.all([
                    import('three'),
                    import('three/examples/jsm/controls/OrbitControls.js'),
                    fetch(url, { cache: 'no-store' }),
                ]);
                if (!res.ok) throw new Error('payload fetch failed');
                const payload: Scaffold3DPayload = await res.json();
                if (disposed || !containerRef.current) return;

                const container = containerRef.current;
                const renderer = new THREE.WebGLRenderer({ antialias: true });
                renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
                container.appendChild(renderer.domElement);
                renderer.domElement.style.display = 'block';

                const scene = new THREE.Scene();
                scene.background = new THREE.Color(0xdbe4ee);

                // DXFはZが上 / three.jsはYが上 → X軸-90度回転で合わせる
                const root = new THREE.Group();
                root.rotation.x = -Math.PI / 2;
                scene.add(root);

                scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 2.2));
                const dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
                dirLight.position.set(1, 2, 1.5);
                scene.add(dirLight);

                const maxDim = Math.max(payload.size[0], payload.size[1], payload.size[2], 1);
                const camera = new THREE.PerspectiveCamera(50, 1, maxDim / 1000, maxDim * 20);
                const HOME = new THREE.Vector3(maxDim * 0.9, maxDim * 0.6, maxDim * 0.9);
                camera.position.copy(HOME);

                // 地面のグリッド（モデル底面の高さに敷く）
                const grid = new THREE.GridHelper(maxDim * 2.4, 24, 0x94a3b8, 0xc0cbd8);
                grid.position.y = -payload.size[2] / 2;
                scene.add(grid);

                const meshes: InstanceType<typeof THREE.Mesh>[] = [];
                const geometries: InstanceType<typeof THREE.BufferGeometry>[] = [];
                const materials: InstanceType<typeof THREE.MeshLambertMaterial>[] = [];
                payload.layers.forEach((l, i) => {
                    const bin = atob(l.b64);
                    const bytes = new Uint8Array(bin.length);
                    for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
                    const positions = new Float32Array(bytes.buffer);
                    const geo = new THREE.BufferGeometry();
                    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                    geo.computeVertexNormals();
                    // 3DFACEの向きは不定のため両面描画
                    const mat = new THREE.MeshLambertMaterial({ color: PALETTE[i % PALETTE.length], side: THREE.DoubleSide });
                    const mesh = new THREE.Mesh(geo, mat);
                    root.add(mesh);
                    meshes.push(mesh);
                    geometries.push(geo);
                    materials.push(mat);
                });

                const controls = new OrbitControls(camera, renderer.domElement);
                controls.enableDamping = true;

                apiRef.current = {
                    setVisible: (index, visible) => {
                        if (meshes[index]) meshes[index].visible = visible;
                    },
                    resetView: () => {
                        camera.position.copy(HOME);
                        controls.target.set(0, 0, 0);
                        controls.update();
                    },
                };

                const resize = () => {
                    const w = container.clientWidth;
                    const h = container.clientHeight;
                    if (w === 0 || h === 0) return;
                    renderer.setSize(w, h, false);
                    camera.aspect = w / h;
                    camera.updateProjectionMatrix();
                };
                const ro = new ResizeObserver(resize);
                ro.observe(container);
                resize();

                let raf = 0;
                const loop = () => {
                    raf = requestAnimationFrame(loop);
                    controls.update();
                    renderer.render(scene, camera);
                };
                loop();

                setLayers(
                    payload.layers.map((l, i) => ({
                        name: l.name,
                        color: PALETTE[i % PALETTE.length],
                        tris: l.tris,
                        visible: true,
                    })),
                );
                setTriangleCount(payload.triangleCount);
                setStatus('ready');

                cleanup = () => {
                    cancelAnimationFrame(raf);
                    ro.disconnect();
                    controls.dispose();
                    geometries.forEach((g) => g.dispose());
                    materials.forEach((m) => m.dispose());
                    renderer.dispose();
                    renderer.domElement.remove();
                    apiRef.current = null;
                };
                if (disposed) cleanup();
            } catch (e) {
                console.error('3D viewer error:', e);
                if (!disposed) setStatus('error');
            }
        })();

        return () => {
            disposed = true;
            cleanup?.();
        };
    }, [url]);

    const toggleLayer = (index: number) => {
        setLayers((prev) => {
            const next = prev.map((l, i) => (i === index ? { ...l, visible: !l.visible } : l));
            apiRef.current?.setVisible(index, next[index].visible);
            return next;
        });
    };

    return (
        <div className="fixed inset-0 z-[70] bg-slate-900 flex flex-col">
            {/* ヘッダー */}
            <div className="shrink-0 flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 bg-slate-800 text-white">
                <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{fileName}</div>
                    <div className="text-[11px] text-slate-400">
                        3Dパース {triangleCount > 0 && `・三角形 ${triangleCount.toLocaleString()}枚`}
                    </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    <button
                        type="button"
                        onClick={() => apiRef.current?.resetView()}
                        className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10"
                        title="視点をリセット"
                    >
                        <RotateCcw className="w-5 h-5" />
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 min-w-[44px] min-h-[44px] flex items-center justify-center"
                        aria-label="閉じる"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>
            </div>

            {/* 3Dキャンバス */}
            <div ref={containerRef} className="flex-1 min-h-0 relative [&>canvas]:w-full [&>canvas]:h-full [&>canvas]:touch-none">
                {status === 'loading' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-300">
                        <Loader2 className="w-8 h-8 animate-spin" />
                        <span className="text-sm">3Dデータを読み込み中…</span>
                    </div>
                )}
                {status === 'error' && (
                    <div className="absolute inset-0 flex items-center justify-center text-slate-300 text-sm px-6 text-center">
                        3Dデータの読み込みに失敗しました。閉じてもう一度開くか、時間をおいて再度お試しください。
                    </div>
                )}
            </div>

            {/* フッター: 操作ヒント + レイヤー凡例（タップで表示/非表示） */}
            {status === 'ready' && (
                <div className="shrink-0 bg-slate-800/95 text-slate-200 px-3 sm:px-4 py-2 space-y-1.5">
                    <div className="text-[11px] text-slate-400">
                        ドラッグ/1本指=回転 ・ ホイール/ピンチ=ズーム ・ 右ドラッグ/2本指=移動 ・ 凡例タップで部材の表示切替
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 max-h-20 overflow-y-auto">
                        {layers.map((l, i) => (
                            <button
                                key={i}
                                type="button"
                                onClick={() => toggleLayer(i)}
                                className={`inline-flex items-center gap-1.5 text-xs py-0.5 ${l.visible ? '' : 'opacity-40 line-through'}`}
                            >
                                <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: l.color }} />
                                <span className="truncate max-w-[10rem]">{l.name}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
