import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const supabaseEntry = resolve("node_modules", "supabase", "dist", "supabase.js");
const vitestEntry = resolve("node_modules", "vitest", "vitest.mjs");

const status = spawnSync(process.execPath, [supabaseEntry, "status", "-o", "json"], {
  encoding: "utf8",
  windowsHide: true,
});

if (status.status !== 0) {
  console.error("Local Supabase is not running. Start it with npm run db:start.");
  process.exit(status.status ?? 1);
}

let local;
try {
  local = JSON.parse(status.stdout);
} catch {
  console.error("Could not read local Supabase status.");
  process.exit(1);
}

const supabaseUrl = local.API_URL;
const publishableKey = local.PUBLISHABLE_KEY ?? local.ANON_KEY;
const secretKey = local.SECRET_KEY ?? local.SERVICE_ROLE_KEY;

if (!supabaseUrl || !publishableKey || !secretKey) {
  console.error("Local Supabase status is missing required service values.");
  process.exit(1);
}

const test = spawnSync(
  process.execPath,
  [vitestEntry, "run", "--config", "api/vitest.integration.config.ts"],
  {
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      SUPABASE_URL: supabaseUrl,
      SUPABASE_PUBLISHABLE_KEY: publishableKey,
      SUPABASE_SECRET_KEY: secretKey,
      STORAGE_BUCKET: "receipt-sources",
    },
  },
);

process.exit(test.status ?? 1);
