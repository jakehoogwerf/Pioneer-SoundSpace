import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.SUPABASE_DB_URL;

if (!connectionString) {
  throw new Error(
    "Missing SUPABASE_DB_URL environment variable. Add it in Netlify: " +
    "Site settings -> Environment variables -> SUPABASE_DB_URL " +
    "(use the 'Transaction' pooler connection string from Supabase, port 6543)."
  );
}

// `prepare: false` is required when connecting through Supabase's
// transaction-mode connection pooler (the recommended option for
// serverless/edge functions), which doesn't support prepared statements.
const client = postgres(connectionString, { prepare: false });

export const supabaseDb = drizzle({ client, schema });
