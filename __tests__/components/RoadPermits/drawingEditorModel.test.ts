/**
 * 作図画面の状態と操作（reducer）のテスト。konva を使わない純粋関数だけを確かめる。
 */
import {
    editorReducer,
    initialEditorState,
    previewEntities,
    screenToReal,
    realToScreen,
    titleBlockDefaults,
    type EditorAction,
    type EditorState,
} from '@/components/RoadPermits/Drawing/editorModel';
import { emptyRoadPermitDrawing } from '@/lib/roadPermit/drawing/defaults';
import type { DrawingEntity, LineEntity } from '@/types/roadPermitDrawing';

const TOL = 50;

function run(s: EditorState, ...actions: EditorAction[]): EditorState {
    return actions.reduce(editorReducer, s);
}
const pt = (x: number, y: number, extra: Partial<Extract<EditorAction, { type: 'point' }>> = {}): EditorAction => ({
    type: 'point',
    p: { x, y },
    tolMm: TOL,
    ...extra,
});
const start = () => initialEditorState(emptyRoadPermitDrawing());
const lineOf = (e: DrawingEntity): LineEntity => {
    if (e.kind !== 'line') throw new Error('line ではない');
    return e;
};

describe('作図画面の reducer', () => {
    it('線: 2 点で 1 本足す', () => {
        const s = run(start(), { type: 'command', command: 'line' }, pt(0, 0), pt(1000, 500));
        expect(s.drawing.entities).toHaveLength(1);
        const l = lineOf(s.drawing.entities[0]);
        expect(l.a).toEqual({ x: 0, y: 0 });
        expect(l.b).toEqual({ x: 1000, y: 500 });
        expect(l.layer).toBe(s.drawing.currentLayer);
        expect(s.pts).toEqual([]);
        expect(s.past).toHaveLength(1);
    });

    it('線: Shift で水平に固定する', () => {
        const s = run(start(), { type: 'command', command: 'line' }, pt(0, 0), pt(1000, 200, { shift: true }));
        expect(lineOf(s.drawing.entities[0]).b).toEqual({ x: 1000, y: 0 });
        const v = run(start(), { type: 'command', command: 'line' }, pt(0, 0), pt(100, 900, { shift: true }));
        expect(lineOf(v.drawing.entities[0]).b).toEqual({ x: 0, y: 900 });
    });

    it('線: 長さと角度を入れて Enter（数値確定）で終点が決まる', () => {
        const s = run(
            start(),
            { type: 'command', command: 'line' },
            pt(100, 100),
            { type: 'setSettings', patch: { length: '2,000', angle: '90' } },
            { type: 'numeric' },
        );
        const l = lineOf(s.drawing.entities[0]);
        expect(l.b.x).toBeCloseTo(100);
        expect(l.b.y).toBeCloseTo(2100);
    });

    it('線: 長さを入れておくとクリックした向きにその長さで引く', () => {
        const s = run(start(), { type: 'command', command: 'line' }, { type: 'setSettings', patch: { length: '500' } }, pt(0, 0), pt(3000, 0));
        expect(lineOf(s.drawing.entities[0]).b.x).toBeCloseTo(500);
    });

    it('Esc で描きかけを中止する（図形は増えない）', () => {
        const s = run(start(), { type: 'command', command: 'line' }, pt(0, 0), { type: 'esc' });
        expect(s.pts).toEqual([]);
        expect(s.drawing.entities).toHaveLength(0);
        expect(previewEntities({ ...s, cursor: { x: 10, y: 10 } })).toEqual([]);
    });

    it('戻る・進む', () => {
        let s = run(start(), { type: 'command', command: 'line' }, pt(0, 0), pt(100, 0), pt(0, 100), pt(100, 100));
        expect(s.drawing.entities).toHaveLength(2);
        s = run(s, { type: 'undo' });
        expect(s.drawing.entities).toHaveLength(1);
        s = run(s, { type: 'undo' });
        expect(s.drawing.entities).toHaveLength(0);
        s = run(s, { type: 'undo' });
        expect(s.drawing.entities).toHaveLength(0);
        s = run(s, { type: 'redo' }, { type: 'redo' });
        expect(s.drawing.entities).toHaveLength(2);
        // 戻ってから新しく描くと、進むは消える
        s = run(s, { type: 'undo' }, pt(500, 500), pt(600, 600));
        expect(s.future).toHaveLength(0);
        expect(s.drawing.entities).toHaveLength(2);
    });

    it('履歴は 50 回まで', () => {
        let s = run(start(), { type: 'command', command: 'line' });
        for (let i = 0; i < 60; i++) s = run(s, pt(0, i * 10), pt(100, i * 10));
        expect(s.past).toHaveLength(50);
    });

    it('範囲選択 → 消去', () => {
        let s = run(start(), { type: 'command', command: 'line' }, pt(0, 0), pt(100, 0), pt(5000, 5000), pt(6000, 5000));
        s = run(s, { type: 'command', command: 'select' }, { type: 'rectSelect', rect: { minX: -10, minY: -10, maxX: 200, maxY: 10 } });
        expect(s.selection).toHaveLength(1);
        s = run(s, { type: 'command', command: 'erase' });
        expect(s.drawing.entities).toHaveLength(1);
        expect(lineOf(s.drawing.entities[0]).a).toEqual({ x: 5000, y: 5000 });
        expect(s.selection).toEqual([]);
    });

    it('移動（選ぶ → 基点 → 移動先）', () => {
        let s = run(start(), { type: 'command', command: 'line' }, pt(0, 0), pt(100, 0));
        s = run(s, { type: 'command', command: 'select' }, pt(50, 0));
        expect(s.selection).toHaveLength(1);
        s = run(s, { type: 'command', command: 'move' });
        expect(s.phase).toBe('points');
        s = run(s, pt(0, 0), pt(1000, 2000));
        expect(s.drawing.entities).toHaveLength(1);
        expect(lineOf(s.drawing.entities[0]).a).toEqual({ x: 1000, y: 2000 });
        expect(lineOf(s.drawing.entities[0]).b).toEqual({ x: 1100, y: 2000 });
    });

    it('複写（元は残り、写しは別の id）', () => {
        let s = run(start(), { type: 'command', command: 'line' }, pt(0, 0), pt(100, 0));
        // 選んでいない状態で複写を押す → クリックで選んで Enter → 基点 → 複写先
        s = run(s, { type: 'command', command: 'copy' });
        expect(s.phase).toBe('select');
        s = run(s, pt(50, 0), { type: 'finish' }, pt(0, 0), pt(0, 1000));
        expect(s.drawing.entities).toHaveLength(2);
        const [a, b] = s.drawing.entities.map(lineOf);
        expect(a.a).toEqual({ x: 0, y: 0 });
        expect(b.a).toEqual({ x: 0, y: 1000 });
        expect(a.id).not.toBe(b.id);
    });

    it('ロックしたレイヤの図形は選べない', () => {
        let s = run(start(), { type: 'command', command: 'line' }, pt(0, 0), pt(100, 0));
        const layer = s.drawing.entities[0].layer;
        s = run(s, { type: 'setLayer', id: layer, patch: { locked: true } }, { type: 'command', command: 'select' }, pt(50, 0));
        expect(s.selection).toEqual([]);
        s = run(s, { type: 'rectSelect', rect: { minX: -10, minY: -10, maxX: 200, maxY: 10 } });
        expect(s.selection).toEqual([]);
        // 消去でも消えない
        s = run(s, { type: 'command', command: 'erase' }, pt(50, 0));
        expect(s.drawing.entities).toHaveLength(1);
    });

    it('縮尺を変えても図形の実寸は変わらない（用紙の真ん中も同じ位置のまま）', () => {
        let s = run(start(), { type: 'command', command: 'line' }, pt(0, 0), pt(12345, 0));
        const before = s.drawing.entities;
        const view = { pxPerMm: 2, panX: 0, panY: 0 };
        const centerBefore = screenToReal(s.drawing, view, (420 / 2) * 2, (297 / 2) * 2);
        s = run(s, { type: 'setScale', scale: 200 });
        expect(s.drawing.entities).toBe(before);
        expect(s.drawing.scale).toBe(200);
        const centerAfter = screenToReal(s.drawing, view, (420 / 2) * 2, (297 / 2) * 2);
        expect(centerAfter.x).toBeCloseTo(centerBefore.x);
        expect(centerAfter.y).toBeCloseTo(centerBefore.y);
        // 縮尺の変更は戻るの対象にしない
        expect(s.past).toHaveLength(1);
    });

    it('画面 px と実寸の行き来', () => {
        const s = start();
        const view = { pxPerMm: 3, panX: 10, panY: 20 };
        const p = { x: 4321, y: 1234 };
        const q = screenToReal(s.drawing, view, realToScreen(s.drawing, view, p).x, realToScreen(s.drawing, view, p).y);
        expect(q.x).toBeCloseTo(p.x);
        expect(q.y).toBeCloseTo(p.y);
    });

    it('2線: 幅の半分ずつ両側に 2 本', () => {
        const s = run(start(), { type: 'setSettings', patch: { doubleWidth: '6000' } }, { type: 'command', command: 'double' }, pt(0, 0), pt(10000, 0));
        const ys = s.drawing.entities.map((e) => lineOf(e).a.y).sort((a, b) => a - b);
        expect(ys).toEqual([-3000, 3000]);
        expect(s.past).toHaveLength(1);
    });

    it('寸法（水平）: 2 点＋寸法線の位置', () => {
        const s = run(start(), { type: 'setSettings', patch: { dimMode: 'horizontal' } }, { type: 'command', command: 'dimension' }, pt(0, 0), pt(11100, 0), pt(5000, 800));
        const d = s.drawing.entities[0];
        expect(d.kind).toBe('dimension');
        if (d.kind === 'dimension') {
            expect(d.mode).toBe('horizontal');
            expect(d.offsetMm).toBe(800);
        }
    });

    it('寸法（連続）: 点を続けて 1 本の寸法線に並べ、Esc で終わる', () => {
        const s = run(
            start(),
            { type: 'setSettings', patch: { dimMode: 'chain' } },
            { type: 'command', command: 'dimension' },
            pt(0, 0),
            pt(1000, 0),
            pt(500, 500),
            pt(2500, 100),
            pt(4000, 0),
            { type: 'esc' },
        );
        const dims = s.drawing.entities.filter((e) => e.kind === 'dimension');
        expect(dims).toHaveLength(3);
        // 寸法線の高さがそろう（y = 500）
        for (const d of dims) if (d.kind === 'dimension') expect(Math.max(d.a.y, d.b.y) + d.offsetMm).toBe(500);
        expect(s.chain).toBeNull();
    });

    it('文字: 位置 → ポップアップで入れる', () => {
        let s = run(start(), { type: 'command', command: 'text' }, pt(100, 200));
        expect(s.prompt?.kind).toBe('text');
        s = run(s, { type: 'promptSubmit', text: '市道 新屋敷線' });
        const t = s.drawing.entities[0];
        expect(t.kind === 'text' && t.text).toBe('市道 新屋敷線');
        expect(s.prompt).toBeNull();
    });

    it('ハッチ: 矩形の中をクリックするとその形で塗る', () => {
        let s = run(start(), { type: 'command', command: 'rect' }, pt(0, 0), pt(1000, 1000));
        s = run(s, { type: 'command', command: 'hatch' }, pt(500, 500));
        expect(s.drawing.entities).toHaveLength(2);
        const h = s.drawing.entities[1];
        expect(h.kind === 'hatch' && h.points).toHaveLength(4);
    });

    it('測る: 距離と面積はステータスの文に出す（図形は増えない）', () => {
        let s = run(start(), { type: 'command', command: 'measureDistance' }, pt(0, 0), pt(3000, 4000));
        expect(s.message).toContain('5.000 m');
        s = run(s, { type: 'command', command: 'measureArea' }, pt(0, 0), pt(11100, 0), pt(11100, 810), pt(0, 810), { type: 'esc' });
        expect(s.message).toContain('8.991');
        expect(s.drawing.entities).toHaveLength(0);
    });

    it('表題欄の既定は申請の入力値から', () => {
        expect(titleBlockDefaults(null).drawingName).toBe('保安施設配置図（平面図）');
    });
});
