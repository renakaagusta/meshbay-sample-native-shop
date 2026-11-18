ALTER TABLE "products" ADD COLUMN "price_cents" INTEGER;

UPDATE "products" SET "price_cents" = round("price" * 100) WHERE "price" IS NOT NULL;
