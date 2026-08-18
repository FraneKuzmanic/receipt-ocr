begin;

create extension if not exists pgtap with schema extensions;

select plan(33);

select has_table('public', 'receipts', 'receipts table exists');

select is(
  (select count(*)::integer from information_schema.columns where table_schema = 'public' and table_name = 'receipts'),
  21,
  'receipts has the expected number of columns'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.receipts'::regclass),
  'row level security is enabled'
);

select is(
  (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'receipts' and column_name = 'id'),
  'uuid',
  'receipt id is uuid'
);

select is(
  (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'receipts' and column_name = 'total'),
  'numeric',
  'promoted total is exact numeric'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.receipts'::regclass
      and contype = 'f'
      and confrelid = 'auth.users'::regclass
      and confdeltype = 'c'
  ),
  'user foreign key cascades on auth user deletion'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'receipts'
      and is_generated = 'ALWAYS'
  ),
  5,
  'five promoted columns are generated'
);

select ok(
  (
    select indexdef ilike '%(user_id, created_at desc)%where (deleted_at is null)%'
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'receipts_active_user_created_at_idx'
  ),
  'active history index matches the repository query'
);

select ok(has_table_privilege('authenticated', 'public.receipts', 'select'), 'authenticated can select');
select ok(has_table_privilege('authenticated', 'public.receipts', 'insert'), 'authenticated can insert');
select ok(has_table_privilege('authenticated', 'public.receipts', 'update'), 'authenticated can update');
select ok(not has_table_privilege('authenticated', 'public.receipts', 'delete'), 'authenticated cannot hard delete');
select ok(not has_table_privilege('anon', 'public.receipts', 'select'), 'anon cannot select');

select is(
  (select count(*)::integer from pg_policies where schemaname = 'public' and tablename = 'receipts'),
  3,
  'receipts has select, insert, and update policies only'
);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname like 'Users can % their own receipt sources'
  ),
  4,
  'storage objects has four receipt-source policies'
);

insert into auth.users (id, email)
values
  ('11111111-1111-4111-8111-111111111111', 'receipt-user-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'receipt-user-b@example.test');

select throws_ok(
  $$
    insert into public.receipts (
      user_id, source_object_path, source_original_filename, source_content_type, status
    ) values (
      '11111111-1111-4111-8111-111111111111', 'a/source', 'receipt.jpg', 'image/jpeg', 'pending'
    )
  $$,
  '23514',
  'new row for relation "receipts" violates check constraint "receipts_status_valid"',
  'invalid status is rejected'
);

select throws_ok(
  $$
    insert into public.receipts (
      user_id, source_object_path, source_original_filename, source_content_type, canonical_data
    ) values (
      '11111111-1111-4111-8111-111111111111', 'a/source', 'receipt.jpg', 'image/jpeg', '[]'
    )
  $$,
  '23514',
  'new row for relation "receipts" violates check constraint "receipts_canonical_data_object"',
  'canonical data must be an object'
);

select throws_ok(
  $$
    insert into public.receipts (
      user_id, source_object_path, source_original_filename, source_content_type, warnings
    ) values (
      '11111111-1111-4111-8111-111111111111', 'a/source', 'receipt.jpg', 'image/jpeg', '{}'
    )
  $$,
  '23514',
  'new row for relation "receipts" violates check constraint "receipts_warnings_array"',
  'warnings must be an array'
);

select throws_ok(
  $$
    insert into public.receipts (
      user_id, source_object_path, source_original_filename, source_content_type, canonical_data
    ) values (
      '11111111-1111-4111-8111-111111111111', 'a/source', 'receipt.jpg', 'image/jpeg', '{"total":"1.234,56"}'
    )
  $$,
  '23514',
  'new row for relation "receipts" violates check constraint "receipts_total_shape"',
  'unnormalized total is rejected'
);

select throws_ok(
  $$
    insert into public.receipts (
      user_id, source_object_path, source_original_filename, source_content_type, total
    ) values (
      '11111111-1111-4111-8111-111111111111', 'a/source', 'receipt.jpg', 'image/jpeg', 100.50
    )
  $$,
  '428C9',
  'cannot insert a non-DEFAULT value into column "total"',
  'generated projections cannot be inserted directly'
);

insert into public.receipts (
  id,
  user_id,
  source_object_path,
  source_original_filename,
  source_content_type,
  canonical_data
)
values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/source',
    'receipt-a.jpg',
    'image/jpeg',
    '{"sellerName":"Seller A","documentNumber":"A-1","issueDate":"2026-08-17","total":"100.50","currency":"EUR"}'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '11111111-1111-4111-8111-111111111111',
    '11111111-1111-4111-8111-111111111111/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/source',
    'receipt-leading-zero.jpg',
    'image/jpeg',
    '{"total":"007"}'
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    '22222222-2222-4222-8222-222222222222',
    '22222222-2222-4222-8222-222222222222/cccccccc-cccc-4ccc-8ccc-cccccccccccc/source',
    'receipt-b.jpg',
    'image/jpeg',
    '{}'
  );

