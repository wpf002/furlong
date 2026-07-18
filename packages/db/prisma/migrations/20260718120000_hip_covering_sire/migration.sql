-- Breeding-stock: the sire a mare is in foal to at a given sale (NULL = open/barren/maiden).
ALTER TABLE "Hip" ADD COLUMN "coveringSire" TEXT;
