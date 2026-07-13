// DXF の 3DFACE エンティティを抽出して、3Dビューア用の軽量ペイロードを作る。
// 足場CADが書き出すパース図DXF（R10世代・3DFACEの集合）を対象にした純ロジックで、
// ブラウザ（アップロード時のクライアント変換）とサーバー/テストの両方で動く。
// 2D図面のDXF（LINE等のみ）には 3DFACE が無いため null を返す（呼び出し側で通常ファイルとして保存）。

export interface Scaffold3DLayer {
    name: string;
    tris: number; // 三角形数
    b64: string; // Float32Array（三角形頂点 x,y,z × 3頂点）を base64 化したもの。モデル中心が原点になるよう平行移動済み
}

export interface Scaffold3DPayload {
    version: 1;
    unit: 'mm'; // 足場CADのDXFは mm 想定（表示にしか使わないため厳密でなくてよい）
    size: [number, number, number]; // バウンディングボックスの寸法（元の図面単位）
    triangleCount: number;
    layers: Scaffold3DLayer[];
}

// 和製CADのDXFはレイヤー名等が Shift_JIS のことが多い。失敗したら UTF-8 で読む。
// （座標・グループコードは ASCII なので、どちらで読んでも幾何データは壊れない）
export function decodeDxfArrayBuffer(buf: ArrayBuffer): string {
    try {
        return new TextDecoder('shift_jis', { fatal: false }).decode(buf);
    } catch {
        // shift_jis 非対応環境（ICU無しのNode等）は UTF-8 で読む
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

// ブラウザ/Node 両対応の base64 エンコード
function toBase64(bytes: Uint8Array): string {
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength).toString('base64');
    }
    let bin = '';
    const CHUNK = 0x8000; // String.fromCharCode の引数上限対策
    for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
}

type Vec3 = [number, number, number];

interface Face {
    layer: string;
    tris: Vec3[][];
}

/**
 * DXFテキストから 3DFACE を抽出し、ビューア用ペイロードを組み立てる。
 * 3DFACE が1枚も無ければ null（= 3Dデータの無いDXF）。
 */
export function buildScaffold3DPayload(text: string): Scaffold3DPayload | null {
    const lines = text.split(/\r\n|\n|\r/);

    // DXFは (グループコード行, 値行) の繰り返し。ENTITIES セクション内の 3DFACE だけ拾う
    let inEntities = false;
    let current: { layer: string; pts: Record<number, number> } | null = null;
    const faces: Face[] = [];

    const flush = () => {
        if (!current) return;
        const p = current.pts;
        const need = [10, 20, 30, 11, 21, 31, 12, 22, 32];
        if (need.every((c) => Number.isFinite(p[c]))) {
            const v0: Vec3 = [p[10], p[20], p[30]];
            const v1: Vec3 = [p[11], p[21], p[31]];
            const v2: Vec3 = [p[12], p[22], p[32]];
            const hasV3 = [13, 23, 33].every((c) => Number.isFinite(p[c]));
            const v3: Vec3 | null = hasV3 ? [p[13], p[23], p[33]] : null;
            const tris: Vec3[][] = [[v0, v1, v2]];
            // 4隅目が3隅目と異なる場合のみ四角形（三角形2枚に分割）
            if (v3 && !(v3[0] === v2[0] && v3[1] === v2[1] && v3[2] === v2[2])) {
                tris.push([v0, v2, v3]);
            }
            faces.push({ layer: current.layer || '0', tris });
        }
        current = null;
    };

    for (let i = 0; i + 1 < lines.length; i += 2) {
        const code = parseInt(lines[i], 10);
        const value = lines[i + 1];
        if (Number.isNaN(code)) continue;

        if (code === 0) {
            flush();
            if (value === 'ENDSEC') inEntities = false;
            else if (inEntities && value === '3DFACE') current = { layer: '0', pts: {} };
            continue;
        }
        if (code === 2 && value === 'ENTITIES') {
            inEntities = true;
            continue;
        }
        if (!current) continue;
        if (code === 8) current.layer = value.trim() || '0';
        else if (code >= 10 && code <= 33) {
            const n = parseFloat(value);
            if (Number.isFinite(n)) current.pts[code] = n;
        }
    }
    flush();

    if (faces.length === 0) return null;

    // レイヤーごとに三角形頂点を集約しつつ、全体のバウンディングボックスを取る
    const layerArrays = new Map<string, number[]>();
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const f of faces) {
        let arr = layerArrays.get(f.layer);
        if (!arr) {
            arr = [];
            layerArrays.set(f.layer, arr);
        }
        for (const tri of f.tris) {
            for (const v of tri) {
                arr.push(v[0], v[1], v[2]);
                for (let a = 0; a < 3; a++) {
                    if (v[a] < min[a]) min[a] = v[a];
                    if (v[a] > max[a]) max[a] = v[a];
                }
            }
        }
    }
    const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const size: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];

    // 座標値が大きい（原点から遠い）と描画時に精度が落ちるため、中心を原点へ平行移動して格納
    let triangleCount = 0;
    const layers: Scaffold3DLayer[] = [];
    for (const [name, arr] of layerArrays) {
        const f32 = new Float32Array(arr.length);
        for (let i = 0; i < arr.length; i += 3) {
            f32[i] = arr[i] - center[0];
            f32[i + 1] = arr[i + 1] - center[1];
            f32[i + 2] = arr[i + 2] - center[2];
        }
        const tris = arr.length / 9;
        triangleCount += tris;
        layers.push({ name, tris, b64: toBase64(new Uint8Array(f32.buffer)) });
    }
    // 大きいレイヤー（＝主要部材）から順に
    layers.sort((a, b) => b.tris - a.tris);

    return { version: 1, unit: 'mm', size, triangleCount, layers };
}
