import pg from 'pg'

const { Pool } = pg

let pool
let lockPool
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

function getPostgresLockPool() {
  if (!hasPostgres()) {
    throw new Error('DATABASE_URL is not configured')
  }

  if (!lockPool) {
    lockPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? 10000),
      idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS ?? 30000),
      max: Number(process.env.DATABASE_LOCK_POOL_MAX ?? 5),
      ssl: shouldUseSsl() ? { rejectUnauthorized: false } : undefined,
    })
  }

  return lockPool
}

export async function withPostgresAdvisoryLock(namespace, key, task) {
  if (!hasPostgres()) {
    return task()
  }

  const client = await getPostgresLockPool().connect()
  const namespaceValue = Number(namespace)
  const lockKey = String(key)

  try {
    await client.query(
      'SELECT pg_advisory_lock($1::integer, hashtext($2))',
      [namespaceValue, lockKey],
    )
    return await task()
  } finally {
    try {
      await client.query(
        'SELECT pg_advisory_unlock($1::integer, hashtext($2))',
        [namespaceValue, lockKey],
      )
    } finally {
      client.release()
    }
  }
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
      CREATE TABLE IF NOT EXISTS profile_labels (
        id text PRIMARY KEY,
        name text NOT NULL,
        normalized_name text NOT NULL UNIQUE,
        color text,
        created_by text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS candidate_profile_labels (
        candidate_id text NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        label_id text NOT NULL REFERENCES profile_labels(id) ON DELETE CASCADE,
        assigned_by text,
        assigned_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (candidate_id, label_id)
      )
    `)
    await client.query('CREATE INDEX IF NOT EXISTS candidate_profile_labels_label_idx ON candidate_profile_labels (label_id)')
    await client.query(`
      CREATE TABLE IF NOT EXISTS candidate_comments (
        id text PRIMARY KEY,
        candidate_id text NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        body text NOT NULL,
        author_id text NOT NULL,
        author_name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await client.query('CREATE INDEX IF NOT EXISTS candidate_comments_candidate_idx ON candidate_comments (candidate_id, created_at)')
    await client.query(`
      CREATE TABLE IF NOT EXISTS custom_taxonomy_values (
        id text PRIMARY KEY,
        field text NOT NULL CHECK (
          field IN ('appearance', 'languageSkills', 'performanceTalents', 'physicalSkills', 'sportsTalents')
        ),
        value text NOT NULL,
        normalized_value text NOT NULL,
        status text NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'approved', 'merged', 'removed')),
        merged_into_value text,
        created_by text,
        updated_by text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (field, normalized_value)
      )
    `)
    await client.query('CREATE INDEX IF NOT EXISTS custom_taxonomy_values_status_idx ON custom_taxonomy_values (status, field)')
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
      CREATE TABLE IF NOT EXISTS telegram_updates (
        update_id bigint PRIMARY KEY,
        status text NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
        attempt_count integer NOT NULL DEFAULT 1,
        claimed_at timestamptz NOT NULL DEFAULT now(),
        processed_at timestamptz,
        last_error_code text,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await client.query('CREATE INDEX IF NOT EXISTS telegram_updates_status_claimed_idx ON telegram_updates (status, claimed_at)')
    await client.query(`
      CREATE TABLE IF NOT EXISTS telegram_deliveries (
        operation_id text NOT NULL,
        recipient_key text NOT NULL,
        chat_id text NOT NULL,
        kind text NOT NULL,
        status text NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'uncertain')),
        message_id text,
        attempt_count integer NOT NULL DEFAULT 1,
        last_error_code text,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        sent_at timestamptz,
        PRIMARY KEY (operation_id, recipient_key)
      )
    `)
    await client.query('CREATE INDEX IF NOT EXISTS telegram_deliveries_status_idx ON telegram_deliveries (status, updated_at)')
    await client.query(`
      CREATE TABLE IF NOT EXISTS telegram_example_files (
        asset_key text NOT NULL,
        telegram_method text NOT NULL,
        media_kind text NOT NULL,
        file_id text,
        file_unique_id text,
        availability_status text NOT NULL DEFAULT 'unknown'
          CHECK (availability_status IN ('unknown', 'available', 'missing', 'invalid')),
        last_validation_error_code text,
        last_validated_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (asset_key, telegram_method, media_kind)
      )
    `)
    await client.query(
      'CREATE INDEX IF NOT EXISTS telegram_example_files_availability_idx ON telegram_example_files (availability_status, updated_at)',
    )
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
    await client.query("ALTER TABLE castings ADD COLUMN IF NOT EXISTS public_token text")
    await client.query("ALTER TABLE castings ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'web_admin'")
    await client.query('ALTER TABLE castings ADD COLUMN IF NOT EXISTS published_at timestamptz')
    await client.query('ALTER TABLE castings ADD COLUMN IF NOT EXISTS closed_at timestamptz')
    await client.query('ALTER TABLE castings ADD COLUMN IF NOT EXISTS cancelled_at timestamptz')
    await client.query('ALTER TABLE castings ADD COLUMN IF NOT EXISTS created_by text')
    await client.query('ALTER TABLE castings ADD COLUMN IF NOT EXISTS updated_by text')
    await client.query('ALTER TABLE castings ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1')
    await client.query(`
      UPDATE castings
      SET public_token = 'legacy-' || md5(id)
      WHERE public_token IS NULL OR public_token = ''
    `)
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS castings_public_token_idx ON castings (public_token)')
    await client.query('CREATE INDEX IF NOT EXISTS castings_status_idx ON castings (status)')
    await client.query('CREATE INDEX IF NOT EXISTS castings_starts_at_idx ON castings (starts_at)')
    await client.query(`
      CREATE TABLE IF NOT EXISTS casting_participations (
        id text PRIMARY KEY,
        casting_id text NOT NULL REFERENCES castings(id) ON DELETE CASCADE,
        candidate_id text NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        source text NOT NULL CHECK (source IN ('self_apply', 'invitation', 'admin_added')),
        status text NOT NULL CHECK (
          status IN ('applied', 'invited', 'selected', 'rejected', 'declined', 'withdrawn', 'removed', 'cancelled')
        ),
        profile_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
        application_message text,
        created_by text,
        updated_by text,
        decided_by text,
        invited_at timestamptz,
        responded_at timestamptz,
        decided_at timestamptz,
        removed_at timestamptz,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (casting_id, candidate_id)
      )
    `)
    await client.query(
      'CREATE INDEX IF NOT EXISTS casting_participations_casting_status_idx ON casting_participations (casting_id, status)',
    )
    await client.query(
      'CREATE INDEX IF NOT EXISTS casting_participations_candidate_idx ON casting_participations (candidate_id, updated_at DESC)',
    )
    await client.query(`
      CREATE TABLE IF NOT EXISTS casting_outbox (
        id text PRIMARY KEY,
        operation_id text NOT NULL UNIQUE,
        event_type text NOT NULL,
        casting_id text REFERENCES castings(id) ON DELETE CASCADE,
        participation_id text REFERENCES casting_participations(id) ON DELETE SET NULL,
        recipient_key text,
        status text NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        attempt_count integer NOT NULL DEFAULT 0,
        available_at timestamptz NOT NULL DEFAULT now(),
        claimed_at timestamptz,
        sent_at timestamptz,
        last_error_code text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await client.query(
      'CREATE INDEX IF NOT EXISTS casting_outbox_ready_idx ON casting_outbox (status, available_at, created_at)',
    )
    await client.query(`
      CREATE TABLE IF NOT EXISTS casting_channel_config (
        channel_key text PRIMARY KEY,
        telegram_chat_id text,
        display_name text,
        enabled boolean NOT NULL DEFAULT false,
        health_status text NOT NULL DEFAULT 'unconfigured'
          CHECK (health_status IN ('unconfigured', 'unknown', 'healthy', 'unhealthy')),
        last_checked_at timestamptz,
        last_error_code text,
        updated_by text,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await client.query('ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS casting_id text')
    await client.query('ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS participation_id text')
    await client.query('CREATE INDEX IF NOT EXISTS audit_events_casting_idx ON audit_events (casting_id, at)')
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
