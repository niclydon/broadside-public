-- 001-foundation.sql
-- Squashed public schema for Broadside showcase.
-- Derived from the current application schema and sanitized for public release.

--
-- PostgreSQL database dump
--


-- Dumped from database version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: media_assets_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.media_assets_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid NOT NULL,
    platform text NOT NULL,
    external_id text NOT NULL,
    external_subaccount_id text,
    handle text,
    display_name text,
    kind text DEFAULT 'primary'::text NOT NULL,
    parent_account_id uuid,
    required_fields jsonb DEFAULT '{}'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    actor text DEFAULT 'human:operator'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT accounts_kind_check CHECK ((kind = ANY (ARRAY['primary'::text, 'page'::text, 'playlist'::text])))
);


--
-- Name: brands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    tagline text,
    audience_description text,
    accent_color text DEFAULT '#5aadf0'::text NOT NULL,
    display_font text DEFAULT 'Inter'::text NOT NULL,
    pillars jsonb DEFAULT '[]'::jsonb NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL,
    actor text DEFAULT 'human:operator'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    accent_color_secondary text
);


--
-- Name: broadside_schema_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.broadside_schema_version (
    version integer NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    description text
);


--
-- Name: content_group_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_group_tags (
    content_group_id uuid NOT NULL,
    tag_id uuid NOT NULL
);


--
-- Name: content_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    topic_id uuid,
    status text DEFAULT 'draft'::text NOT NULL,
    scheduled_at timestamp with time zone,
    notes text,
    source text DEFAULT 'manual'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    parent_group_id uuid,
    repurpose_type text,
    is_evergreen boolean DEFAULT false NOT NULL,
    recycle_interval_days integer,
    last_recycled_at timestamp with time zone,
    recycle_count integer DEFAULT 0 NOT NULL,
    brand_id uuid NOT NULL,
    actor text DEFAULT 'human:operator'::text NOT NULL,
    CONSTRAINT content_groups_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'ai_draft'::text, 'imported'::text]))),
    CONSTRAINT content_groups_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'queued'::text, 'scheduled'::text, 'ready'::text, 'posted'::text, 'archived'::text])))
);


--
-- Name: content_pillars; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_pillars (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    color text,
    day_of_week integer,
    frequency text DEFAULT 'weekly'::text,
    topic_id uuid,
    target_platform text,
    sort_order integer DEFAULT 100 NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: context_embeddings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.context_embeddings (
    context_item_id uuid NOT NULL,
    embedding public.halfvec(4096) NOT NULL,
    model text DEFAULT 'nomic-embed-text-v1.5'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: context_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.context_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_id uuid NOT NULL,
    external_id text NOT NULL,
    kind text NOT NULL,
    title text,
    content text NOT NULL,
    content_hash text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    topic_scores jsonb,
    actor text DEFAULT 'system:ingest'::text NOT NULL
);


--
-- Name: context_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.context_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    name text NOT NULL,
    path text,
    enabled boolean DEFAULT true NOT NULL,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    brand_id uuid,
    actor text DEFAULT 'human:operator'::text NOT NULL,
    CONSTRAINT context_sources_kind_check CHECK ((kind = ANY (ARRAY['project_folder'::text, 'git_repo'::text, 'shared-warehouse_db'::text, 'github_repo'::text])))
);


--
-- Name: draft_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.draft_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    generation_id uuid NOT NULL,
    topic_slug text,
    hook text,
    body text NOT NULL,
    rationale text,
    cited_item_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    accepted boolean DEFAULT false NOT NULL,
    rejected boolean DEFAULT false NOT NULL,
    content_group_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor text DEFAULT 'system:drafter'::text NOT NULL
);


--
-- Name: draft_generations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.draft_generations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prompt_summary text NOT NULL,
    model text NOT NULL,
    input_tokens integer,
    output_tokens integer,
    cache_read_tokens integer,
    cost_usd numeric(10,6),
    context_item_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    brand_id uuid,
    actor text DEFAULT 'system:drafter'::text NOT NULL,
    CONSTRAINT draft_generations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'failed'::text])))
);


--
-- Name: jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    params jsonb DEFAULT '{}'::jsonb NOT NULL,
    result jsonb,
    error text,
    progress_current integer,
    progress_total integer,
    progress_label text,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'failed'::text])))
);


