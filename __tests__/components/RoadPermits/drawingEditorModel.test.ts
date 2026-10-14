/**
 * 作図画面の状態と操作（reducer）のテスト。konva を使わない純粋関数だけを確かめる。
 */
import {
    editorReducer,
    initialEditorState,
    pickSymbolActions,
    previewEntities,
    screenToReal,
    realToScreen,
    titleBlockDefaults,
    type EditorAction,
    type EditorState,
} from '@/components/RoadPermits/Drawing/editorModel';
import { emptyRoadPermitDrawing } from '@/lib/roadPermit/drawing/defaults';
import type { DrawingEntity, LineEntity, OccupancyEntity, SymbolEntity } from '@/types/roadPermitDrawing';
import { occupancyMeasure } from '@/lib/roadPermit/drawing/occupancy';
import type { RoadPermitSymbolCategory, RoadPermitSymbolDto } from '@/types/roadPermitSymbol';
import { toSymbolMap } from '@/lib/roadPermit/symbols/normalize';

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

describe('作図画面の reducer: 記号（Phase 2b）', () => {
    const square = (half: number) => ({
        lines: [-half, -half, half, -half, half, -half, half, half, half, half, -half, half, -half, half, -half, -half],
        circles: [],
        arcs: [],
        polylines: [],
    });
    const symbol = (id: string, category: RoadPermitSymbolCategory, barPitchMm: number | null = null): RoadPermitSymbolDto => ({
        id,
        name: id,
        category,
        countLabel: '',
        countUnit: '',
        countNote: '',
        geometry: square(100),
        lengthMm: 200,
        widthMm: 200,
        barPitchMm,
        sourceFile: '',
        sourceBlock: '',
        sourceNote: '',
        sortOrder: 0,
        isActive: true,
        createdAt: '',
        updatedAt: '',
    });
    const cone = symbol('cone', 'cone');
    const bar = symbol('bar1500p', 'cone', 1403);
    const truck = symbol('truck', 'vehicle');
    const withSymbols = (list: RoadPermitSymbolDto[]) => run(start(), { type: 'setSymbols', symbols: toSymbolMap(list) });
    const symbolsOf = (s: EditorState): SymbolEntity[] => s.drawing.entities.filter((e): e is SymbolEntity => e.kind === 'symbol');

    it('パレット → 記号を 1 つずつ置く（レイヤは分類の初期値・角度・反転）。Esc まで続けて置ける', () => {
        let s = run(withSymbols([cone, bar, truck]), ...pickSymbolActions(truck));
        expect(s.command).toBe('symbol');
        expect(s.drawing.currentLayer).toBe(4);
        s = run(s, { type: 'setSettings', patch: { angle: '30', symbolMirrored: true } }, pt(1000, 2000));
        const [e] = symbolsOf(s);
        expect(e.symbolId).toBe('truck');
        expect(e.at).toEqual({ x: 1000, y: 2000 });
        expect(e.rotationDeg).toBe(30);
        expect(e.mirrored).toBe(true);
        expect(e.layer).toBe(4);
        // 続けて置ける・同じ所のダブルクリックで 2 つ重ならない
        s = run(s, pt(3000, 2000), pt(3000, 2000));
        expect(symbolsOf(s)).toHaveLength(2);
        // プレビューはカーソルの位置に記号
        const pv = previewEntities({ ...s, cursor: { x: 50, y: 60 } });
        expect(pv).toHaveLength(1);
        expect(pv[0].kind === 'symbol' && pv[0].at).toEqual({ x: 50, y: 60 });
        // Esc で置くのを終わる（範囲＝選ぶに戻る）
        s = run(s, { type: 'esc' });
        expect(s.command).toBe('select');
        // コーン類は 3 保安施設
        expect(run(withSymbols([cone]), ...pickSymbolActions(cone)).drawing.currentLayer).toBe(3);
    });

    it('記号を選んでいないときは置かない（案内の文）', () => {
        const s = run(withSymbols([cone]), { type: 'command', command: 'symbol' }, pt(0, 0));
        expect(s.drawing.entities).toHaveLength(0);
        expect(s.message).toContain('記号');
    });

    it('線に沿って等間隔: 2 点で並べ、向きは線の角度＋角度の欄。1 回の戻るで全部消える', () => {
        let s = run(
            withSymbols([cone]),
            ...pickSymbolActions(cone),
            { type: 'setSettings', patch: { symbolMode: 'array', arraySpacing: '2000', angle: '10' } },
            pt(0, 0),
            pt(0, 5000),
        );
        const list = symbolsOf(s);
        expect(list).toHaveLength(3);
        expect(list.map((e) => e.at.y)).toEqual([0, 2000, 4000]);
        list.forEach((e) => expect(e.rotationDeg).toBeCloseTo(100));
        expect(s.past).toHaveLength(1);
        s = run(s, { type: 'undo' });
        expect(s.drawing.entities).toHaveLength(0);
    });

    it('コーン列: 10,000mm・1500p（P=1,403）→ コーン 9・バー 8・間隔 1,250。1 回の戻るで全部消える', () => {
        let s = run(
            withSymbols([cone, bar, truck]),
            { type: 'setSettings', patch: { coneSymbolId: 'cone', coneBarSymbolId: 'bar1500p' } },
            { type: 'command', command: 'coneRow' },
            pt(0, 0),
            // ダブルクリック（同じ点の 2 回目は 1 点として扱う）→ 確定
            pt(10000, 0),
            pt(10000, 0),
        );
        expect(s.pts).toHaveLength(2);
        // 確定前のプレビュー: 折れ線＋コーン＋バー
        expect(previewEntities({ ...s, cursor: { x: 10000, y: 0 } }).length).toBe(1 + 9 + 8);
        s = run(s, { type: 'finish' });
        const all = symbolsOf(s);
        const cones = all.filter((e) => e.symbolId === 'cone').sort((a, b) => a.at.x - b.at.x);
        const bars = all.filter((e) => e.symbolId === 'bar1500p').sort((a, b) => a.at.x - b.at.x);
        expect(cones).toHaveLength(9);
        expect(bars).toHaveLength(8);
        expect(cones[1].at.x - cones[0].at.x).toBeCloseTo(1250);
        expect(bars[0].at.x).toBeCloseTo(625);
        expect(bars.every((b) => b.rotationDeg === 0)).toBe(true);
        expect(s.message).toContain('コーン 9 個・コーンバー 8 本');
        expect(s.past).toHaveLength(1);
        s = run(s, { type: 'undo' });
        expect(s.drawing.entities).toHaveLength(0);
    });

    it('コーン列: コーンバーが 1 つも登録されていなければ「コーンバーを登録してください」', () => {
        const s = run(withSymbols([cone]), { type: 'setSettings', patch: { coneSymbolId: 'cone' } }, { type: 'command', command: 'coneRow' }, pt(0, 0));
        expect(s.message).toContain('コーンバーを登録してください');
        expect(s.pts).toHaveLength(0);
    });

    it('コーン列: コーンかバーを選んでいなければ「コーンとコーンバーを選んでください」', () => {
        const s = run(withSymbols([cone, bar]), { type: 'setSettings', patch: { coneSymbolId: 'cone' } }, { type: 'command', command: 'coneRow' }, pt(0, 0));
        expect(s.message).toBe('コーンとコーンバーを選んでください');
    });

    it('記号の表を渡すと、記号の線をクリックして選べる', () => {
        let s = run(withSymbols([truck]), ...pickSymbolActions(truck), pt(0, 0), { type: 'command', command: 'select' });
        // 記号の右端の線（x=100）
        s = run(s, pt(100, 0, { tolMm: 5 }));
        expect(s.selection).toHaveLength(1);
    });
});

