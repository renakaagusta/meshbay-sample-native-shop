UPDATE "products" SET "price_cents" = round("price" * 100) WHERE "price_cents" IS NULL;

ALTER TABLE "products" ALTER COLUMN "price_cents" SET NOT NULL;

ALTER TABLE "products" DROP COLUMN "price";