--
-- Name: linkedin_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.linkedin_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    access_token text NOT NULL,
    refresh_token text,
    expires_at timestamp with time zone,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    member_urn text,
    display_name text,
    profile_url text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    content_group_id uuid,
    kind text NOT NULL,
    path text NOT NULL,
    filename text,
    mime_type text,
    width integer,
    height integer,
    alt_text text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor text DEFAULT 'human:operator'::text NOT NULL,
    CONSTRAINT media_kind_check CHECK ((kind = ANY (ARRAY['image'::text, 'link_preview'::text])))
);


--
-- Name: media_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    brand_id uuid,
    filename text NOT NULL,
    storage_path text NOT NULL,
    url text,
    use_case text NOT NULL,
    platform text,
    width integer,
    height integer,
    mime_type text,
    size_bytes integer,
    alt_text text,
    is_current boolean DEFAULT false NOT NULL,
    notes text,
    source_label text,
    actor text DEFAULT 'human:operator'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    vlm_description text,
    vlm_description_generated_at timestamp with time zone
);


--
-- Name: COLUMN media_assets.vlm_description; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.media_assets.vlm_description IS 'One-sentence visual description generated by a vision-language model. Used for accessibility, search hint, and agent disambiguation.';


--
-- Name: COLUMN media_assets.vlm_description_generated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.media_assets.vlm_description_generated_at IS 'When the description was generated. NULL means not yet attempted or last attempt failed.';


--
-- Name: newsletter_sends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.newsletter_sends (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    subscriber_id uuid NOT NULL,
    resend_id text,
    status text DEFAULT 'sent'::text NOT NULL,
    error text,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT newsletter_sends_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'failed'::text])))
);


--
-- Name: newsletter_subscribers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.newsletter_subscribers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    name text,
    subscribed_at timestamp with time zone DEFAULT now() NOT NULL,
    unsubscribed_at timestamp with time zone,
    source text,
    notes text,
    brand_id uuid,
    actor text DEFAULT 'human:operator'::text NOT NULL
);


--
-- Name: platforms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platforms (
    id text NOT NULL,
    name text NOT NULL,
    max_title_chars integer,
    max_body_chars integer,
    max_hashtags integer,
    supports_media boolean DEFAULT true NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    notes text,
    supports_rich_text boolean DEFAULT false NOT NULL
);


--
-- Name: post_analytics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_analytics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    platform_id text DEFAULT 'linkedin'::text NOT NULL,
    impressions integer DEFAULT 0 NOT NULL,
    unique_impressions integer DEFAULT 0 NOT NULL,
    likes integer DEFAULT 0 NOT NULL,
    comments integer DEFAULT 0 NOT NULL,
    shares integer DEFAULT 0 NOT NULL,
    clicks integer DEFAULT 0 NOT NULL,
    engagement_rate numeric(6,4),
    raw_stats jsonb DEFAULT '{}'::jsonb NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: post_engagements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_engagements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    platform_id text NOT NULL,
    engagement_type text NOT NULL,
    author_handle text,
    author_name text,
    content text,
    external_id text,
    external_url text,
    replied boolean DEFAULT false NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    occurred_at timestamp with time zone
);


--
-- Name: post_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    version integer NOT NULL,
    title text,
    body text NOT NULL,
    hashtags text[] DEFAULT '{}'::text[] NOT NULL,
    edited_by text DEFAULT 'human'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor text DEFAULT 'human:operator'::text NOT NULL,
    body_html text,
    CONSTRAINT post_versions_edited_by_check CHECK ((edited_by = ANY (ARRAY['human'::text, 'ai'::text, 'import'::text])))
);


--
-- Name: posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    content_group_id uuid NOT NULL,
    platform_id text NOT NULL,
    title text,
    body text DEFAULT ''::text NOT NULL,
    char_count integer GENERATED ALWAYS AS (char_length(body)) STORED,
    hashtags text[] DEFAULT '{}'::text[] NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    posted_at timestamp with time zone,
    posted_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    linkedin_urn text,
    thread_index integer,
    thread_group_id uuid,
    actor text DEFAULT 'human:operator'::text NOT NULL,
    body_html text,
    CONSTRAINT posts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'queued'::text, 'scheduled'::text, 'ready'::text, 'posted'::text, 'archived'::text])))
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    key text NOT NULL,
    value jsonb NOT NULL,
    description text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by text DEFAULT 'system'::text NOT NULL
);


