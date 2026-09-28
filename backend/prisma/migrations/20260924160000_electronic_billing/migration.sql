-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "ivaCode" TEXT,
ADD COLUMN     "ivaRate" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "DispatchOrder" ADD COLUMN     "fiscalIssuerId" TEXT;

-- AlterTable
ALTER TABLE "DispatchOrderItem" ADD COLUMN     "ivaCode" TEXT,
ADD COLUMN     "ivaRate" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "MailProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "security" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordEncrypted" TEXT,
    "fromName" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "replyTo" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "activeIssuerId" TEXT,
    "defaultMailProfileId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalIssuer" (
    "id" TEXT NOT NULL,
    "ruc" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "address" TEXT NOT NULL,
    "accountingRequired" BOOLEAN NOT NULL DEFAULT false,
    "specialTaxpayer" TEXT,
    "withholdingAgent" TEXT,
    "regime" TEXT NOT NULL DEFAULT 'GENERAL',
    "environment" TEXT NOT NULL DEFAULT '1',
    "mailProfileId" TEXT,
    "enabledForEmission" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalIssuer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalCertificate" (
    "id" TEXT NOT NULL,
    "issuerId" TEXT NOT NULL,
    "p12Encrypted" TEXT,
    "passwordEncrypted" TEXT,
    "subject" TEXT NOT NULL,
    "issuedBy" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalSeries" (
    "id" TEXT NOT NULL,
    "issuerId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "establishment" TEXT NOT NULL,
    "emissionPoint" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FiscalSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalDocument" (
    "id" TEXT NOT NULL,
    "issuerId" TEXT NOT NULL,
    "dispatchOrderId" TEXT,
    "certificateId" TEXT,
    "seriesId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "cancellationStatus" TEXT NOT NULL DEFAULT 'NONE',
    "number" TEXT,
    "accessKey" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "buyerName" TEXT NOT NULL,
    "buyerIdentification" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "total" DECIMAL(12,2) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "unsignedXml" TEXT,
    "signedXml" TEXT,
    "authorizedXml" TEXT,
    "authorizationNumber" TEXT,
    "authorizedAt" TIMESTAMP(3),
    "lastMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "originalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalEvent" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "performedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailDelivery" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "documentId" TEXT,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FiscalIssuer_ruc_key" ON "FiscalIssuer"("ruc");

-- CreateIndex
CREATE INDEX "FiscalCertificate_issuerId_retiredAt_idx" ON "FiscalCertificate"("issuerId", "retiredAt");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalSeries_issuerId_environment_documentType_establishmen_key" ON "FiscalSeries"("issuerId", "environment", "documentType", "establishment", "emissionPoint");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocument_sourceKey_key" ON "FiscalDocument"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocument_accessKey_key" ON "FiscalDocument"("accessKey");

-- CreateIndex
CREATE INDEX "FiscalDocument_issuerId_issueDate_idx" ON "FiscalDocument"("issuerId", "issueDate");

-- CreateIndex
CREATE INDEX "FiscalDocument_status_nextAttemptAt_idx" ON "FiscalDocument"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "FiscalDocument_dispatchOrderId_idx" ON "FiscalDocument"("dispatchOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalDocument_seriesId_number_key" ON "FiscalDocument"("seriesId", "number");

-- CreateIndex
CREATE INDEX "MailDelivery_documentId_createdAt_idx" ON "MailDelivery"("documentId", "createdAt");

-- AddForeignKey
ALTER TABLE "DispatchOrder" ADD CONSTRAINT "DispatchOrder_fiscalIssuerId_fkey" FOREIGN KEY ("fiscalIssuerId") REFERENCES "FiscalIssuer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalSettings" ADD CONSTRAINT "FiscalSettings_activeIssuerId_fkey" FOREIGN KEY ("activeIssuerId") REFERENCES "FiscalIssuer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalSettings" ADD CONSTRAINT "FiscalSettings_defaultMailProfileId_fkey" FOREIGN KEY ("defaultMailProfileId") REFERENCES "MailProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalIssuer" ADD CONSTRAINT "FiscalIssuer_mailProfileId_fkey" FOREIGN KEY ("mailProfileId") REFERENCES "MailProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalCertificate" ADD CONSTRAINT "FiscalCertificate_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "FiscalIssuer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalSeries" ADD CONSTRAINT "FiscalSeries_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "FiscalIssuer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "FiscalIssuer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_dispatchOrderId_fkey" FOREIGN KEY ("dispatchOrderId") REFERENCES "DispatchOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "FiscalCertificate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "FiscalSeries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_originalId_fkey" FOREIGN KEY ("originalId") REFERENCES "FiscalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalEvent" ADD CONSTRAINT "FiscalEvent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FiscalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailDelivery" ADD CONSTRAINT "MailDelivery_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "MailProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailDelivery" ADD CONSTRAINT "MailDelivery_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FiscalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "FiscalSettings" ADD CONSTRAINT "FiscalSettings_singleton" CHECK ("id" = 1);
CREATE UNIQUE INDEX "FiscalCertificate_one_current" ON "FiscalCertificate" ("issuerId") WHERE "retiredAt" IS NULL;
