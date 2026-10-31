-- SPDX-License-Identifier: AGPL-3.0-only
-- Migration date: 2026-10-31
-- Keep each catalog workflow's licence, credit, source and notices with the
-- catalog row, and the licence, credit and source with every editable copy
-- made from it. The deprecated workflow_addons table is not touched.

alter table public.mike_workflows
  add column if not exists license text,
  add column if not exists license_evidence text,
  add column if not exists author_confirmation text,
  add column if not exists attribution text,
  add column if not exists provenance jsonb,
  add column if not exists notice_md text,
  add column if not exists changes_md text;

alter table public.mike_workflows
  drop constraint if exists mike_workflows_license_evidence_check;
alter table public.mike_workflows
  add constraint mike_workflows_license_evidence_check
  check (
    license_evidence is null
    or license_evidence in ('file', 'manifest-only')
  );

alter table public.mike_workflows
  drop constraint if exists mike_workflows_provenance_check;
alter table public.mike_workflows
  add constraint mike_workflows_provenance_check
  check (provenance is null or jsonb_typeof(provenance) = 'object');

-- An editable copy remembers which catalog workflow and version it was made
-- from, and keeps that workflow's licence, credit and source read-only.
alter table public.workflows
  add column if not exists catalog_workflow_key text,
  add column if not exists catalog_version text,
  add column if not exists license text,
  add column if not exists attribution text,
  add column if not exists provenance jsonb;

alter table public.workflows
  drop constraint if exists workflows_provenance_check;
alter table public.workflows
  add constraint workflows_provenance_check
  check (provenance is null or jsonb_typeof(provenance) = 'object');

-- Based on the definition in 20260901_03_workflow_assets_as_documents.sql,
-- which is the live one; it adds the licence and provenance fields.
create or replace function public.replace_mike_workflows(
  p_source_commit text,
  p_workflows jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  asset_item jsonb;
  asset_items jsonb;
  jurisdiction_values text[];
  workflow_uuid uuid;
begin
  if p_source_commit !~ '^[0-9a-f]{40}$' then
    raise exception 'invalid workflow catalog source commit';
  end if;
  if jsonb_typeof(p_workflows) <> 'array' then
    raise exception 'workflow catalog payload must be an array';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('mike_workflows', 0));
  update public.mike_workflows set active = false where active;

  for item in select value from jsonb_array_elements(p_workflows)
  loop
    jurisdiction_values := null;
    if jsonb_typeof(item->'jurisdictions') = 'array' then
      select array_agg(value)
        into jurisdiction_values
      from jsonb_array_elements_text(item->'jurisdictions');
    end if;

    insert into public.mike_workflows (
      workflow_key, distribution, version, title, description, type,
      prompt_md, columns_config, contributors, language, practice,
      jurisdictions, pack_key, pack_title, pack_description, pack_version,
      default_sort_order, quick_action_name, quick_action_prompt,
      document_upload, word_quick_action, word_quick_action_prompt,
      license, license_evidence, author_confirmation, attribution,
      provenance, notice_md, changes_md,
      source_commit, content_hash, active, updated_at
    ) values (
      item->>'workflow_key',
      item->>'distribution',
      nullif(item->>'version', ''),
      item->>'title',
      nullif(item->>'description', ''),
      item->>'type',
      nullif(item->>'prompt_md', ''),
      case when jsonb_typeof(item->'columns_config') = 'array'
        then item->'columns_config' else null end,
      case when jsonb_typeof(item->'contributors') = 'array'
        then item->'contributors' else '[]'::jsonb end,
      nullif(item->>'language', ''),
      nullif(item->>'practice', ''),
      jurisdiction_values,
      nullif(item->>'pack_key', ''),
      nullif(item->>'pack_title', ''),
      nullif(item->>'pack_description', ''),
      nullif(item->>'pack_version', ''),
      nullif(item->>'default_sort_order', '')::integer,
      nullif(item->>'quick_action_name', ''),
      nullif(item->>'quick_action_prompt', ''),
      coalesce((item->>'document_upload')::boolean, false),
      coalesce((item->>'word_quick_action')::boolean, false),
      nullif(item->>'word_quick_action_prompt', ''),
      nullif(item->>'license', ''),
      nullif(item->>'license_evidence', ''),
      nullif(item->>'author_confirmation', ''),
      nullif(item->>'attribution', ''),
      case when jsonb_typeof(item->'provenance') = 'object'
        then item->'provenance' else null end,
      nullif(item->>'notice_md', ''),
      nullif(item->>'changes_md', ''),
      p_source_commit,
      item->>'content_hash',
      true,
      now()
    )
    on conflict (workflow_key, content_hash) do update set
      distribution = excluded.distribution,
      version = excluded.version,
      title = excluded.title,
      description = excluded.description,
      type = excluded.type,
      prompt_md = excluded.prompt_md,
      columns_config = excluded.columns_config,
      contributors = excluded.contributors,
      language = excluded.language,
      practice = excluded.practice,
      jurisdictions = excluded.jurisdictions,
      pack_key = excluded.pack_key,
      pack_title = excluded.pack_title,
      pack_description = excluded.pack_description,
      pack_version = excluded.pack_version,
      default_sort_order = excluded.default_sort_order,
      quick_action_name = excluded.quick_action_name,
      quick_action_prompt = excluded.quick_action_prompt,
      document_upload = excluded.document_upload,
      word_quick_action = excluded.word_quick_action,
      word_quick_action_prompt = excluded.word_quick_action_prompt,
      license = excluded.license,
      license_evidence = excluded.license_evidence,
      author_confirmation = excluded.author_confirmation,
      attribution = excluded.attribution,
      provenance = excluded.provenance,
      notice_md = excluded.notice_md,
      changes_md = excluded.changes_md,
      source_commit = excluded.source_commit,
      active = true,
      updated_at = now()
    returning id into workflow_uuid;

    delete from public.mike_workflow_assets
    where mike_workflow_id = workflow_uuid;

    -- reference_files remains a rollout-only alias for catalog payloads
    -- produced immediately before workflow assets were renamed.
    asset_items := coalesce(item->'assets', item->'reference_files');
    if asset_items is not null then
      if jsonb_typeof(asset_items) <> 'array' then
        raise exception 'workflow assets must be an array';
      end if;
      for asset_item in
        select value from jsonb_array_elements(asset_items)
      loop
        insert into public.mike_workflow_assets (
          mike_workflow_id, filename, file_type, storage_path,
          size_bytes, content_hash
        ) values (
          workflow_uuid,
          asset_item->>'filename',
          asset_item->>'file_type',
          asset_item->>'storage_path',
          nullif(asset_item->>'size_bytes', '')::integer,
          asset_item->>'content_hash'
        );
      end loop;
    end if;
  end loop;
end;
$$;

revoke all on function public.replace_mike_workflows(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_mike_workflows(text, jsonb)
  to service_role;
