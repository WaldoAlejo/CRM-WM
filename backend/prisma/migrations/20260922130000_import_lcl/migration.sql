ALTER TABLE "ImportBatch" DROP CONSTRAINT "ImportBatch_containerType_valid";
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_containerType_valid"
  CHECK ("containerType" IN ('20', '40', '40HC', 'LCL'));
