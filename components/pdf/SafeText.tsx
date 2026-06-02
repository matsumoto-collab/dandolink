import React from 'react';
import { Text as RpdfText } from '@react-pdf/renderer';
import { sanitizePdfText } from '@/components/pdf/styles';

/** 文字列の子のみ再帰的に正規化（要素・数値などはそのまま）。 */
function sanitize(node: React.ReactNode): React.ReactNode {
    if (typeof node === 'string') return sanitizePdfText(node);
    if (Array.isArray(node)) return node.map(sanitize);
    return node;
}

// react-pdf の Text props は (通常 Text | SVG Text) のユニオンで children の型操作が面倒なため、
// 委譲先のみ緩く型付けする。呼び出し側（<Text ...>）の型は本物の Text と同一に保つ。
const BaseText = RpdfText as unknown as React.ComponentType<{ children?: React.ReactNode }>;

/**
 * react-pdf の Text をラップし、PDF フォントに無いグリフ(全角チルダ ～ 等)を
 * 描画可能な等価字へ自動置換する。各 PDF コンポーネントは '@react-pdf/renderer' の
 * Text の代わりにこの Text を import して使う（既存の <Text> 記述はそのままでよい）。
 */
export function Text(props: React.ComponentProps<typeof RpdfText>) {
    const children = (props as { children?: React.ReactNode }).children;
    return <BaseText {...(props as object)}>{sanitize(children)}</BaseText>;
}
