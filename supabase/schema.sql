create extension if not exists pgcrypto;

create table public.profiles (
	id uuid primary key references auth.users(id) on delete cascade,
	display_name text not null check (char_length(display_name) between 1 and 50),
	phone text not null unique,
	created_at timestamptz not null default now()
);

create table public.friendships (
	user_id uuid not null references public.profiles(id) on delete cascade,
	friend_id uuid not null references public.profiles(id) on delete cascade,
	created_at timestamptz not null default now(),
	primary key (user_id, friend_id),
	check (user_id <> friend_id)
);

create table public.friend_invites (
	id uuid primary key default gen_random_uuid(),
	inviter_id uuid not null references public.profiles(id) on delete cascade,
	phone text not null,
	accepted_by uuid references public.profiles(id) on delete set null,
	created_at timestamptz not null default now(),
	accepted_at timestamptz
);

create table public.messages (
	id bigint generated always as identity primary key,
	sender_id uuid not null references public.profiles(id) on delete cascade,
	recipient_id uuid not null references public.profiles(id) on delete cascade,
	body text not null check (char_length(body) between 1 and 4000),
	created_at timestamptz not null default now(),
	check (sender_id <> recipient_id)
);

create index messages_pair_created_at on public.messages (sender_id, recipient_id, created_at);
create index messages_recipient_created_at on public.messages (recipient_id, created_at);

create function public.create_profile_for_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	insert into public.profiles (id, display_name, phone)
	values (
		new.id,
		coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), 'New friend'),
		regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone', ''), '[^0-9]', '', 'g')
	);
	return new;
end;
$$;

create trigger on_auth_user_created
	after insert on auth.users
	for each row execute function public.create_profile_for_user();

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.friend_invites enable row level security;
alter table public.messages enable row level security;

create policy "Users can read their own and friends' profiles"
	on public.profiles for select to authenticated
	using (
		id = (select auth.uid())
		or exists (
			select 1 from public.friendships f
			where f.user_id = (select auth.uid()) and f.friend_id = profiles.id
		)
	);

create policy "Users can read their own friendships"
	on public.friendships for select to authenticated
	using (user_id = (select auth.uid()));

create policy "Users can read invitations they created"
	on public.friend_invites for select to authenticated
	using (inviter_id = (select auth.uid()));

create policy "Users can create invitations for themselves"
	on public.friend_invites for insert to authenticated
	with check (inviter_id = (select auth.uid()) and accepted_by is null);

create policy "Friends can read their messages"
	on public.messages for select to authenticated
	using (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()));

create policy "Friends can send messages"
	on public.messages for insert to authenticated
	with check (
		sender_id = (select auth.uid())
		and exists (
			select 1 from public.friendships f
			where f.user_id = (select auth.uid()) and f.friend_id = messages.recipient_id
		)
	);

grant select on public.profiles, public.friendships, public.friend_invites, public.messages to authenticated;
grant insert on public.messages to authenticated;
grant usage, select on sequence public.messages_id_seq to authenticated;

create function public.create_friend_invite(p_phone text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
	v_id uuid;
begin
	if auth.uid() is null then raise exception 'Sign in first'; end if;
	if char_length(v_phone) < 7 or char_length(v_phone) > 15 then raise exception 'Enter a valid phone number'; end if;
	insert into public.friend_invites (inviter_id, phone)
	values (auth.uid(), v_phone)
	returning id into v_id;
	return v_id;
end;
$$;

create function public.get_invite_phone(p_token uuid)
returns text
language sql
security definer
set search_path = ''
as $$
	select i.phone from public.friend_invites i
	where i.id = p_token and i.accepted_by is null
$$;

create function public.accept_friend_invite(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_invite public.friend_invites%rowtype;
	v_phone text;
begin
	if auth.uid() is null then raise exception 'Sign in first'; end if;
	select phone into v_phone from public.profiles where id = auth.uid();
	select * into v_invite from public.friend_invites where id = p_token for update;
	if not found then raise exception 'Invitation not found'; end if;
	if v_invite.accepted_by is not null then raise exception 'Invitation has already been used'; end if;
	if v_invite.inviter_id = auth.uid() then raise exception 'You cannot accept your own invitation'; end if;
	if v_invite.phone <> v_phone then raise exception 'Register with the invited phone number'; end if;
	insert into public.friendships (user_id, friend_id)
	values (v_invite.inviter_id, auth.uid()), (auth.uid(), v_invite.inviter_id)
	on conflict do nothing;
	update public.friend_invites set accepted_by = auth.uid(), accepted_at = now() where id = p_token;
	return v_invite.inviter_id;
end;
$$;

create function public.my_friends()
returns table (friend_id uuid, display_name text, phone text)
language sql
stable
security definer
set search_path = ''
as $$
	select p.id, p.display_name, p.phone
	from public.friendships f
	join public.profiles p on p.id = f.friend_id
	where f.user_id = auth.uid()
	order by p.display_name
$$;

revoke all on function public.create_friend_invite(text) from public;
revoke all on function public.get_invite_phone(uuid) from public;
revoke all on function public.accept_friend_invite(uuid) from public;
revoke all on function public.my_friends() from public;
grant execute on function public.create_friend_invite(text) to authenticated;
grant execute on function public.get_invite_phone(uuid) to anon, authenticated;
grant execute on function public.accept_friend_invite(uuid) to authenticated;
grant execute on function public.my_friends() to authenticated;

do $$
begin
	alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end;
$$;

do $$
begin
	alter publication supabase_realtime add table public.friendships;
exception when duplicate_object then null;
end;
$$;