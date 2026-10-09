-- Ayam Gebok Mas Bule: ERD dengan empat entitas.
create extension if not exists pgcrypto;

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null,
  code text not null,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.ingredients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null,
  unit text not null,
  category text not null default 'Lainnya',
  minimum_stock numeric(12,2) not null default 0 check (minimum_stock >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.branches add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table public.ingredients add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table public.branches drop constraint if exists branches_name_key;
alter table public.branches drop constraint if exists branches_code_key;
alter table public.ingredients drop constraint if exists ingredients_name_key;
create unique index if not exists branches_owner_name_idx on public.branches(owner_id, name);
create unique index if not exists branches_owner_code_idx on public.branches(owner_id, code);
create unique index if not exists ingredients_owner_name_idx on public.ingredients(owner_id, name);

create table if not exists public.stock_items (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  quantity numeric(12,2) not null default 0 check (quantity >= 0),
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  updated_at timestamptz not null default now(),
  unique (branch_id, ingredient_id)
);

create table if not exists public.cost_entries (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  ingredient_id uuid references public.ingredients(id) on delete set null,
  entry_type text not null check (entry_type in ('purchase','usage','operational')),
  description text not null,
  quantity numeric(12,2) check (quantity is null or quantity > 0),
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index if not exists stock_items_branch_idx on public.stock_items(branch_id);
create index if not exists cost_entries_branch_date_idx on public.cost_entries(branch_id, created_at desc);

-- Bahan baru otomatis tersedia di daftar stok untuk semua cabang.
create or replace function public.create_stock_rows_for_ingredient()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.stock_items(branch_id, ingredient_id)
  select id, new.id from public.branches where is_active and owner_id = new.owner_id
  on conflict (branch_id, ingredient_id) do nothing;
  return new;
end;
$$;
drop trigger if exists ingredients_create_stock_rows on public.ingredients;
create trigger ingredients_create_stock_rows
  after insert on public.ingredients
  for each row execute function public.create_stock_rows_for_ingredient();

-- Perubahan stok dan pencatatan cost atomik; biaya stok keluar memakai moving average.
create or replace function public.adjust_stock(
  p_branch_id uuid,
  p_ingredient_id uuid,
  p_direction text,
  p_quantity numeric,
  p_unit_cost numeric default 0
)
returns public.stock_items language plpgsql security definer set search_path = public as $$
declare
  stock_row public.stock_items;
  ingredient_label text;
  next_quantity numeric(12,2);
  next_unit_cost numeric(14,2);
  cost_amount numeric(14,2);
begin
  if p_direction not in ('in','out') then raise exception 'Jenis transaksi stok tidak valid.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Jumlah harus lebih dari nol.'; end if;
  if p_unit_cost is null or p_unit_cost < 0 or (p_direction = 'in' and p_unit_cost <= 0) then raise exception 'Harga satuan tidak valid.'; end if;
  if auth.uid() is null or not exists (select 1 from public.branches where id = p_branch_id and owner_id = auth.uid() and is_active) then
    raise exception 'Cabang tidak ditemukan atau akses ditolak.';
  end if;
  if not exists (select 1 from public.ingredients where id = p_ingredient_id and owner_id = auth.uid() and is_active) then
    raise exception 'Bahan tidak ditemukan atau akses ditolak.';
  end if;

  insert into public.stock_items(branch_id, ingredient_id)
  values (p_branch_id, p_ingredient_id) on conflict (branch_id, ingredient_id) do nothing;
  select * into stock_row from public.stock_items
  where branch_id = p_branch_id and ingredient_id = p_ingredient_id for update;
  select name into ingredient_label from public.ingredients where id = p_ingredient_id and is_active;
  if ingredient_label is null then raise exception 'Bahan tidak ditemukan atau tidak aktif.'; end if;
  if p_direction = 'out' and stock_row.quantity < p_quantity then raise exception 'Stok tidak mencukupi.'; end if;

  if p_direction = 'in' then
    next_quantity := stock_row.quantity + p_quantity;
    next_unit_cost := ((stock_row.quantity * stock_row.unit_cost) + (p_quantity * p_unit_cost)) / next_quantity;
    cost_amount := p_quantity * p_unit_cost;
  else
    next_quantity := stock_row.quantity - p_quantity;
    next_unit_cost := stock_row.unit_cost;
    cost_amount := p_quantity * stock_row.unit_cost;
  end if;
  update public.stock_items set quantity = next_quantity, unit_cost = next_unit_cost, updated_at = now()
  where id = stock_row.id returning * into stock_row;
  insert into public.cost_entries(branch_id, ingredient_id, entry_type, description, quantity, amount)
  values (p_branch_id, p_ingredient_id, case when p_direction = 'in' then 'purchase' else 'usage' end,
    case when p_direction = 'in' then 'Pembelian ' else 'Pemakaian ' end || ingredient_label, p_quantity, cost_amount);
  return stock_row;
end;
$$;

alter table public.branches enable row level security;
alter table public.ingredients enable row level security;
alter table public.stock_items enable row level security;
alter table public.cost_entries enable row level security;

drop policy if exists branches_owner_select on public.branches;
drop policy if exists branches_owner_insert on public.branches;
drop policy if exists branches_owner_update on public.branches;
drop policy if exists branches_owner_delete on public.branches;
create policy branches_owner_select on public.branches for select to authenticated using (owner_id = auth.uid());
create policy branches_owner_insert on public.branches for insert to authenticated with check (owner_id = auth.uid());
create policy branches_owner_update on public.branches for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy branches_owner_delete on public.branches for delete to authenticated using (owner_id = auth.uid());

drop policy if exists ingredients_owner_select on public.ingredients;
drop policy if exists ingredients_owner_insert on public.ingredients;
drop policy if exists ingredients_owner_update on public.ingredients;
drop policy if exists ingredients_owner_delete on public.ingredients;
create policy ingredients_owner_select on public.ingredients for select to authenticated using (owner_id = auth.uid());
create policy ingredients_owner_insert on public.ingredients for insert to authenticated with check (owner_id = auth.uid());
create policy ingredients_owner_update on public.ingredients for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy ingredients_owner_delete on public.ingredients for delete to authenticated using (owner_id = auth.uid());

drop policy if exists stock_items_owner_select on public.stock_items;
create policy stock_items_owner_select on public.stock_items for select to authenticated using (
  exists (select 1 from public.branches b where b.id = branch_id and b.owner_id = auth.uid())
  and exists (select 1 from public.ingredients i where i.id = ingredient_id and i.owner_id = auth.uid())
);

drop policy if exists cost_entries_owner_select on public.cost_entries;
drop policy if exists cost_entries_owner_insert on public.cost_entries;
drop policy if exists cost_entries_owner_update on public.cost_entries;
drop policy if exists cost_entries_owner_delete on public.cost_entries;
create policy cost_entries_owner_select on public.cost_entries for select to authenticated using (
  exists (select 1 from public.branches b where b.id = branch_id and b.owner_id = auth.uid())
);
create policy cost_entries_owner_insert on public.cost_entries for insert to authenticated with check (
  exists (select 1 from public.branches b where b.id = branch_id and b.owner_id = auth.uid())
  and (ingredient_id is null or exists (select 1 from public.ingredients i where i.id = ingredient_id and i.owner_id = auth.uid()))
);
create policy cost_entries_owner_update on public.cost_entries for update to authenticated using (
  entry_type = 'operational' and exists (select 1 from public.branches b where b.id = branch_id and b.owner_id = auth.uid())
) with check (
  entry_type = 'operational' and exists (select 1 from public.branches b where b.id = branch_id and b.owner_id = auth.uid())
);
create policy cost_entries_owner_delete on public.cost_entries for delete to authenticated using (
  entry_type = 'operational' and exists (select 1 from public.branches b where b.id = branch_id and b.owner_id = auth.uid())
);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.branches, public.ingredients, public.cost_entries to authenticated;
grant select on public.stock_items to authenticated;
revoke insert, update, delete on public.stock_items from anon, authenticated;
revoke all on function public.adjust_stock(uuid,uuid,text,numeric,numeric) from public, anon, service_role;
grant execute on function public.adjust_stock(uuid,uuid,text,numeric,numeric) to authenticated;

create or replace function public.create_default_inventory_for_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.branches(owner_id, name, code, address) values
    (new.id, 'Gayamsari', 'GYS', 'Semarang'),
    (new.id, 'Ngaliyan', 'NGL', 'Semarang'),
    (new.id, 'Pedurungan', 'PDR', 'Semarang')
  on conflict (owner_id, code) do nothing;

  insert into public.ingredients(owner_id, name, unit, category, minimum_stock) values
    (new.id, 'Ayam potong', 'kg', 'Protein', 5),
    (new.id, 'Beras', 'kg', 'Pokok', 8),
    (new.id, 'Minyak goreng', 'liter', 'Bumbu', 4),
    (new.id, 'Cabai rawit', 'kg', 'Bumbu', 1),
    (new.id, 'Tepung bumbu', 'kg', 'Bumbu', 3),
    (new.id, 'Gas LPG', 'tabung', 'Operasional', 2)
  on conflict (owner_id, name) do nothing;

  return new;
end;
$$;
drop trigger if exists auth_user_create_default_inventory on auth.users;
create trigger auth_user_create_default_inventory
  after insert on auth.users
  for each row execute function public.create_default_inventory_for_user();

-- Siapkan data awal juga untuk akun Auth yang sudah ada sebelum trigger dipasang.
insert into public.branches(owner_id, name, code, address)
select users.id, defaults.name, defaults.code, 'Semarang'
from auth.users as users
cross join (values
  ('Gayamsari'::text, 'GYS'::text),
  ('Ngaliyan', 'NGL'),
  ('Pedurungan', 'PDR')
) as defaults(name, code)
where true
on conflict (owner_id, code) do nothing;

insert into public.ingredients(owner_id, name, unit, category, minimum_stock)
select users.id, defaults.name, defaults.unit, defaults.category, defaults.minimum_stock
from auth.users as users
cross join (values
  ('Ayam potong'::text, 'kg'::text, 'Protein'::text, 5::numeric),
  ('Beras', 'kg', 'Pokok', 8),
  ('Minyak goreng', 'liter', 'Bumbu', 4),
  ('Cabai rawit', 'kg', 'Bumbu', 1),
  ('Tepung bumbu', 'kg', 'Bumbu', 3),
  ('Gas LPG', 'tabung', 'Operasional', 2)
) as defaults(name, unit, category, minimum_stock)
where true
on conflict (owner_id, name) do nothing;
