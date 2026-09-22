ALTER TABLE "DispatchOrderItem" ADD COLUMN "markupPct" DECIMAL(7,2);
ALTER TABLE "DispatchOrderItem" ADD CONSTRAINT "DispatchOrderItem_markupPct_range" CHECK ("markupPct" >= 0 AND "markupPct" <= 10000);
