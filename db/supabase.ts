import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.SUPABASE_DB_URL;

// IMPORTANT: nothing in this file may throw while the module is imported.
// A throw here crashes the whole function at startup with an opaque error,
// before it can say anything helpful. Instead, problems are recorded and
// the functions that use this report them as a clear code.
export const supabaseConfigured = Boolean(connectionString);

// `prepare: false` is required when connecting through Supabase's
// transaction-mode connection pooler (the recommended option for
// serverless/edge functions), which doesn't support prepared statements.
// `connect_timeout` makes an unreachable database fail quickly with a clear
// error instead of hanging until the function itself times out.
const options = { prepare: false, connect_timeout: 8 } as const;
const DEAD_URL = "postgres://missing-supabase-db-url@127.0.0.1:1/missing";

// A malformed connection string (most often a password containing
// characters like @ # / ? that weren't URL-encoded) makes postgres.js throw
// immediately. Catch that and remember it so it can be reported.
let initError: unknown = null;
function makeClient() {
  try {
    return postgres(connectionString ?? DEAD_URL, options);
  } catch (e) {
    initError = e;
    return postgres(DEAD_URL, options);
  }
}

const client = makeClient();
export const supabaseInitError = initError;
export const supabaseDb = drizzle({ client, schema });
