import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.SUPABASE_DB_URL;

// IMPORTANT: this must never throw while the module is being imported.
// If the connection string is missing, a throw here crashes the whole
// function at startup with an opaque 502 - before it can respond with
// anything helpful. Instead we build the client against a harmless dead
// address, so any query simply fails fast, and the functions that use
// this report "missing_env" by checking SUPABASE_DB_URL explicitly.
export const supabaseConfigured = Boolean(connectionString);

// `prepare: false` is required when connecting through Supabase's
// transaction-mode connection pooler (the recommended option for
// serverless/edge functions), which doesn't support prepared statements.
// `connect_timeout` makes an unreachable database fail quickly with a clear
// error instead of hanging until the function itself times out.
const client = postgres(
  connectionString ?? "postgres://missing-supabase-db-url@127.0.0.1:1/missing",
  { prepare: false, connect_timeout: 8 }
);

export const supabaseDb = drizzle({ client, schema });