--
-- Name: settings_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    old_value jsonb,
    new_value jsonb,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    changed_by text DEFAULT 'system'::text NOT NULL
);


--
-- Name: tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: topics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.topics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    color text,
    sort_order integer DEFAULT 100 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: voice_samples; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voice_samples (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    platform_id text,
    body text NOT NULL,
    is_published boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    excluded boolean DEFAULT false NOT NULL,
    source text,
    brand_id uuid,
    actor text DEFAULT 'human:operator'::text NOT NULL
);


--
-- Name: accounts accounts_brand_platform_blotato_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_brand_platform_blotato_unique UNIQUE (brand_id, platform, external_id, external_subaccount_id);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_platform_external_id_external_subaccount_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_platform_external_id_external_subaccount_id_key UNIQUE (platform, external_id, external_subaccount_id);


--
-- Name: brands brands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_pkey PRIMARY KEY (id);


--
-- Name: brands brands_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_slug_key UNIQUE (slug);


--
-- Name: broadside_schema_version broadside_schema_version_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadside_schema_version
    ADD CONSTRAINT broadside_schema_version_pkey PRIMARY KEY (version);


--
-- Name: content_group_tags content_group_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_group_tags
    ADD CONSTRAINT content_group_tags_pkey PRIMARY KEY (content_group_id, tag_id);


--
-- Name: content_groups content_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_groups
    ADD CONSTRAINT content_groups_pkey PRIMARY KEY (id);


--
-- Name: content_pillars content_pillars_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_pillars
    ADD CONSTRAINT content_pillars_pkey PRIMARY KEY (id);


--
-- Name: content_pillars content_pillars_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_pillars
    ADD CONSTRAINT content_pillars_slug_key UNIQUE (slug);


--
-- Name: context_embeddings context_embeddings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.context_embeddings
    ADD CONSTRAINT context_embeddings_pkey PRIMARY KEY (context_item_id);


--
-- Name: context_items context_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.context_items
    ADD CONSTRAINT context_items_pkey PRIMARY KEY (id);


--
-- Name: context_items context_items_source_id_external_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.context_items
    ADD CONSTRAINT context_items_source_id_external_id_key UNIQUE (source_id, external_id);


--
-- Name: context_sources context_sources_kind_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.context_sources
    ADD CONSTRAINT context_sources_kind_name_key UNIQUE (kind, name);


--
-- Name: context_sources context_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.context_sources
    ADD CONSTRAINT context_sources_pkey PRIMARY KEY (id);


--
-- Name: draft_candidates draft_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_candidates
    ADD CONSTRAINT draft_candidates_pkey PRIMARY KEY (id);


--
-- Name: draft_generations draft_generations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_generations
    ADD CONSTRAINT draft_generations_pkey PRIMARY KEY (id);


--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);


--
-- Name: linkedin_tokens linkedin_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.linkedin_tokens
    ADD CONSTRAINT linkedin_tokens_pkey PRIMARY KEY (id);


--
-- Name: media_assets media_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_assets
    ADD CONSTRAINT media_assets_pkey PRIMARY KEY (id);


--
-- Name: media media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_pkey PRIMARY KEY (id);


--
-- Name: newsletter_sends newsletter_sends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_sends
    ADD CONSTRAINT newsletter_sends_pkey PRIMARY KEY (id);


--
-- Name: newsletter_sends newsletter_sends_post_id_subscriber_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_sends
    ADD CONSTRAINT newsletter_sends_post_id_subscriber_id_key UNIQUE (post_id, subscriber_id);


--
-- Name: newsletter_subscribers newsletter_subscribers_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_subscribers
    ADD CONSTRAINT newsletter_subscribers_email_key UNIQUE (email);


--
-- Name: newsletter_subscribers newsletter_subscribers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_subscribers
    ADD CONSTRAINT newsletter_subscribers_pkey PRIMARY KEY (id);


--
-- Name: platforms platforms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platforms
    ADD CONSTRAINT platforms_pkey PRIMARY KEY (id);


