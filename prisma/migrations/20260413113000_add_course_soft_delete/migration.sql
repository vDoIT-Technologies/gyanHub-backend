ALTER TABLE "courses"
ADD COLUMN "deleted_at" TIMESTAMP(3);

CREATE INDEX "courses_deleted_at_idx" ON "courses"("deleted_at");