describe('作図画面の reducer: 占用範囲（Phase 2b）', () => {
    const occupancies = (s: EditorState) => s.drawing.entities.filter((e): e is OccupancyEntity => e.kind === 'occupancy');

    it('閉じた矩形をクリック → 輪郭を写して占用範囲を 1 つ足す（レイヤ 2・路線名はコントロールバーの欄）', () => {
        let s = run(start(), { type: 'command', command: 'rect' }, pt(0, 0), pt(11100, 810));
        expect(s.drawing.entities).toHaveLength(1);
        s = run(s, { type: 'command', command: 'occupancy' });
        expect(s.drawing.currentLayer).toBe(2);
        s = run(s, { type: 'setSettings', patch: { occupancyRoute: ' 市道 新屋敷線 ' } }, pt(5000, 400));
        const [o] = occupancies(s);
        expect(o.layer).toBe(2);
        expect(o.routeName).toBe('市道 新屋敷線');
        expect(o.points).toEqual([
            { x: 0, y: 0 },
            { x: 11100, y: 0 },
            { x: 11100, y: 810 },
            { x: 0, y: 810 },
        ]);
        expect(occupancyMeasure(o.points).expression).toBe('0.81×11.1＝8.991㎡');
        expect(o.labelAt).toBeNull();
        // 1 回の戻るで消える
        s = run(s, { type: 'undo' });
        expect(occupancies(s)).toHaveLength(0);
        expect(s.drawing.entities).toHaveLength(1);
    });

    it('点を順にクリックして Enter で閉じる（3 点未満は足さない）・始点をもう一度指示しても閉じる', () => {
        let s = run(start(), { type: 'command', command: 'occupancy' }, pt(0, 0), pt(10080, 0));
        s = run(s, { type: 'finish' });
        expect(occupancies(s)).toHaveLength(0);
        expect(s.message).toContain('3 点以上');

        s = run(s, pt(0, 0), pt(10080, 0), pt(3000, 1531));
        // プレビューは閉じた折れ線
        const pv = previewEntities({ ...s, cursor: { x: 0, y: 2000 } });
        expect(pv[0].kind === 'polyline' && pv[0].closed).toBe(true);
        s = run(s, { type: 'finish' });
        expect(occupancies(s)).toHaveLength(1);
        expect(occupancyMeasure(occupancies(s)[0].points).expression).toBe('1.531×10.08÷2＝7.71624㎡');
        expect(s.pts).toEqual([]);

        // 始点で閉じる（読取点で始点を指示）
        s = run(s, pt(20000, 0), pt(25000, 0), pt(25000, 1000), pt(20000, 0, { snapped: true }));
        expect(occupancies(s)).toHaveLength(2);
        expect(occupancies(s)[1].points).toHaveLength(3);
        // 1 回の戻るで 1 つずつ消える
        s = run(s, { type: 'undo' });
        expect(occupancies(s)).toHaveLength(1);
    });

    it('選んで Enter で路線名を直す（1 回の戻るで元に戻る）・属性でも直せる', () => {
        let s = run(start(), { type: 'command', command: 'occupancy' }, pt(0, 0), pt(11100, 0), pt(11100, 810), pt(0, 810), { type: 'finish' });
        const id = occupancies(s)[0].id;
        s = run(s, { type: 'command', command: 'select' }, { type: 'setSelection', ids: [id] }, { type: 'finish' });
        expect(s.prompt).toMatchObject({ kind: 'edit', entityId: id, initial: '' });
        s = run(s, { type: 'promptSubmit', text: '市道 新屋敷線' });
        expect(occupancies(s)[0].routeName).toBe('市道 新屋敷線');
        s = run(s, { type: 'undo' });
        expect(occupancies(s)[0].routeName).toBe('');
        s = run(s, { type: 'setSelection', ids: [id] }, { type: 'applyAttributes', patch: { routeName: '県道 1 号線' } });
        expect(occupancies(s)[0].routeName).toBe('県道 1 号線');
    });

    it('文字をドラッグで動かす: 位置が入り 1 回の戻るで元に戻る・まとまりの位置・自動に戻す', () => {
        let s = run(start(), { type: 'command', command: 'occupancy' }, pt(0, 0), pt(11100, 0), pt(11100, 810), pt(0, 810), { type: 'finish' });
        const id = occupancies(s)[0].id;
        s = run(s, { type: 'setOccupancyLabelAt', id, at: { x: 5000, y: 3000 } });
        expect(occupancies(s)[0].labelAt).toEqual({ x: 5000, y: 3000 });
        // 知らない id・占用範囲でない図形は何もしない
        expect(run(s, { type: 'setOccupancyLabelAt', id: 'nothing', at: { x: 1, y: 1 } })).toBe(s);
        s = run(s, { type: 'undo' });
        expect(occupancies(s)[0].labelAt).toBeNull();
        s = run(s, { type: 'redo' });
        expect(occupancies(s)[0].labelAt).toEqual({ x: 5000, y: 3000 });

        // 移動（move）で図形を動かすと文字の位置も一緒に動く
        s = run(s, { type: 'command', command: 'move' }, { type: 'setSelection', ids: [id] }, { type: 'finish' }, pt(0, 0), pt(100, 200));
        expect(occupancies(s)[0].points[0]).toEqual({ x: 100, y: 200 });
        expect(occupancies(s)[0].labelAt).toEqual({ x: 5100, y: 3200 });

        // まとまりの位置（戻るの対象にしない）
        s = run(s, { type: 'setOccupancyNoteAt', at: { x: -500, y: -900 } });
        expect(s.drawing.occupancyNoteAt).toEqual({ x: -500, y: -900 });
        // 全部自動に戻す
        s = run(s, { type: 'resetOccupancyLabels' });
        expect(occupancies(s)[0].labelAt).toBeNull();
        expect(s.drawing.occupancyNoteAt).toBeNull();
    });

    it('凡例の表示の切り替え', () => {
        const s = run(start(), { type: 'setDrawingFlags', patch: { showLegend: false } });
        expect(s.drawing.showLegend).toBe(false);
    });
});
