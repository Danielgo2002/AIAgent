ALTER TABLE "users" ADD COLUMN "phone_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_hash_unique" UNIQUE("phone_hash");