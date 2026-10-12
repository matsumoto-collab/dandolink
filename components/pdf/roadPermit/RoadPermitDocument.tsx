'use client';

/**
 * 道路申請の PDF（Document）。選んだ様式（formIds）の順に 1 ページずつ入れる。
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
    // 図面のページは Phase 2a の PDF 担当が DrawingPage として足す（今はまだ入れない）
    void drawing;
    void includeDrawing;
    return (
        <Document title="道路申請">
            {formIds.map((id) => {
                const FormPage = PAGE_BY_FORM[id];
                return <FormPage key={id} values={values} />;
            })}
        </Document>
    );
}
