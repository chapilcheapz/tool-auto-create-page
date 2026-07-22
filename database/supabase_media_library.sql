-- ============================================================================
-- Supabase media library
-- Run in Supabase Dashboard -> SQL Editor.
--
-- Authentication note:
--   The application uses its own app_users/JWT authentication. Node.js is the
--   only Supabase client and connects with SUPABASE_SERVICE_ROLE_KEY. Therefore
--   this migration deliberately does not create auth.uid() policies. RLS is
--   enabled with no browser-facing policies, while the service role bypasses
--   RLS. Every backend query must still filter and validate owner_username.
--
-- Storage note:
--   The videos bucket is public so generated publicUrl values can be played by
--   the current frontend. Uploads and object listings remain backend-only.
-- ============================================================================

-- 1. Public media bucket. Omitting file_size_limit inherits the Storage limit
-- of the current project/plan instead of assuming every project accepts 500 MiB.
INSERT INTO storage.buckets (
    id,
    name,
    public
)
VALUES (
    'videos',
    'videos',
    TRUE
)
ON CONFLICT (id) DO UPDATE
SET
    name = EXCLUDED.name,
    public = TRUE;

-- 2. Persistent metadata for uploaded, extracted, edited and rendered assets.
CREATE TABLE IF NOT EXISTS public.media_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Username from public.app_users/custom JWT, not auth.users/auth.uid().
    owner_username VARCHAR(255) NOT NULL,

    media_type VARCHAR(20) NOT NULL,
    origin VARCHAR(40) NOT NULL DEFAULT 'upload',
    status VARCHAR(30) NOT NULL DEFAULT 'ready',

    title VARCHAR(500),
    source_url TEXT,

    storage_bucket VARCHAR(100) NOT NULL DEFAULT 'videos',
    storage_path TEXT NOT NULL,
    file_name VARCHAR(500) NOT NULL,
    mime_type VARCHAR(150) NOT NULL,
    file_size BIGINT,
    duration_ms BIGINT,
    width INTEGER,
    height INTEGER,

    -- Asset lineage. Audio edits point to source_asset_id; rendered videos can
    -- additionally identify the selected video and audio inputs.
    source_asset_id UUID REFERENCES public.media_assets(id) ON DELETE SET NULL,
    input_video_asset_id UUID REFERENCES public.media_assets(id) ON DELETE SET NULL,
    input_audio_asset_id UUID REFERENCES public.media_assets(id) ON DELETE SET NULL,
    edit_spec JSONB NOT NULL DEFAULT '{}'::JSONB,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,

    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT media_assets_owner_username_check
        CHECK (LENGTH(BTRIM(owner_username)) > 0),
    CONSTRAINT media_assets_media_type_check
        CHECK (media_type IN ('video', 'audio')),
    CONSTRAINT media_assets_status_check
        CHECK (status IN ('pending', 'processing', 'ready', 'completed', 'failed')),
    CONSTRAINT media_assets_file_size_check
        CHECK (file_size IS NULL OR file_size >= 0),
    CONSTRAINT media_assets_duration_check
        CHECK (duration_ms IS NULL OR duration_ms >= 0),
    CONSTRAINT media_assets_dimensions_check
        CHECK (
            (width IS NULL OR width > 0)
            AND (height IS NULL OR height > 0)
        ),
    CONSTRAINT media_assets_storage_object_unique
        UNIQUE (storage_bucket, storage_path)
);

CREATE INDEX IF NOT EXISTS media_assets_owner_created_at_index
ON public.media_assets(owner_username, created_at DESC);

CREATE INDEX IF NOT EXISTS media_assets_owner_type_status_index
ON public.media_assets(owner_username, media_type, status);

CREATE INDEX IF NOT EXISTS media_assets_source_asset_id_index
ON public.media_assets(source_asset_id);

CREATE INDEX IF NOT EXISTS media_assets_input_video_asset_id_index
ON public.media_assets(input_video_asset_id);

CREATE INDEX IF NOT EXISTS media_assets_input_audio_asset_id_index
ON public.media_assets(input_audio_asset_id);

-- 3. Keep updated_at accurate without relying on application clocks.
CREATE OR REPLACE FUNCTION public.set_media_assets_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_media_assets_updated_at
ON public.media_assets;

CREATE TRIGGER set_media_assets_updated_at
BEFORE UPDATE ON public.media_assets
FOR EACH ROW
EXECUTE FUNCTION public.set_media_assets_updated_at();

-- 4. Deny direct PostgREST access. The backend service role bypasses RLS.
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.media_assets FROM anon, authenticated;
GRANT ALL ON TABLE public.media_assets TO service_role;

COMMENT ON TABLE public.media_assets IS
'Backend-managed media metadata. Ownership uses custom app_users username; access is via the Node.js service role only.';

COMMENT ON COLUMN public.media_assets.owner_username IS
'Normalized username from the application custom JWT/app_users table; it is not a Supabase auth.users UUID.';

COMMENT ON COLUMN public.media_assets.storage_path IS
'Sanitized object key, normally users/<username>/{videos,audio,renders}/<file>.';

COMMENT ON COLUMN public.media_assets.edit_spec IS
'Operation parameters such as deleted audio time ranges; source files remain immutable.';
