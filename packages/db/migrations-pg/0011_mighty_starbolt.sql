CREATE TABLE "tenant_usage_counters" (
	"tenant_id" text NOT NULL,
	"counter_key" text NOT NULL,
	"day" integer NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tenant_usage_counters_tenant_id_counter_key_day_pk" PRIMARY KEY("tenant_id","counter_key","day")
);
--> statement-breakpoint
CREATE INDEX "tenant_usage_counters_key_idx" ON "tenant_usage_counters" USING btree ("counter_key");