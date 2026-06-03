import React from 'react';
import type { Style } from '@react-pdf/types';
import { Text } from './SafeText';
import { fitCellFontSize } from './styles';

type TextStyle = Style | Style[];

/**
 * セル内寸 `width` に1行で収まるよう、フォントサイズを自動縮小して描画する Text。
 *
 * - 既定サイズ（base）で収まる短い文字列はそのまま（拡大はしない）。
 * - 長い文字列は折り返さずに縮小（最小サイズでクランプ）。
 * - flex 列（備考など）は固定幅を持たないため、概算の内寸を `width` に渡す。
 *
 * 文字列・数値以外（空セル）は base のまま空文字を描画する。色・太字などは `style` で渡す。
 */
export function FitText({
    children,
    width,
    base,
    style,
    minFontSize,
}: {
    children?: string | number | null | false;
    width: number;
    base: number;
    style?: TextStyle;
    minFontSize?: number;
}) {
    const text = children == null || children === false ? '' : String(children);
    const fs = fitCellFontSize(text, width, base, minFontSize);
    const styleArr = Array.isArray(style) ? style : style ? [style] : [];
    return <Text style={[...styleArr, { fontSize: fs }]}>{text}</Text>;
}
