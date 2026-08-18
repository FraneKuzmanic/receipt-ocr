create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  source_object_path text not null
    constraint receipts_source_object_path_not_blank check (btrim(source_object_path) <> ''),
  source_original_filename text not null
    constraint receipts_source_original_filename_not_blank check (btrim(source_original_filename) <> ''),
  source_content_type text not null
    constraint receipts_source_content_type_not_blank check (btrim(source_content_type) <> ''),

  status text not null default 'processing'
    constraint receipts_status_valid check (
      status in ('processing', 'review', 'confirmed', 'failed')
    ),

  canonical_data jsonb not null default '{}'::jsonb
    constraint receipts_canonical_data_object check (jsonb_typeof(canonical_data) = 'object'),
  original_extraction jsonb,
  extraction_metadata jsonb,
  qr_extraction jsonb,
  raw_provider_result jsonb,
  warnings jsonb not null default '[]'::jsonb
    constraint receipts_warnings_array check (jsonb_typeof(warnings) = 'array'),

  seller_name text generated always as (
    nullif(btrim(canonical_data ->> 'sellerName'), '')
  ) stored,
  issue_date text generated always as (
    nullif(btrim(canonical_data ->> 'issueDate'), '')
  ) stored,
  document_number text generated always as (
    nullif(btrim(canonical_data ->> 'documentNumber'), '')
  ) stored,
  total numeric generated always as (
    case
      when canonical_data ->> 'total' ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (canonical_data ->> 'total')::numeric
      else null
    end
  ) stored,
  currency text generated always as (
    nullif(btrim(canonical_data ->> 'currency'), '')
  ) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  deleted_at timestamptz,

  constraint receipts_seller_name_shape check (
    not (canonical_data ? 'sellerName')
    or canonical_data -> 'sellerName' = 'null'::jsonb
    or jsonb_typeof(canonical_data -> 'sellerName') = 'string'
  ),
  constraint receipts_issue_date_shape check (
    not (canonical_data ? 'issueDate')
    or canonical_data -> 'issueDate' = 'null'::jsonb
    or (
      jsonb_typeof(canonical_data -> 'issueDate') = 'string'
      and canonical_data ->> 'issueDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    )
  ),
  constraint receipts_document_number_shape check (
    not (canonical_data ? 'documentNumber')
    or canonical_data -> 'documentNumber' = 'null'::jsonb
    or jsonb_typeof(canonical_data -> 'documentNumber') = 'string'
  ),
  constraint receipts_total_shape check (
    not (canonical_data ? 'total')
    or canonical_data -> 'total' = 'null'::jsonb
    or (
      jsonb_typeof(canonical_data -> 'total') = 'string'
      and canonical_data ->> 'total' ~ '^-?[0-9]+(\.[0-9]+)?$'
    )
  ),
  constraint receipts_currency_shape check (
    not (canonical_data ? 'currency')
    or canonical_data -> 'currency' = 'null'::jsonb
    or (
      jsonb_typeof(canonical_data -> 'currency') = 'string'
      and char_length(canonical_data ->> 'currency') = 3
    )
  )
);

comment on table public.receipts is
  'User-owned receipt records. canonical_data is authoritative; generated columns support list and export queries.';

revoke all on table public.receipts from anon, authenticated;
grant select, insert, update on table public.receipts to authenticated;

alter table public.receipts enable row level security;

create policy "Users can read their own receipts"
on public.receipts
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their own receipts"
on public.receipts
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own receipts"
on public.receipts
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create index receipts_active_user_created_at_idx
on public.receipts (user_id, created_at desc)
where deleted_at is null;

create policy "Users can read their own receipt sources"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'receipt-sources'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can upload their own receipt sources"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'receipt-sources'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can update their own receipt sources"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'receipt-sources'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'receipt-sources'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can delete their own receipt sources"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'receipt-sources'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
