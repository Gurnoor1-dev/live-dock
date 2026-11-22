import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const migrationUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!migrationUrl) {
  throw new Error("DATABASE_URL_UNPOOLED (direct Neon connection) is required to run Drizzle migrations.");
}

const migrationHost = migrationUrl.match(/@([^/:?]+)/)?.[1] ?? "";
if (migrationHost.includes("-pooler")) {
  throw new Error("Drizzle migrations require a direct, non-pooled Neon connection. Set DATABASE_URL_UNPOOLED.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: migrationUrl },
  strict: true,
  verbose: true
});
