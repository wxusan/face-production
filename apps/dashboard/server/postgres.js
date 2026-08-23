import pg from 'pg'

const { Pool } = pg

let pool
let schemaInitPromise = null

export function hasPostgres() {
  return Boolean(process.env.DATABASE_URL)
}

function shouldUseSsl() {
  const databaseUrl = String(process.env.DATABASE_URL ?? '')
  return (
    process.env.PGSSLMODE === 'require' ||
    process.env.DATABASE_SSL === 'true' ||
    databaseUrl.includes('sslmode=require') ||
    databaseUrl.includes('supabase.co') ||
    databaseUrl.includes('pooler.supabase.com')
  )
}

export function getPostgresPool() {
  if (!hasPostgres()) {
    throw new Error('DATABASE_URL is not configured')
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? 10000),
      idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS ?? 30000),
      max: Number(process.env.DATABASE_POOL_MAX ?? (process.env.VERCEL ? 1 : 3)),
      ssl: shouldUseSsl() ? { rejectUnauthorized: false } : undefined,
    })
  }

  return pool
}

export async function query(sql, params = []) {
  await ensurePostgresSchema()
  return getPostgresPool().query(sql, params)
}

export async function rawQuery(sql, params = []) {
  return getPostgresPool().query(sql, params)
}

async function _runSchemaInit() {
  const client = await getPostgresPool().connect()

  try {
    await client.query('BEGIN')
    await client.query(`
      CREATE TABLE IF NOT EXISTS candidates (
        id text PRIMARY KEY,
        status text NOT NULL DEFAULT 'pending_review',
        source text NOT NULL DEFAULT 'telegram',
        name text,
        phone text,
        telegram_user_id text,
        telegram_username text,
        city text,
        gender text,
        age integer,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await client.query('CREATE INDEX IF NOT EXISTS candidates_status_idx ON candidates (status)')
    await client.query('CREATE INDEX IF NOT EXISTS candidates_phone_idx ON candidates (phone)')
    await client.query('CREATE INDEX IF NOT EXISTS candidates_telegram_user_idx ON candidates (telegram_user_id)')
    await client.query('CREATE INDEX IF NOT EXISTS candidates_city_idx ON candidates (city)')
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id bigserial PRIMARY KEY,
        action text NOT NULL,
        candidate_id text,
        actor text,
        actor_telegram_id text,
        outcome text,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await client.query('CREATE INDEX IF NOT EXISTS audit_events_at_idx ON audit_events (at)')
    await client.query('CREATE INDEX IF NOT EXISTS audit_events_candidate_idx ON audit_events (candidate_id)')
    await client.query(`
      CREATE TABLE IF NOT EXISTS bot_sessions (
        telegram_user_id text PRIMARY KEY,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await client.query('CREATE INDEX IF NOT EXISTS bot_sessions_updated_at_idx ON bot_sessions (updated_at)')
    await client.query(`
      CREATE TABLE IF NOT EXISTS castings (
        id text PRIMARY KEY,
        status text NOT NULL DEFAULT 'active',
        title text NOT NULL,
        body text NOT NULL,
        starts_at timestamptz,
        ends_at timestamptz,
        target_candidate_ids text[] NOT NULL DEFAULT '{}',
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await client.query('CREATE INDEX IF NOT EXISTS castings_status_idx ON castings (status)')
    await client.query('CREATE INDEX IF NOT EXISTS castings_starts_at_idx ON castings (starts_at)')
    await client.query(`
      CREATE TABLE IF NOT EXISTS briefs (
        id text PRIMARY KEY,
        status text NOT NULL DEFAULT 'new',
        locale text NOT NULL DEFAULT 'ru',
        client_name text NOT NULL,
        company text,
        contact text NOT NULL,
        project_type text NOT NULL,
        shooting_date text,
        location text,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await client.query('CREATE INDEX IF NOT EXISTS briefs_status_idx ON briefs (status)')
    await client.query('CREATE INDEX IF NOT EXISTS briefs_created_at_idx ON briefs (created_at)')
    await client.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id text PRIMARY KEY,
        name text NOT NULL,
        email text,
        role text NOT NULL DEFAULT 'admin',
        status text NOT NULL DEFAULT 'active',
        token_hash text NOT NULL,
        telegram_user_id text,
        telegram_username text,
        telegram_notifications boolean NOT NULL DEFAULT false,
        telegram_notifications_allowed boolean NOT NULL DEFAULT false,
        invited_by text,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS admins_single_super_admin_idx ON admins (role) WHERE role = \'super_admin\'')
    await client.query('CREATE INDEX IF NOT EXISTS admins_telegram_user_idx ON admins (telegram_user_id)')
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function startSchemaInit() {
  if (!hasPostgres()) return
  schemaInitPromise = _runSchemaInit()
  schemaInitPromise.catch((err) => {
    console.error('Schema init failed, will retry:', err.message)
    schemaInitPromise = null
  })
}

export async function ensurePostgresSchema() {
  if (!hasPostgres()) return
  if (!schemaInitPromise) {
    schemaInitPromise = _runSchemaInit()
  }
  return schemaInitPromise
}

startSchemaInit()
