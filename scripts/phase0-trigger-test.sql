-- Trigger behavior verification (no Japanese chars, avoids cp932 pipe issues)
\set ON_ERROR_STOP off

-- Setup: minimal FK target rows
INSERT INTO "User" (id, username, email, "displayName", "passwordHash", "updatedAt")
  VALUES ('test-user-1','testuser','test@example.com','Test User','hash','2026-01-01 00:00:00');
INSERT INTO "ProjectMaster" (id, title, "updatedAt")
  VALUES ('test-pm-1','Test Project','2026-01-01 00:00:00');
INSERT INTO "ProjectMaster" (id, title, "updatedAt")
  VALUES ('test-pm-2','Test Project 2','2026-01-01 00:00:00');
INSERT INTO "Customer" (id, name, "updatedAt")
  VALUES ('test-cust-1','Test Customer','2026-01-01 00:00:00');
INSERT INTO "Customer" (id, name, "updatedAt")
  VALUES ('test-cust-2','Test Customer 2','2026-01-01 00:00:00');
INSERT INTO "Invoice" (id, "invoiceNumber", title, items, subtotal, tax, total, "dueDate", "updatedAt")
  VALUES ('test-inv-1','TEST0001','Test Invoice','[]',0,0,0,'2026-12-31','2026-01-01 00:00:00');

\echo
\echo === T1: INSERT BillingDraft as pending ===
INSERT INTO "BillingDraft" (id, "projectId", "customerId", title, amount, "createdById", "updatedAt")
  VALUES ('bd-1','test-pm-1','test-cust-1','Test draft',100000,'test-user-1','2026-01-01 00:00:00')
  RETURNING id, status, amount;

\echo
\echo === T2: UPDATE amount while pending (should SUCCEED) ===
UPDATE "BillingDraft" SET amount = 120000 WHERE id = 'bd-1' RETURNING id, status, amount;

\echo
\echo === T3: UPDATE status to confirmed (should SUCCEED) ===
UPDATE "BillingDraft" SET status = 'confirmed' WHERE id = 'bd-1' RETURNING id, status, amount;

\echo
\echo === T4: UPDATE amount while confirmed (should REJECT) ===
UPDATE "BillingDraft" SET amount = 999999 WHERE id = 'bd-1';

\echo
\echo === T5: UPDATE projectId while confirmed to a different pm (should REJECT) ===
UPDATE "BillingDraft" SET "projectId" = 'test-pm-2' WHERE id = 'bd-1';

\echo
\echo === T6: UPDATE customerId while confirmed (should REJECT) ===
UPDATE "BillingDraft" SET "customerId" = 'test-cust-2' WHERE id = 'bd-1';

\echo
\echo === T7: UPDATE note while confirmed (NOT protected, should SUCCEED) ===
UPDATE "BillingDraft" SET note = 'amendment note' WHERE id = 'bd-1' RETURNING id, status, note;

\echo
\echo === T8: UPDATE title while confirmed (NOT protected, should SUCCEED) ===
UPDATE "BillingDraft" SET title = 'amended title' WHERE id = 'bd-1' RETURNING id, status, title;

\echo
\echo === T9: Move to cancelled, then change amount (should SUCCEED) ===
UPDATE "BillingDraft" SET status = 'cancelled' WHERE id = 'bd-1' RETURNING id, status;
UPDATE "BillingDraft" SET amount = 50000 WHERE id = 'bd-1' RETURNING id, status, amount;

\echo
\echo === T10: Soft-delete (deletedAt) is NOT protected (should SUCCEED) ===
UPDATE "BillingDraft" SET "deletedAt" = '2026-05-28 14:00:00' WHERE id = 'bd-1' RETURNING id, "deletedAt";

\echo
\echo === Final state ===
SELECT id, status, amount, title, note, "deletedAt" FROM "BillingDraft" WHERE id = 'bd-1';

\echo
\echo === Cleanup ===
DELETE FROM "BillingDraft" WHERE id = 'bd-1';
DELETE FROM "Invoice" WHERE id = 'test-inv-1';
DELETE FROM "Customer" WHERE id LIKE 'test-cust-%';
DELETE FROM "ProjectMaster" WHERE id LIKE 'test-pm-%';
DELETE FROM "User" WHERE id = 'test-user-1';
