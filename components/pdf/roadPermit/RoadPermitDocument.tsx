'use client';

/**
 * 道路申請の PDF（Document）。選んだ様式（formIds）の順に 1 ページずつ入れる。
 *
 * 図面（Phase 2a）は includeDrawing が true で図形があるとき、最後に DrawingPage を 1 ページ足す。
 *
 * 様式 id → ページ部品の対応表（PAGE_BY_FORM）。様式を足すときは、ページ部品を 1 つ作ってここに 1 行足す
 * （様式のカタログは lib/roadPermit/forms/）。
 * 呼び出し元: utils/roadPermitPdf.tsx（ブラウザ）・scripts/verify-road-permit-pdf.tsx（検証）。
 */
import React from 'react';
import { Document } from '@react-pdf/renderer';
import type { RoadPermitFormId, RoadPermitValues } from '@/types/roadPermit';
import type { RoadPermitDrawing } from '@/types/roadPermitDrawing';
import { PoliceRoadUsePage } from './PoliceRoadUsePage';
import { MatsuyamaOccupancyApplyPage } from './MatsuyamaOccupancyApplyPage';
import { MatsuyamaOccupancyReplyPage } from './MatsuyamaOccupancyReplyPage';
import { DrawingPage } from './DrawingPage';
import { isDrawingEmpty } from '@/lib/roadPermit/drawing/defaults';

export interface RoadPermitDocumentProps {
    values: RoadPermitValues;
    formIds: RoadPermitFormId[];
    /** 図面（Phase 2）。includeDrawing が true で図形が 1 つ以上あれば最後のページに入れる */
    drawing?: RoadPermitDrawing | null;
    includeDrawing?: boolean;
}

type PageComponent = (props: { values: RoadPermitValues }) => React.ReactElement;

/** 様式 id → ページ部品 */
const PAGE_BY_FORM: Record<RoadPermitFormId, PageComponent> = {
    'police-road-use': PoliceRoadUsePage,
    'matsuyama-occupancy-apply': MatsuyamaOccupancyApplyPage,
    'matsuyama-occupancy-reply': MatsuyamaOccupancyReplyPage,
};

export function RoadPermitDocument({ values, formIds, drawing = null, includeDrawing = false }: RoadPermitDocumentProps) {
    // 図面（平面図）は申請書の後ろ＝最後のページ。「図面も入れる」が選ばれていて、図形が 1 つ以上あるときだけ
    const showDrawing = includeDrawing && drawing != null && !isDrawingEmpty(drawing);
    return (
        <Document title="道路申請">
            {formIds.map((id) => {
                const FormPage = PAGE_BY_FORM[id];
                return <FormPage key={id} values={values} />;
            })}
            {showDrawing && drawing && <DrawingPage drawing={drawing} values={values} />}
        </Document>
    );
}