--
-- Name: post_analytics post_analytics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_analytics
    ADD CONSTRAINT post_analytics_pkey PRIMARY KEY (id);


--
-- Name: post_analytics post_analytics_post_id_platform_id_fetched_at_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_analytics
    ADD CONSTRAINT post_analytics_post_id_platform_id_fetched_at_key UNIQUE (post_id, platform_id, fetched_at);


--
-- Name: post_engagements post_engagements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_engagements
    ADD CONSTRAINT post_engagements_pkey PRIMARY KEY (id);


--
-- Name: post_engagements post_engagements_post_id_platform_id_external_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_engagements
    ADD CONSTRAINT post_engagements_post_id_platform_id_external_id_key UNIQUE (post_id, platform_id, external_id);


--
-- Name: post_versions post_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_versions
    ADD CONSTRAINT post_versions_pkey PRIMARY KEY (id);


--
-- Name: post_versions post_versions_post_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_versions
    ADD CONSTRAINT post_versions_post_id_version_key UNIQUE (post_id, version);


--
-- Name: posts posts_content_group_id_platform_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_content_group_id_platform_id_key UNIQUE (content_group_id, platform_id);


--
-- Name: posts posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (id);


--
-- Name: settings_audit settings_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings_audit
    ADD CONSTRAINT settings_audit_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (key);


--
-- Name: tags tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);


--
-- Name: tags tags_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_slug_key UNIQUE (slug);


--
-- Name: topics topics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topics
    ADD CONSTRAINT topics_pkey PRIMARY KEY (id);


--
-- Name: topics topics_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.topics
    ADD CONSTRAINT topics_slug_key UNIQUE (slug);


--
-- Name: voice_samples voice_samples_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_samples
    ADD CONSTRAINT voice_samples_pkey PRIMARY KEY (id);


--
-- Name: idx_accounts_brand; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_brand ON public.accounts USING btree (brand_id);


--
-- Name: idx_accounts_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_enabled ON public.accounts USING btree (enabled) WHERE (enabled = true);


--
-- Name: idx_accounts_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_platform ON public.accounts USING btree (platform);


--
-- Name: idx_brands_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_brands_sort ON public.brands USING btree (sort_order, slug);


--
-- Name: idx_content_groups_brand; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_content_groups_brand ON public.content_groups USING btree (brand_id);


--
-- Name: idx_content_groups_evergreen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_content_groups_evergreen ON public.content_groups USING btree (is_evergreen, last_recycled_at) WHERE (is_evergreen = true);


--
-- Name: idx_content_groups_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_content_groups_parent ON public.content_groups USING btree (parent_group_id) WHERE (parent_group_id IS NOT NULL);


--
-- Name: idx_content_groups_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_content_groups_scheduled ON public.content_groups USING btree (scheduled_at) WHERE (scheduled_at IS NOT NULL);


--
-- Name: idx_content_groups_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_content_groups_status ON public.content_groups USING btree (status);


--
-- Name: idx_content_groups_topic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_content_groups_topic ON public.content_groups USING btree (topic_id);


--
-- Name: idx_content_groups_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_content_groups_updated_at ON public.content_groups USING btree (updated_at DESC);


--
-- Name: idx_context_items_calendar; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_context_items_calendar ON public.context_items USING btree (occurred_at) WHERE (kind = 'calendar_event'::text);


--
-- Name: idx_context_items_content_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_context_items_content_trgm ON public.context_items USING gin (content public.gin_trgm_ops);


--
-- Name: idx_context_items_external; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_context_items_external ON public.context_items USING btree (occurred_at DESC) WHERE (kind = 'external_signal'::text);


--
-- Name: idx_context_items_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_context_items_kind ON public.context_items USING btree (kind);


--
-- Name: idx_context_items_occurred_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_context_items_occurred_at ON public.context_items USING btree (occurred_at DESC NULLS LAST);


--
-- Name: idx_context_items_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_context_items_source ON public.context_items USING btree (source_id, occurred_at DESC NULLS LAST);


--
-- Name: idx_context_items_title_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_context_items_title_trgm ON public.context_items USING gin (title public.gin_trgm_ops);


--
-- Name: idx_context_items_topic_scores; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_context_items_topic_scores ON public.context_items USING gin (topic_scores) WHERE (topic_scores IS NOT NULL);


