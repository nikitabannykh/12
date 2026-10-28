// Идемпотентная схема. Выполняется автоматически при первом обращении к базе.
// Держим её в синхронизации с schema.ts. Новые колонки — через ADD COLUMN IF NOT EXISTS.
export const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL,
  name text,
  image text,
  password_hash text,
  email_verified_at timestamptz,
  session_version integer NOT NULL DEFAULT 0,
  current_business_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(email);

CREATE TABLE IF NOT EXISTS businesses (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  public_key text NOT NULL,
  name text NOT NULL,
  niche text NOT NULL,
  city text NOT NULL,
  address text,
  phone text,
  whatsapp text,
  telegram text,
  hours text,
  org_url text,
  org_id text,
  legal_info text,
  geo jsonb,
  site_url text,
  source_links jsonb NOT NULL DEFAULT '[]',
  description text NOT NULL DEFAULT '',
  services jsonb NOT NULL DEFAULT '[]',
  advantages jsonb NOT NULL DEFAULT '[]',
  audience text,
  offer text,
  review text,
  monthly_budget integer NOT NULL DEFAULT 15000,
  lead_to_client_rate real NOT NULL DEFAULT 0.5,
  status text NOT NULL DEFAULT 'draft',
  counter_id bigint,
  goal_ids jsonb NOT NULL DEFAULT '{}',
  region_ids jsonb NOT NULL DEFAULT '{}',
  launch_plan jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS businesses_user ON businesses(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS businesses_public ON businesses(public_key);

CREATE TABLE IF NOT EXISTS ad_accounts (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  platform text NOT NULL,
  login text NOT NULL,
  external_id text,
  access_token text NOT NULL,
  refresh_token text,
  client_id text,
  client_secret text,
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'ok',
  status_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ad_accounts_user ON ad_accounts(user_id);

CREATE TABLE IF NOT EXISTS campaigns (
  id text PRIMARY KEY,
  business_id text NOT NULL,
  account_id text NOT NULL,
  platform text NOT NULL,
  channel text NOT NULL,
  external_id text,
  name text NOT NULL,
  weekly_budget integer NOT NULL,
  strategy text NOT NULL DEFAULT 'clicks',
  status text NOT NULL DEFAULT 'active',
  status_note text,
  negative_keywords jsonb NOT NULL DEFAULT '[]',
  meta jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaigns_business ON campaigns(business_id);

CREATE TABLE IF NOT EXISTS ad_groups (
  id text PRIMARY KEY,
  campaign_id text NOT NULL,
  external_id text,
  name text NOT NULL,
  audience text NOT NULL,
  keywords jsonb NOT NULL DEFAULT '[]',
  targeting jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ad_groups_campaign ON ad_groups(campaign_id);

CREATE TABLE IF NOT EXISTS ads (
  id text PRIMARY KEY,
  business_id text NOT NULL,
  campaign_id text NOT NULL,
  ad_group_id text NOT NULL,
  external_id text,
  angle text NOT NULL,
  title text NOT NULL,
  title2 text,
  text text NOT NULL,
  image_id text,
  status text NOT NULL DEFAULT 'moderation',
  status_note text,
  experiment_id text,
  parent_ad_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ads_campaign ON ads(campaign_id);
CREATE INDEX IF NOT EXISTS ads_business ON ads(business_id);

CREATE TABLE IF NOT EXISTS images (
  id text PRIMARY KEY,
  business_id text NOT NULL,
  kind text NOT NULL,
  mime text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  data bytea NOT NULL,
  prompt text,
  layout text,
  platform_refs jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS images_business ON images(business_id);

CREATE TABLE IF NOT EXISTS stats_daily (
  id text PRIMARY KEY,
  business_id text NOT NULL,
  campaign_id text NOT NULL,
  ad_id text NOT NULL,
  day date NOT NULL,
  impressions integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  cost real NOT NULL DEFAULT 0,
  conversions integer NOT NULL DEFAULT 0,
  tv_weighted real NOT NULL DEFAULT 0,
  pos_weighted real NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS stats_unique ON stats_daily(campaign_id, ad_id, day);
CREATE INDEX IF NOT EXISTS stats_business_day ON stats_daily(business_id, day);

CREATE TABLE IF NOT EXISTS experiments (
  id text PRIMARY KEY,
  business_id text NOT NULL,
  campaign_id text NOT NULL,
  kind text NOT NULL,
  hypothesis text NOT NULL,
  control_id text NOT NULL,
  variant_id text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  result text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS experiments_business ON experiments(business_id);

CREATE TABLE IF NOT EXISTS changes (
  id text PRIMARY KEY,
  business_id text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  reason text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  undo jsonb,
  reverted_at timestamptz,
  revert_of text
);
CREATE INDEX IF NOT EXISTS changes_business_at ON changes(business_id, at);

CREATE TABLE IF NOT EXISTS leads (
  id text PRIMARY KEY,
  business_id text NOT NULL,
  kind text NOT NULL,
  visitor_id text,
  name text,
  contact text,
  message text,
  source text,
  campaign_ext text,
  ad_ext text,
  status text,
  status_at timestamptz,
  metrika_client_id text,
  yclid text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leads_business ON leads(business_id, created_at);

CREATE TABLE IF NOT EXISTS client_marks (
  id text PRIMARY KEY,
  business_id text NOT NULL,
  week_start date NOT NULL,
  clients integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS client_marks_unique ON client_marks(business_id, week_start);

CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  business_id text NOT NULL,
  kind text NOT NULL,
  last_run_at timestamptz,
  last_result text,
  locked_until timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_unique ON jobs(business_id, kind);

CREATE TABLE IF NOT EXISTS kv (
  key text PRIMARY KEY,
  value jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS hours text;
ALTER TABLE stats_daily ADD COLUMN IF NOT EXISTS tv_weighted real NOT NULL DEFAULT 0;
ALTER TABLE stats_daily ADD COLUMN IF NOT EXISTS pos_weighted real NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  reset_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS notify_settings (
  business_id text PRIMARY KEY,
  telegram_chat_id text,
  telegram_name text,
  linked_at timestamptz,
  digest integer NOT NULL DEFAULT 1,
  last_digest_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leads_business_contact ON leads(business_id, contact);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS org_url text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS org_id text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS legal_info text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS geo jsonb;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS status_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS metrika_client_id text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS yclid text;
ALTER TABLE ad_accounts ADD COLUMN IF NOT EXISTS client_id text;
ALTER TABLE ad_accounts ADD COLUMN IF NOT EXISTS client_secret text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_business_id text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS source_links jsonb NOT NULL DEFAULT '[]';
`;
