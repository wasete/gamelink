-- GameLink schema for Supabase
-- Run in Supabase Dashboard > SQL Editor.
-- IMPORTANT: after creating your account, set the first admin role manually using the SQL below.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null default 'عضو',
  role text not null default 'member' check (role in ('member','assistant','admin')),
  banned boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles(id, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1), 'عضو'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create table if not exists public.public_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  username text not null,
  content text not null check (char_length(content) between 1 and 1000),
  created_at timestamptz not null default now()
);

create table if not exists public.listings (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  game text not null default 'بازی',
  description text not null default '',
  status text not null default 'active' check (status in ('active','closed','removed')),
  created_at timestamptz not null default now()
);

create table if not exists public.trade_rooms (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  invite_code text not null unique,
  creator_id uuid not null references public.profiles(id),
  buyer_username text not null,
  seller_username text not null,
  status text not null default 'active' check (status in ('active','closed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.trade_room_members (
  room_id uuid not null references public.trade_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key(room_id,user_id)
);

create table if not exists public.trade_messages (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.trade_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  username text not null,
  content text not null check (char_length(content) between 1 and 1000),
  created_at timestamptz not null default now()
);

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role in ('admin','assistant') and banned = false);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin' and banned = false);
$$;

create or replace function public.is_active_member()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(select 1 from public.profiles where id = auth.uid() and banned = false);
$$;

alter table public.profiles enable row level security;
alter table public.public_messages enable row level security;
alter table public.listings enable row level security;
alter table public.trade_rooms enable row level security;
alter table public.trade_room_members enable row level security;
alter table public.trade_messages enable row level security;

create policy "profiles readable to signed in users" on public.profiles for select to authenticated using (true);
-- Read the current role without triggering recursive RLS checks on profiles.
create or replace function public.current_profile_role()
returns text language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and banned = false;
$$;

create policy "users update own profile basics" on public.profiles for update to authenticated
using (id = auth.uid() and role = public.current_profile_role())
with check (id = auth.uid() and role = public.current_profile_role());
-- Assistants must not be able to promote themselves or another account to admin.
create policy "staff can update profiles" on public.profiles for update to authenticated
using (public.is_staff())
with check (public.is_admin() or (public.is_staff() and role <> 'admin'));

create policy "public messages readable by everyone signed in" on public.public_messages for select to authenticated using (public.is_active_member());
create policy "members send public messages" on public.public_messages for insert to authenticated with check (user_id = auth.uid() and public.is_active_member());

create policy "active listings readable" on public.listings for select to authenticated using (status = 'active' or user_id = auth.uid() or public.is_staff());
create policy "members create listings" on public.listings for insert to authenticated with check (user_id = auth.uid() and public.is_active_member());
create policy "owner or staff update listing" on public.listings for update to authenticated using (user_id = auth.uid() or public.is_staff()) with check (user_id = auth.uid() or public.is_staff());
create policy "owner or staff delete listing" on public.listings for delete to authenticated using (user_id = auth.uid() or public.is_staff());

create policy "room members and staff can read rooms" on public.trade_rooms for select to authenticated using (exists(select 1 from public.trade_room_members m where m.room_id=id and m.user_id=auth.uid()) or creator_id=auth.uid() or public.is_staff());
create policy "room members readable by members and staff" on public.trade_room_members for select to authenticated using (user_id=auth.uid() or public.is_staff() or exists(select 1 from public.trade_room_members mine where mine.room_id=trade_room_members.room_id and mine.user_id=auth.uid()));
create policy "room messages readable by members" on public.trade_messages for select to authenticated using (exists(select 1 from public.trade_room_members m where m.room_id=trade_messages.room_id and m.user_id=auth.uid()) or public.is_staff());
create policy "room members send messages" on public.trade_messages for insert to authenticated with check (user_id=auth.uid() and exists(select 1 from public.trade_room_members m join public.trade_rooms r on r.id=m.room_id where m.room_id=trade_messages.room_id and m.user_id=auth.uid() and r.status='active') and public.is_active_member());

create or replace function public.create_trade_room(room_title text, buyer_username text, seller_username text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare rid uuid; code text; admin_id uuid;
begin
  if not public.is_admin() then raise exception 'Only the primary admin can create trade rooms'; end if;
  if trim(room_title) = '' or trim(buyer_username) = '' or trim(seller_username) = '' then raise exception 'Required fields missing'; end if;
  admin_id := auth.uid();
  code := 'GL-' || upper(substr(encode(gen_random_bytes(5),'hex'),1,6));
  insert into public.trade_rooms(title, invite_code, creator_id, buyer_username, seller_username)
  values(trim(room_title), code, admin_id, trim(buyer_username), trim(seller_username)) returning id into rid;
  insert into public.trade_room_members(room_id,user_id) values(rid,admin_id);
  return jsonb_build_object('id',rid,'invite_code',code,'title',trim(room_title));
end;
$$;

create or replace function public.join_trade_room(invite_code text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare r public.trade_rooms%rowtype; p public.profiles%rowtype; member_count integer;
begin
  select * into p from public.profiles where id=auth.uid();
  if p.id is null or p.banned then raise exception 'Account unavailable'; end if;
  select * into r from public.trade_rooms where trade_rooms.invite_code=upper(trim(join_trade_room.invite_code)) and status='active';
  if r.id is null then raise exception 'Invalid or closed room'; end if;
  if not (public.is_staff() or lower(p.username)=lower(r.buyer_username) or lower(p.username)=lower(r.seller_username) or r.creator_id=auth.uid()) then
    raise exception 'This invite is not assigned to your username';
  end if;
  select count(*) into member_count from public.trade_room_members where room_id=r.id;
  if not exists(select 1 from public.trade_room_members where room_id=r.id and user_id=auth.uid()) then
    if member_count >= 3 then raise exception 'Room is full'; end if;
    insert into public.trade_room_members(room_id,user_id) values(r.id,auth.uid());
  end if;
  return jsonb_build_object('id',r.id,'title',r.title,'invite_code',r.invite_code,'status',r.status);
end;
$$;

create or replace function public.close_trade_room(room_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Only the primary admin can close trade rooms'; end if;
  update public.trade_rooms set status='closed', closed_at=now() where id=room_id;
  delete from public.trade_room_members where trade_room_members.room_id=close_trade_room.room_id;
end;
$$;

-- Publish tables for Supabase Realtime if they are not already included.
do $$ begin
  alter publication supabase_realtime add table public.public_messages;
exception when duplicate_object then null;
when undefined_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.trade_messages;
exception when duplicate_object then null;
when undefined_object then null;
end $$;

-- After creating your own account, promote it to admin using your UUID from Authentication > Users:
-- update public.profiles set role = 'admin' where id = 'YOUR-AUTH-USER-UUID';
-- Never expose a service_role key in client-side code.

-- Private 1-to-1 conversations. Run this full SQL file in Supabase SQL Editor.
create table if not exists public.direct_conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (user_a <> user_b),
  unique(user_a,user_b)
);
create table if not exists public.direct_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  username text not null,
  content text not null check (char_length(content) between 1 and 1000),
  created_at timestamptz not null default now()
);
alter table public.direct_conversations enable row level security;
alter table public.direct_messages enable row level security;
create policy "participants read direct conversations" on public.direct_conversations for select to authenticated
using (auth.uid()=user_a or auth.uid()=user_b);
create policy "participants read direct messages" on public.direct_messages for select to authenticated
using (exists(select 1 from public.direct_conversations c where c.id=conversation_id and auth.uid() in (c.user_a,c.user_b)));
create policy "participants send direct messages" on public.direct_messages for insert to authenticated
with check (sender_id=auth.uid() and public.is_active_member() and exists(select 1 from public.direct_conversations c where c.id=conversation_id and auth.uid() in (c.user_a,c.user_b)));
create or replace function public.open_direct_conversation(target_username text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare target_id uuid; me uuid:=auth.uid(); convo public.direct_conversations%rowtype; a uuid; b uuid;
begin
  if me is null or not public.is_active_member() then raise exception 'Sign in required'; end if;
  select id into target_id from public.profiles where lower(username)=lower(trim(target_username)) and banned=false limit 1;
  if target_id is null or target_id=me then raise exception 'User not found'; end if;
  if me::text < target_id::text then a:=me; b:=target_id; else a:=target_id; b:=me; end if;
  insert into public.direct_conversations(user_a,user_b) values(a,b) on conflict(user_a,user_b) do nothing;
  select * into convo from public.direct_conversations where user_a=a and user_b=b;
  return jsonb_build_object('id',convo.id,'user_a',convo.user_a,'user_b',convo.user_b);
end; $$;
do $$ begin alter publication supabase_realtime add table public.direct_messages;
exception when duplicate_object then null; when undefined_object then null; end $$;
