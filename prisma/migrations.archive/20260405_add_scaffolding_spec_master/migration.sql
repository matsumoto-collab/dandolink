-- CreateTable
CREATE TABLE "public"."ScaffoldingSpecGroup" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScaffoldingSpecGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ScaffoldingSpecItem" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'toggle',
    "options" JSONB,
    "legacyKey" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScaffoldingSpecItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScaffoldingSpecGroup_sortOrder_idx" ON "public"."ScaffoldingSpecGroup"("sortOrder");

-- CreateIndex
CREATE INDEX "ScaffoldingSpecItem_groupId_idx" ON "public"."ScaffoldingSpecItem"("groupId");

-- CreateIndex
CREATE INDEX "ScaffoldingSpecItem_sortOrder_idx" ON "public"."ScaffoldingSpecItem"("sortOrder");

-- AddForeignKey
ALTER TABLE "public"."ScaffoldingSpecItem" ADD CONSTRAINT "ScaffoldingSpecItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "public"."ScaffoldingSpecGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: 3 default groups
INSERT INTO "public"."ScaffoldingSpecGroup" ("id", "name", "sortOrder") VALUES
    ('ssg_structure', '足場構造・手摺', 0),
    ('ssg_sheet_access', 'シート・昇降設備', 1),
    ('ssg_safety', '安全・養生オプション', 2);

-- Seed: 20 default items with legacyKey for backward compatibility
INSERT INTO "public"."ScaffoldingSpecItem" ("id", "groupId", "name", "type", "options", "legacyKey", "sortOrder") VALUES
    ('ssi_singleSideScaffold',      'ssg_structure',    '一側足場',       'toggle',  NULL,                          'singleSideScaffold',     0),
    ('ssi_mainScaffold',            'ssg_structure',    '本足場',         'toggle',  NULL,                          'mainScaffold',           1),
    ('ssi_outerHandrail',           'ssg_structure',    '外手摺',         'segment', '["1本","2本"]'::jsonb,        'outerHandrail',          2),
    ('ssi_innerHandrail',           'ssg_structure',    '内手摺',         'text',    NULL,                          'innerHandrail',          3),
    ('ssi_fallPreventionHandrail',  'ssg_structure',    '落下防止手摺',   'segment', '["1本","2本","3本"]'::jsonb,  'fallPreventionHandrail', 4),
    ('ssi_baseboard',               'ssg_structure',    '巾木',           'segment', '["L型","木"]'::jsonb,         'baseboard',              5),
    ('ssi_narrowNet',               'ssg_structure',    '小幅ネット',     'toggle',  NULL,                          'narrowNet',              6),
    ('ssi_wallTie',                 'ssg_structure',    '壁つなぎ',       'text',    NULL,                          'wallTie',                7),
    ('ssi_sheet',                   'ssg_sheet_access', 'シート',         'toggle',  NULL,                          'sheet',                  0),
    ('ssi_sheetType',               'ssg_sheet_access', 'シート種別',     'text',    NULL,                          'sheetType',              1),
    ('ssi_imageSheet',              'ssg_sheet_access', 'イメージシート', 'segment', '["持参","現場"]'::jsonb,      'imageSheet',             2),
    ('ssi_scaffoldSign',            'ssg_sheet_access', '足場表示看板',   'toggle',  NULL,                          'scaffoldSign',           3),
    ('ssi_stairs',                  'ssg_sheet_access', '階段',           'toggle',  NULL,                          'stairs',                 4),
    ('ssi_ladder',                  'ssg_sheet_access', 'タラップ',       'toggle',  NULL,                          'ladder',                 5),
    ('ssi_stairUnit',               'ssg_sheet_access', '階段墜',         'toggle',  NULL,                          'stairUnit',              6),
    ('ssi_cornerAnti',              'ssg_sheet_access', '1・2コマアンチ', 'segment', '["400","250"]'::jsonb,        'cornerAnti',             7),
    ('ssi_parentRope',              'ssg_safety',       '親綱',           'text',    NULL,                          'parentRope',             0),
    ('ssi_cushionCover',            'ssg_safety',       '養生カバークッション', 'toggle', NULL,                      'cushionCover',           1),
    ('ssi_spaceTube',               'ssg_safety',       'スペースチューブ', 'toggle', NULL,                          'spaceTube',              2),
    ('ssi_gableHandrail',           'ssg_safety',       '切妻単管手摺',   'toggle',  NULL,                          'gableHandrail',          3);