select throws_ok(
  $$
    update public.receipts
    set total = 1
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  $$,
  '428C9',
  'column "total" can only be updated to DEFAULT',
  'generated projections cannot be updated directly'
);

select results_eq(
  $$
    select
      canonical_data ->> 'total',
      total::text,
      seller_name,
      document_number,
      issue_date,
      currency
    from public.receipts
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  $$,
  $$ values ('100.50', '100.50', 'Seller A', 'A-1', '2026-08-17', 'EUR') $$,
  'canonical and promoted values round-trip exactly'
);

select results_eq(
  $$
    select canonical_data ->> 'total', total::text
    from public.receipts
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  $$,
  $$ values ('007', '7') $$,
  'canonical leading zeros remain exact while numeric projection is normalized'
);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select results_eq(
  'select count(*) from public.receipts',
  array[2::bigint],
  'user A reads only their receipts'
);

select lives_ok(
  $$
    insert into public.receipts (
      id, user_id, source_object_path, source_original_filename, source_content_type
    ) values (
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111/dddddddd-dddd-4ddd-8ddd-dddddddddddd/source',
      'owner.jpg',
      'image/jpeg'
    )
  $$,
  'user A can create their own receipt'
);

select lives_ok(
  $$
    update public.receipts
    set deleted_at = now()
    where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  $$,
  'user A can soft delete their own receipt'
);

select throws_ok(
  $$
    update public.receipts
    set user_id = '22222222-2222-4222-8222-222222222222'
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  $$,
  '42501',
  'new row violates row-level security policy for table "receipts"',
  'ownership reassignment is rejected'
);

set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

select results_eq(
  'select count(*) from public.receipts',
  array[1::bigint],
  'user B cannot read user A receipts'
);

select results_eq(
  $$
    update public.receipts
    set status = 'review'
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    returning 1
  $$,
  $$ values (1) limit 0 $$,
  'user B cannot update a user A receipt'
);

select throws_ok(
  $$
    insert into public.receipts (
      user_id, source_object_path, source_original_filename, source_content_type
    ) values (
      '11111111-1111-4111-8111-111111111111', 'wrong-owner/source', 'wrong.jpg', 'image/jpeg'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "receipts"',
  'user B cannot insert a receipt for user A'
);

select throws_ok(
  $$ delete from public.receipts where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' $$,
  '42501',
  'permission denied for table receipts',
  'authenticated users cannot hard delete receipts'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.receipts
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and user_id = '11111111-1111-4111-8111-111111111111'
  ),
  1,
  'failed ownership reassignment left the owner unchanged'
);

select is(
  (
    select count(*)::integer
    from public.receipts
    where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
      and deleted_at is not null
  ),
  1,
  'soft delete persists deleted_at'
);

select * from finish();
rollback;