--
-- Name: idx_context_sources_brand; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_context_sources_brand ON public.context_sources USING btree (brand_id);


--
-- Name: idx_draft_candidates_generation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_draft_candidates_generation ON public.draft_candidates USING btree (generation_id);


--
-- Name: idx_draft_candidates_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_draft_candidates_pending ON public.draft_candidates USING btree (created_at DESC) WHERE ((NOT accepted) AND (NOT rejected));


--
-- Name: idx_draft_generations_brand; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_draft_generations_brand ON public.draft_generations USING btree (brand_id);


--
-- Name: idx_draft_generations_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_draft_generations_created_at ON public.draft_generations USING btree (created_at DESC);


--
-- Name: idx_draft_generations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_draft_generations_status ON public.draft_generations USING btree (status);


--
-- Name: idx_jobs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_created_at ON public.jobs USING btree (created_at DESC);


--
-- Name: idx_jobs_kind_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_kind_created ON public.jobs USING btree (kind, created_at DESC);


--
-- Name: idx_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jobs_status ON public.jobs USING btree (status);


--
-- Name: idx_media_assets_brand; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_assets_brand ON public.media_assets USING btree (brand_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_media_assets_slot_current; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_assets_slot_current ON public.media_assets USING btree (use_case, platform, brand_id, is_current) WHERE (deleted_at IS NULL);


--
-- Name: idx_media_assets_source_label; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_assets_source_label ON public.media_assets USING btree (source_label) WHERE (deleted_at IS NULL);


--
-- Name: idx_media_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_group ON public.media USING btree (content_group_id);


--
-- Name: idx_newsletter_sends_post; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_newsletter_sends_post ON public.newsletter_sends USING btree (post_id);


--
-- Name: idx_newsletter_subscribers_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_newsletter_subscribers_active ON public.newsletter_subscribers USING btree (subscribed_at DESC) WHERE (unsubscribed_at IS NULL);


--
-- Name: idx_newsletter_subscribers_brand; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_newsletter_subscribers_brand ON public.newsletter_subscribers USING btree (brand_id);


--
-- Name: idx_post_analytics_fetched; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_post_analytics_fetched ON public.post_analytics USING btree (fetched_at DESC);


--
-- Name: idx_post_analytics_post; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_post_analytics_post ON public.post_analytics USING btree (post_id, fetched_at DESC);


--
-- Name: idx_post_engagements_unreplied; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_post_engagements_unreplied ON public.post_engagements USING btree (post_id, fetched_at DESC) WHERE (NOT replied);


--
-- Name: idx_post_versions_post; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_post_versions_post ON public.post_versions USING btree (post_id, version DESC);


--
-- Name: idx_posts_body_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_body_trgm ON public.posts USING gin (body public.gin_trgm_ops);


--
-- Name: idx_posts_linkedin_urn; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_linkedin_urn ON public.posts USING btree (linkedin_urn) WHERE (linkedin_urn IS NOT NULL);


--
-- Name: idx_posts_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_platform ON public.posts USING btree (platform_id);


--
-- Name: idx_posts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_status ON public.posts USING btree (status);


--
-- Name: idx_posts_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_posts_thread ON public.posts USING btree (thread_group_id) WHERE (thread_group_id IS NOT NULL);


--
-- Name: idx_settings_audit_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_settings_audit_key ON public.settings_audit USING btree (key, changed_at DESC);


--
-- Name: idx_voice_samples_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voice_samples_active ON public.voice_samples USING btree (excluded) WHERE (excluded = false);


--
-- Name: idx_voice_samples_brand; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voice_samples_brand ON public.voice_samples USING btree (brand_id);


--
-- Name: accounts trg_accounts_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_accounts_updated BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: brands trg_brands_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_brands_updated BEFORE UPDATE ON public.brands FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: content_groups trg_content_groups_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_content_groups_updated BEFORE UPDATE ON public.content_groups FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: media_assets trg_media_assets_touch_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_media_assets_touch_updated_at BEFORE UPDATE ON public.media_assets FOR EACH ROW EXECUTE FUNCTION public.media_assets_touch_updated_at();


--
-- Name: posts trg_posts_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_posts_updated BEFORE UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: topics trg_topics_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_topics_updated BEFORE UPDATE ON public.topics FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: accounts accounts_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE RESTRICT;


--
-- Name: accounts accounts_parent_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_parent_account_id_fkey FOREIGN KEY (parent_account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;


--
-- Name: content_group_tags content_group_tags_content_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_group_tags
    ADD CONSTRAINT content_group_tags_content_group_id_fkey FOREIGN KEY (content_group_id) REFERENCES public.content_groups(id) ON DELETE CASCADE;


--
-- Name: content_group_tags content_group_tags_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_group_tags
    ADD CONSTRAINT content_group_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;


--
-- Name: content_groups content_groups_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_groups
    ADD CONSTRAINT content_groups_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE SET NULL;


--
-- Name: content_groups content_groups_parent_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_groups
    ADD CONSTRAINT content_groups_parent_group_id_fkey FOREIGN KEY (parent_group_id) REFERENCES public.content_groups(id) ON DELETE SET NULL;


--
-- Name: content_groups content_groups_topic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_groups
    ADD CONSTRAINT content_groups_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON DELETE SET NULL;


--
-- Name: content_pillars content_pillars_topic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_pillars
    ADD CONSTRAINT content_pillars_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON DELETE SET NULL;


--
-- Name: context_embeddings context_embeddings_context_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.context_embeddings
    ADD CONSTRAINT context_embeddings_context_item_id_fkey FOREIGN KEY (context_item_id) REFERENCES public.context_items(id) ON DELETE CASCADE;


--
-- Name: context_items context_items_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.context_items
    ADD CONSTRAINT context_items_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.context_sources(id) ON DELETE CASCADE;


--
-- Name: context_sources context_sources_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.context_sources
    ADD CONSTRAINT context_sources_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE SET NULL;


--
-- Name: draft_candidates draft_candidates_content_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_candidates
    ADD CONSTRAINT draft_candidates_content_group_id_fkey FOREIGN KEY (content_group_id) REFERENCES public.content_groups(id) ON DELETE SET NULL;


--
-- Name: draft_candidates draft_candidates_generation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_candidates
    ADD CONSTRAINT draft_candidates_generation_id_fkey FOREIGN KEY (generation_id) REFERENCES public.draft_generations(id) ON DELETE CASCADE;


--
-- Name: draft_generations draft_generations_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_generations
    ADD CONSTRAINT draft_generations_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE SET NULL;


--
-- Name: media_assets media_assets_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_assets
    ADD CONSTRAINT media_assets_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE SET NULL;


--
-- Name: media media_content_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media
    ADD CONSTRAINT media_content_group_id_fkey FOREIGN KEY (content_group_id) REFERENCES public.content_groups(id) ON DELETE CASCADE;


--
-- Name: newsletter_sends newsletter_sends_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_sends
    ADD CONSTRAINT newsletter_sends_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: newsletter_sends newsletter_sends_subscriber_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_sends
    ADD CONSTRAINT newsletter_sends_subscriber_id_fkey FOREIGN KEY (subscriber_id) REFERENCES public.newsletter_subscribers(id) ON DELETE CASCADE;


--
-- Name: newsletter_subscribers newsletter_subscribers_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_subscribers
    ADD CONSTRAINT newsletter_subscribers_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE SET NULL;


--
-- Name: post_analytics post_analytics_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_analytics
    ADD CONSTRAINT post_analytics_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: post_engagements post_engagements_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_engagements
    ADD CONSTRAINT post_engagements_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: post_versions post_versions_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_versions
    ADD CONSTRAINT post_versions_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;


--
-- Name: posts posts_content_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_content_group_id_fkey FOREIGN KEY (content_group_id) REFERENCES public.content_groups(id) ON DELETE CASCADE;


--
-- Name: posts posts_platform_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_platform_id_fkey FOREIGN KEY (platform_id) REFERENCES public.platforms(id);


--
-- Name: voice_samples voice_samples_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_samples
    ADD CONSTRAINT voice_samples_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE SET NULL;


--
-- Name: voice_samples voice_samples_platform_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_samples
    ADD CONSTRAINT voice_samples_platform_id_fkey FOREIGN KEY (platform_id) REFERENCES public.platforms(id);


--
-- PostgreSQL database dump complete
--

