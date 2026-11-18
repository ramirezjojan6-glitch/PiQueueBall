create table if not exists public.court_system_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.court_venues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  join_code text not null unique,
  operating_mode text not null default 'single' check (operating_mode in ('single', 'multicourt')),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table if not exists public.court_venue_members (
  venue_id uuid not null references public.court_venues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role = 'member'),
  joined_at timestamptz not null default now(),
  primary key (venue_id, user_id),
  unique (user_id)
);

alter table public.court_venue_members
  drop constraint if exists court_venue_members_role_check;
update public.court_venue_members set role = 'member' where role <> 'member';
alter table public.court_venue_members
  add constraint court_venue_members_role_check check (role = 'member');

create table if not exists public.venue_courts (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.court_venues (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  mode text not null default 'doubles' check (mode in ('singles', 'doubles')),
  enabled boolean not null default true,
  queue_index integer not null default 0,
  created_at timestamptz not null default now(),
  unique (venue_id, name)
);

create table if not exists public.venue_queue_players (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.court_venues (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  avatar_data_url text not null default '',
  queue_index integer not null default 0,
  games_played integer not null default 0 check (games_played >= 0),
  played_round boolean not null default false,
  last_played_at timestamptz,
  created_at timestamptz not null default now(),
  unique (venue_id, profile_id)
);

create unique index if not exists venue_queue_players_guest_name_idx
  on public.venue_queue_players (venue_id, lower(name))
  where profile_id is null;

create table if not exists public.venue_court_matches (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.court_venues (id) on delete cascade,
  court_id uuid not null references public.venue_courts (id) on delete cascade,
  mode text not null check (mode in ('singles', 'doubles')),
  teams jsonb not null check (jsonb_typeof(teams) = 'array'),
  queue_snapshot jsonb not null check (jsonb_typeof(queue_snapshot) = 'array'),
  game_state jsonb not null check (jsonb_typeof(game_state) = 'object'),
  score_one integer not null default 0 check (score_one >= 0),
  score_two integer not null default 0 check (score_two >= 0),
  revision integer not null default 0,
  status text not null default 'active' check (status in ('active', 'completed')),
  started_by uuid not null references public.profiles (id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  match_record_id uuid references public.match_records (id) on delete set null
);

create unique index if not exists venue_court_one_active_match_idx
  on public.venue_court_matches (court_id) where status = 'active';
create index if not exists venue_matches_active_venue_idx
  on public.venue_court_matches (venue_id) where status = 'active';
create index if not exists venue_queue_order_idx
  on public.venue_queue_players (venue_id, queue_index);

alter table public.venue_queue_players
  add column if not exists is_queued boolean not null default false,
  add column if not exists joined_queue_at timestamptz;

alter table public.match_records
  add column if not exists venue_id uuid references public.court_venues (id) on delete set null;

alter table public.court_system_admins enable row level security;
alter table public.court_venues enable row level security;
alter table public.court_venue_members enable row level security;
alter table public.venue_courts enable row level security;
alter table public.venue_queue_players enable row level security;
alter table public.venue_court_matches enable row level security;

create or replace function public.is_court_venue_member(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.court_venue_members
    where venue_id = p_venue_id and user_id = auth.uid()
  );
$$;

drop function if exists public.is_court_venue_admin(uuid);

drop policy if exists "Users can view their court admin status" on public.court_system_admins;
create policy "Users can view their court admin status"
  on public.court_system_admins for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "Venue members can view their venue" on public.court_venues;
create policy "Venue members can view their venue"
  on public.court_venues for select to authenticated using (public.is_court_venue_member(id));

drop policy if exists "Venue members can view membership" on public.court_venue_members;
create policy "Venue members can view membership"
  on public.court_venue_members for select to authenticated
  using (public.is_court_venue_member(venue_id));

drop policy if exists "Venue members can view courts" on public.venue_courts;
create policy "Venue members can view courts"
  on public.venue_courts for select to authenticated
  using (public.is_court_venue_member(venue_id));

drop policy if exists "Venue members can view shared queue" on public.venue_queue_players;
create policy "Venue members can view shared queue"
  on public.venue_queue_players for select to authenticated
  using (public.is_court_venue_member(venue_id));

drop policy if exists "Venue members can view court matches" on public.venue_court_matches;
create policy "Venue members can view court matches"
  on public.venue_court_matches for select to authenticated
  using (public.is_court_venue_member(venue_id));

create or replace function public.is_court_system_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.court_system_admins where user_id = auth.uid()
  );
$$;

create or replace function public.create_court_lobby(p_name text, p_court_count integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_venue_id uuid;
  new_join_code text;
  court_number integer;
  clean_name text := left(trim(p_name), 80);
begin
  if auth.uid() is null then raise exception 'Sign in to create a lobby.'; end if;
  if clean_name is null or clean_name = '' then
    raise exception 'Enter a party or lobby name.';
  end if;
  if p_court_count is null or p_court_count < 1 or p_court_count > 20 then
    raise exception 'Choose between 1 and 20 courts for the lobby.';
  end if;
  if exists (select 1 from public.court_venue_members where user_id = auth.uid()) then
    raise exception 'This account already belongs to a shared queue.';
  end if;

  loop
    new_join_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.court_venues where join_code = new_join_code);
  end loop;

  insert into public.court_venues (name, join_code, created_by, operating_mode)
  values (clean_name, new_join_code, auth.uid(), 'multicourt')
  returning id into new_venue_id;
  insert into public.court_venue_members (venue_id, user_id, role)
  values (new_venue_id, auth.uid(), 'member');
  for court_number in 1..p_court_count loop
    insert into public.venue_courts (venue_id, name, mode, queue_index)
    values (new_venue_id, 'Court ' || court_number, 'doubles', court_number - 1);
  end loop;

  return jsonb_build_object('id', new_venue_id, 'name', clean_name,
    'join_code', new_join_code, 'operating_mode', 'multicourt',
    'court_count', p_court_count);
end;
$$;

create or replace function public.create_court_venue(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.create_court_lobby(p_name, 1);
end;
$$;

create or replace function public.rename_court_lobby(p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue_id uuid;
  clean_name text := left(trim(p_name), 80);
begin
  if auth.uid() is null then raise exception 'Sign in to rename this lobby.'; end if;
  if clean_name is null or clean_name = '' then
    raise exception 'Enter a party or lobby name.';
  end if;
  select member.venue_id into v_venue_id from public.court_venue_members as member
    where member.user_id = auth.uid();
  if v_venue_id is null then raise exception 'Join a shared queue to rename its lobby.'; end if;
  perform 1 from public.court_venues as venue where venue.id = v_venue_id for update;
  update public.court_venues as venue set name = clean_name where venue.id = v_venue_id;
end;
$$;

create or replace function public.search_court_venues(p_search text)
returns table (venue_id uuid, venue_name text, waiting_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  clean_search text := left(trim(p_search), 80);
begin
  if auth.uid() is null then raise exception 'Sign in to find a shared queue.'; end if;
  if clean_search is null or char_length(clean_search) < 2 then
    raise exception 'Enter at least 2 characters of the party name.';
  end if;
  return query
    select venue.id, venue.name,
      (select count(*) from public.venue_queue_players as player
        where player.venue_id = venue.id and player.is_queued)
    from public.court_venues as venue
    where venue.operating_mode = 'multicourt'
      and position(lower(clean_search) in lower(venue.name)) > 0
    order by (lower(venue.name) = lower(clean_search)) desc, venue.name, venue.created_at desc
    limit 20;
end;
$$;

create or replace function public.join_court_venue_by_id(p_venue_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_venue_id uuid;
  current_venue_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to join a shared queue.'; end if;
  select venue.id into target_venue_id from public.court_venues as venue
    where venue.id = p_venue_id and venue.operating_mode = 'multicourt';
  if target_venue_id is null then raise exception 'That shared queue was not found.'; end if;

  select member.venue_id into current_venue_id from public.court_venue_members as member
    where member.user_id = auth.uid();
  if current_venue_id is not null and current_venue_id <> target_venue_id then
    raise exception 'This account already belongs to another shared queue.';
  end if;
  insert into public.court_venue_members (venue_id, user_id, role)
  values (target_venue_id, auth.uid(), 'member')
  on conflict (venue_id, user_id) do nothing;
  return target_venue_id;
end;
$$;

create or replace function public.join_court_venue(p_join_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_venue_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to join a shared queue.'; end if;
  select venue.id into target_venue_id from public.court_venues as venue
    where venue.join_code = upper(trim(p_join_code))
      and venue.operating_mode = 'multicourt';
  if target_venue_id is null then raise exception 'That venue join code was not found.'; end if;
  return public.join_court_venue_by_id(target_venue_id);
end;
$$;

create or replace function public.get_court_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue_id uuid;
  response jsonb;
begin
  select member.venue_id into v_venue_id
  from public.court_venue_members as member where member.user_id = auth.uid();
  if v_venue_id is null then return null; end if;

  select jsonb_build_object(
    'venue', (select jsonb_build_object(
      'id', venue.id, 'name', venue.name, 'operatingMode', venue.operating_mode,
      'createdBy', venue.created_by,
      'joinCode', venue.join_code
    ) from public.court_venues as venue where venue.id = v_venue_id),
    'currentUserId', auth.uid(),
    'courts', coalesce((select jsonb_agg(jsonb_build_object(
      'id', court.id, 'name', court.name, 'mode', court.mode,
      'enabled', court.enabled, 'queueIndex', court.queue_index
    ) order by court.queue_index, court.name)
      from public.venue_courts as court where court.venue_id = v_venue_id), '[]'::jsonb),
    'players', coalesce((select jsonb_agg(jsonb_build_object(
      'id', player.id, 'profileId', player.profile_id, 'name', player.name,
      'avatarDataUrl', player.avatar_data_url, 'queueIndex', player.queue_index,
      'gamesPlayed', player.games_played, 'playedRound', player.played_round,
      'lastPlayedAt', player.last_played_at, 'joinedAt', player.joined_queue_at
    ) order by player.queue_index, player.joined_queue_at, player.name)
      from public.venue_queue_players as player
      where player.venue_id = v_venue_id and player.is_queued), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
      'id', profile.id, 'name', profile.display_name, 'avatarDataUrl', profile.avatar_data_url
    ) order by profile.display_name)
      from public.court_venue_members as member
      join public.profiles as profile on profile.id = member.user_id
      where member.venue_id = v_venue_id), '[]'::jsonb),
    'matches', coalesce((select jsonb_agg(jsonb_build_object(
      'id', match.id, 'courtId', match.court_id, 'courtName', court.name, 'mode', match.mode,
      'teams', match.teams, 'gameState', match.game_state,
      'scoreOne', match.score_one, 'scoreTwo', match.score_two,
      'revision', match.revision, 'startedAt', match.started_at
    ) order by match.started_at)
      from public.venue_court_matches as match
      join public.venue_courts as court on court.id = match.court_id
      where match.venue_id = v_venue_id and match.status = 'active'), '[]'::jsonb)
  ) into response;
  return response;
end;
$$;

create or replace function public.set_court_operating_mode(p_mode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue_id uuid;
begin
  if p_mode not in ('single', 'multicourt') then raise exception 'Choose a valid court operating mode.'; end if;
  select member.venue_id into v_venue_id from public.court_venue_members as member
    where member.user_id = auth.uid();
  if v_venue_id is null then raise exception 'Join a shared queue to change its operating mode.'; end if;
  perform 1 from public.court_venues as venue where venue.id = v_venue_id for update;
  if p_mode = 'single' and exists (
    select 1 from public.venue_court_matches as active_match
    where active_match.venue_id = v_venue_id and active_match.status = 'active'
  ) then
    raise exception 'Finish all active court matches before switching to Single-Court Mode.';
  end if;
  update public.court_venues as venue set operating_mode = p_mode where venue.id = v_venue_id;
  if p_mode = 'multicourt' then
    perform public.assign_available_venue_courts();
  end if;
end;
$$;

create or replace function public.save_venue_court(
  p_court_id uuid,
  p_name text,
  p_mode text,
  p_enabled boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue_id uuid;
  saved_id uuid;
  clean_name text := left(trim(p_name), 40);
begin
  select member.venue_id into v_venue_id from public.court_venue_members as member
    where member.user_id = auth.uid();
  if v_venue_id is null then raise exception 'Join a shared queue to configure its courts.'; end if;
  perform 1 from public.court_venues as venue where venue.id = v_venue_id for update;
  if clean_name = '' or p_mode not in ('singles', 'doubles') then
    raise exception 'Enter a court name and select Singles or Doubles.';
  end if;

  if p_court_id is null then
    insert into public.venue_courts (venue_id, name, mode, enabled, queue_index)
    values (v_venue_id, clean_name, p_mode, coalesce(p_enabled, true),
      (select coalesce(max(court.queue_index), -1) + 1 from public.venue_courts as court
        where court.venue_id = v_venue_id))
    returning id into saved_id;
  else
    if exists (select 1 from public.venue_court_matches
      where court_id = p_court_id and status = 'active') then
      raise exception 'Finish the active match before changing this court.';
    end if;
    update public.venue_courts as court
    set name = clean_name, mode = p_mode, enabled = coalesce(p_enabled, true)
    where court.id = p_court_id and court.venue_id = v_venue_id
    returning court.id into saved_id;
    if saved_id is null then raise exception 'Court not found in your venue.'; end if;
  end if;
  if coalesce(p_enabled, true) then
    perform public.assign_available_venue_courts();
  end if;
  return saved_id;
end;
$$;

create or replace function public.delete_venue_court(p_court_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue_id uuid;
begin
  select member.venue_id into v_venue_id from public.court_venue_members as member
    where member.user_id = auth.uid();
  if v_venue_id is null then raise exception 'Join a shared queue to manage its courts.'; end if;
  perform 1 from public.court_venues as venue where venue.id = v_venue_id for update;
  if not found then raise exception 'The court lobby could not be found.'; end if;
  perform 1 from public.venue_courts as court
    where court.id = p_court_id and court.venue_id = v_venue_id for update;
  if not found then raise exception 'Court not found in your lobby.'; end if;
  if exists (select 1 from public.venue_court_matches
    where court_id = p_court_id and status = 'active') then
    raise exception 'Finish the active match before deleting this court.';
  end if;
  delete from public.venue_courts as court
    where court.id = p_court_id and court.venue_id = v_venue_id;
end;
$$;

create or replace function public.add_venue_queue_player(p_profile_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue_id uuid;
  player_id uuid;
  existing_player_id uuid;
  existing_player_queued boolean;
  player_name text := coalesce(left(trim(p_name), 80), '');
  avatar text := '';
begin
  select member.venue_id into v_venue_id from public.court_venue_members as member
    where member.user_id = auth.uid();
  if v_venue_id is null then raise exception 'Join a shared queue to manage its players.'; end if;
  perform 1 from public.court_venues as venue where venue.id = v_venue_id for update;
  if p_profile_id is not null then
    if not exists (select 1 from public.court_venue_members
      where court_venue_members.venue_id = v_venue_id
        and court_venue_members.user_id = p_profile_id) then
      raise exception 'That account must join this venue before it can be added to the shared queue.';
    end if;
    select display_name, avatar_data_url into player_name, avatar
      from public.profiles where id = p_profile_id;
    if player_name is null then raise exception 'The selected venue profile was not found.'; end if;
  end if;
  if player_name = '' then raise exception 'Enter a player name or select a venue member.'; end if;
  select player.id, player.is_queued into existing_player_id, existing_player_queued
    from public.venue_queue_players as player
    where player.venue_id = v_venue_id
      and ((p_profile_id is not null and player.profile_id = p_profile_id)
        or (p_profile_id is null and player.profile_id is null
          and lower(player.name) = lower(player_name)))
    order by player.id
    limit 1
    for update;
  if existing_player_id is not null and existing_player_queued then
    raise exception 'That player is already in the shared queue.';
  end if;
  if existing_player_id is not null and exists (
    select 1 from public.venue_court_matches as match
    cross join lateral jsonb_array_elements(match.teams) as team(value)
    cross join lateral jsonb_array_elements(team.value) as participant(value)
    where match.venue_id = v_venue_id and match.status = 'active'
      and participant.value ->> 'id' = existing_player_id::text
  ) then
    raise exception 'A player cannot join the queue while playing on a court.';
  end if;

  if existing_player_id is not null then
    update public.venue_queue_players as player
      set name = player_name, avatar_data_url = coalesce(avatar, ''),
        queue_index = (select coalesce(max(queued_player.queue_index), -1) + 1
          from public.venue_queue_players as queued_player
          where queued_player.venue_id = v_venue_id),
        is_queued = true, joined_queue_at = now()
      where player.id = existing_player_id
      returning player.id into player_id;
  else
    insert into public.venue_queue_players (
      venue_id, profile_id, name, avatar_data_url, queue_index, is_queued, joined_queue_at
    )
    values (v_venue_id, p_profile_id, player_name, coalesce(avatar, ''),
      (select coalesce(max(queue_index), -1) + 1
        from public.venue_queue_players where venue_id = v_venue_id),
      true, now())
    returning id into player_id;
  end if;
  perform public.assign_available_venue_courts();
  return player_id;
end;
$$;

create or replace function public.join_venue_queue()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue_id uuid;
  player_id uuid;
  player_name text;
  player_avatar text;
begin
  select member.venue_id into v_venue_id
    from public.court_venue_members as member
    where member.user_id = auth.uid();
  if v_venue_id is null then raise exception 'Join a court venue before joining its queue.'; end if;
  perform 1 from public.court_venues as venue
    where venue.id = v_venue_id
    for update;
  if not found then raise exception 'The court venue could not be found.'; end if;
  if exists (
    select 1 from public.venue_court_matches as match
    cross join lateral jsonb_array_elements(match.teams) as team(value)
    cross join lateral jsonb_array_elements(team.value) as participant(value)
    where match.venue_id = v_venue_id and match.status = 'active'
      and participant.value ->> 'userId' = auth.uid()::text
  ) then
    raise exception 'You cannot rejoin the queue while playing on a court.';
  end if;
  select player.id into player_id
    from public.venue_queue_players as player
    where player.venue_id = v_venue_id
      and player.profile_id = auth.uid()
      and player.is_queued;
  if found then
    perform public.assign_available_venue_courts();
    return player_id;
  end if;
  select profile.display_name, profile.avatar_data_url
    into player_name, player_avatar
    from public.profiles as profile where profile.id = auth.uid();
  if player_name is null then raise exception 'Complete your player profile before joining this queue.'; end if;

  insert into public.venue_queue_players (
    venue_id, profile_id, name, avatar_data_url, queue_index, is_queued, joined_queue_at
  )
  values (
    v_venue_id, auth.uid(), player_name, coalesce(player_avatar, ''),
    (select coalesce(max(player.queue_index), -1) + 1
      from public.venue_queue_players as player where player.venue_id = v_venue_id),
    true, now()
  )
  on conflict (venue_id, profile_id) do update
    set name = excluded.name,
      avatar_data_url = excluded.avatar_data_url,
      queue_index = (select coalesce(max(player.queue_index), -1) + 1
        from public.venue_queue_players as player where player.venue_id = v_venue_id),
      is_queued = true,
      joined_queue_at = now()
  returning id into player_id;

  perform public.assign_available_venue_courts();
  return player_id;
end;
$$;

create or replace function public.leave_venue_queue()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue_id uuid;
begin
  select member.venue_id into v_venue_id
    from public.court_venue_members as member where member.user_id = auth.uid();
  if v_venue_id is null then return; end if;
  perform 1 from public.court_venues as venue
    where venue.id = v_venue_id for update;
  if exists (
    select 1 from public.venue_court_matches as match
    cross join lateral jsonb_array_elements(match.teams) as team(value)
    cross join lateral jsonb_array_elements(team.value) as participant(value)
    where match.venue_id = v_venue_id and match.status = 'active'
      and participant.value ->> 'userId' = auth.uid()::text
  ) then
    raise exception 'Finish your active court match before leaving or switching modes.';
  end if;
  update public.venue_queue_players
    set is_queued = false, joined_queue_at = null
    where venue_id = v_venue_id and profile_id = auth.uid();
end;
$$;

create or replace function public.remove_venue_queue_player(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue_id uuid;
begin
  select member.venue_id into v_venue_id from public.court_venue_members as member
    where member.user_id = auth.uid();
  if v_venue_id is null then raise exception 'Join a shared queue to manage its players.'; end if;
  perform 1 from public.court_venues as venue where venue.id = v_venue_id for update;
  if exists (
    select 1 from public.venue_court_matches as match
    cross join lateral jsonb_array_elements(match.teams) as team(value)
    cross join lateral jsonb_array_elements(team.value) as player(value)
    where match.venue_id = v_venue_id and match.status = 'active'
      and player.value ->> 'id' = p_player_id::text
  ) then
    raise exception 'A player cannot be removed while they are playing on a court.';
  end if;
  delete from public.venue_queue_players
    where venue_queue_players.id = p_player_id and venue_queue_players.venue_id = v_venue_id;
  if not found then raise exception 'Player not found in the shared queue.'; end if;
end;
$$;

create or replace function public.reset_venue_session()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue_id uuid;
begin
  select member.venue_id into v_venue_id from public.court_venue_members as member
    where member.user_id = auth.uid();
  if v_venue_id is null then raise exception 'Join a shared queue to start a new session.'; end if;
  perform 1 from public.court_venues as venue where venue.id = v_venue_id for update;
  if exists (select 1 from public.venue_court_matches
    where venue_court_matches.venue_id = v_venue_id and status = 'active') then
    raise exception 'Finish all active court matches before starting a new session.';
  end if;
  update public.venue_queue_players
    set games_played = 0, played_round = false, last_played_at = null
    where venue_queue_players.venue_id = v_venue_id;
end;
$$;

create or replace function public.jumble_venue_queue(p_shuffled_player_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue_id uuid;
  min_games integer;
  eligible_ids uuid[];
  eligible_count integer;
begin
  select member.venue_id into v_venue_id from public.court_venue_members as member
    where member.user_id = auth.uid();
  if v_venue_id is null then raise exception 'Join a shared queue to jumble its players.'; end if;
  perform 1 from public.court_venues as venue where venue.id = v_venue_id for update;
  if exists (select 1 from public.venue_court_matches
    where venue_court_matches.venue_id = v_venue_id and status = 'active') then
    raise exception 'Finish all active matches before jumbling the shared queue.';
  end if;

  select min(games_played) into min_games from public.venue_queue_players
    where venue_queue_players.venue_id = v_venue_id;
  if min_games is null then raise exception 'Add players before jumbling the queue.'; end if;
  select array_agg(id order by queue_index), count(*) into eligible_ids, eligible_count
    from public.venue_queue_players
    where venue_queue_players.venue_id = v_venue_id
      and games_played = min_games;
  if cardinality(coalesce(p_shuffled_player_ids, array[]::uuid[])) <> eligible_count
    or (select count(distinct shuffled.id) from unnest(p_shuffled_player_ids) as shuffled(id)) <> eligible_count
    or exists (select 1 from unnest(p_shuffled_player_ids) as shuffled(id)
      where not shuffled.id = any(eligible_ids)) then
    raise exception 'Jumble can only reorder players tied for the fewest games played.';
  end if;

  with eligible_slots as (
    select id, queue_index, row_number() over (order by queue_index) as slot
    from public.venue_queue_players
    where venue_queue_players.venue_id = v_venue_id and games_played = min_games
  ), shuffled as (
    select p_shuffled_player_ids[index] as id, index as slot
    from generate_subscripts(p_shuffled_player_ids, 1) as indexes(index)
  )
  update public.venue_queue_players as player
    set queue_index = slots.queue_index
    from shuffled
    join eligible_slots as slots using (slot)
    where player.id = shuffled.id;
end;
$$;

create or replace function public.assign_next_court_match(p_court_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue_id uuid;
  court public.venue_courts%rowtype;
  selected_ids uuid[];
  needed integer;
  teams_json jsonb;
  queue_json jsonb;
  game_json jsonb;
  new_match_id uuid;
  first_id text;
begin
  select member.venue_id into v_venue_id
    from public.court_venue_members as member where member.user_id = auth.uid();
  if v_venue_id is null then raise exception 'Join a venue to assign a court match.'; end if;
  perform 1 from public.court_venues as venue
    where venue.id = v_venue_id for update;
  if not found then raise exception 'The court venue could not be found.'; end if;
  select * into court from public.venue_courts as available_court
    where available_court.id = p_court_id and available_court.venue_id = v_venue_id
      and available_court.enabled for update;
  if not found then raise exception 'This court is unavailable.'; end if;
  if exists (select 1 from public.venue_court_matches
    where venue_court_matches.court_id = p_court_id and status = 'active') then
    raise exception 'This court already has an active match.';
  end if;

  needed := case when court.mode = 'doubles' then 4 else 2 end;
  select array_agg(player.id order by player.queue_index, player.joined_queue_at, player.id)
    into selected_ids
  from (
    select queue_player.*
    from public.venue_queue_players as queue_player
    where queue_player.venue_id = v_venue_id
      and queue_player.is_queued
      and not exists (
        select 1 from public.venue_court_matches as active_match
        cross join lateral jsonb_array_elements(active_match.teams) as team(value)
        cross join lateral jsonb_array_elements(team.value) as participant(value)
        where active_match.venue_id = v_venue_id and active_match.status = 'active'
          and participant.value ->> 'id' = queue_player.id::text
      )
    order by queue_player.queue_index, queue_player.joined_queue_at, queue_player.id
    limit needed
  ) as player;

  if cardinality(coalesce(selected_ids, array[]::uuid[])) < needed then
    raise exception 'Not enough available players to start a % match on %.',
      court.mode, court.name;
  end if;

  select jsonb_build_array(
    (select jsonb_agg(jsonb_build_object(
      'id', player.id, 'userId', player.profile_id, 'name', player.name,
      'avatarDataUrl', player.avatar_data_url
    ) order by selection.position)
      from unnest(selected_ids[1:needed / 2]) with ordinality as selection(id, position)
      join public.venue_queue_players as player on player.id = selection.id),
    (select jsonb_agg(jsonb_build_object(
      'id', player.id, 'userId', player.profile_id, 'name', player.name,
      'avatarDataUrl', player.avatar_data_url
    ) order by selection.position)
      from unnest(selected_ids[needed / 2 + 1:needed]) with ordinality as selection(id, position)
      join public.venue_queue_players as player on player.id = selection.id)
  ) into teams_json;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', player.id, 'userId', player.profile_id, 'name', player.name,
    'avatarDataUrl', player.avatar_data_url
  ) order by player.queue_index, player.joined_queue_at), '[]'::jsonb) into queue_json
  from public.venue_queue_players as player
  where player.venue_id = v_venue_id and player.is_queued;

  first_id := teams_json -> 0 -> 0 ->> 'id';
  game_json := jsonb_build_object(
    'mode', court.mode,
    'teams', jsonb_build_array(
      (select jsonb_agg(player ->> 'id') from jsonb_array_elements(teams_json -> 0) as player),
      (select jsonb_agg(player ->> 'id') from jsonb_array_elements(teams_json -> 1) as player)
    ),
    'scores', jsonb_build_array(0, 0),
    'servingTeam', 0,
    'serverId', first_id,
    'serverNumber', case when court.mode = 'doubles' then 2 else null end,
    'openingServe', court.mode = 'doubles',
    'firstServerId', first_id,
    'rightPlayerIds', case when court.mode = 'doubles'
      then jsonb_build_array(first_id, teams_json -> 1 -> 0 ->> 'id')
      else '[]'::jsonb end
  );

  insert into public.venue_court_matches (
    venue_id, court_id, mode, teams, queue_snapshot, game_state, started_by
  ) values (v_venue_id, court.id, court.mode, teams_json, queue_json, game_json, auth.uid())
  returning id into new_match_id;

  update public.venue_queue_players as player
    set is_queued = false, joined_queue_at = null
    where player.id = any(selected_ids);

  return jsonb_build_object(
    'id', new_match_id, 'venueId', v_venue_id, 'courtId', court.id,
    'courtName', court.name, 'mode', court.mode, 'teams', teams_json,
    'queueSnapshot', queue_json, 'gameState', game_json,
    'scoreOne', 0, 'scoreTwo', 0, 'revision', 0
  );
end;
$$;

create or replace function public.assign_available_venue_courts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue_id uuid;
  court record;
  assigned_match jsonb;
  assigned_matches jsonb := '[]'::jsonb;
  required_players integer;
  waiting_players integer;
begin
  select member.venue_id into v_venue_id
    from public.court_venue_members as member where member.user_id = auth.uid();
  if v_venue_id is null then raise exception 'Join a venue to assign court matches.'; end if;
  perform 1 from public.court_venues as venue
    where venue.id = v_venue_id
    for update;
  if not found then return assigned_matches; end if;

  for court in
    select available.id, available.mode
    from public.venue_courts as available
    where available.venue_id = v_venue_id and available.enabled
      and not exists (
        select 1 from public.venue_court_matches as match
        where match.court_id = available.id and match.status = 'active'
      )
    order by available.queue_index, available.name, available.id
  loop
    required_players := case when court.mode = 'doubles' then 4 else 2 end;
    select count(*) into waiting_players
      from public.venue_queue_players as player
      where player.venue_id = v_venue_id and player.is_queued;
    if waiting_players < required_players then
      continue;
    end if;
    assigned_match := public.assign_next_court_match(court.id);
    assigned_matches := assigned_matches || jsonb_build_array(assigned_match);
  end loop;
  return assigned_matches;
end;
$$;

create or replace function public.get_court_match(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  saved_match public.venue_court_matches%rowtype;
  court_name text;
begin
  select * into saved_match from public.venue_court_matches
    where id = p_match_id and public.is_court_venue_member(venue_id);
  if not found then raise exception 'Court match not found or unavailable.'; end if;
  select name into court_name from public.venue_courts where id = saved_match.court_id;
  return jsonb_build_object(
    'id', saved_match.id, 'venueId', saved_match.venue_id, 'courtId', saved_match.court_id,
    'courtName', court_name, 'mode', saved_match.mode, 'teams', saved_match.teams,
    'queueSnapshot', saved_match.queue_snapshot, 'gameState', saved_match.game_state,
    'scoreOne', saved_match.score_one, 'scoreTwo', saved_match.score_two,
    'revision', saved_match.revision, 'status', saved_match.status,
    'startedAt', saved_match.started_at
  );
end;
$$;

create or replace function public.save_court_match_score(
  p_match_id uuid,
  p_expected_revision integer,
  p_game_state jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_revision integer;
  v_mode text;
  v_score_one numeric;
  v_score_two numeric;
begin
  if jsonb_typeof(p_game_state) is distinct from 'object' then
    raise exception 'The score is invalid.';
  end if;
  select court_match.mode into v_mode from public.venue_court_matches as court_match
    where court_match.id = p_match_id
      and public.is_court_venue_member(court_match.venue_id);
  if v_mode is null then raise exception 'Court match not found or unavailable.'; end if;
  if p_game_state ->> 'mode' is distinct from v_mode then
    raise exception 'The score format does not match this court match.';
  end if;
  if jsonb_typeof(p_game_state -> 'scores') is distinct from 'array' then
    raise exception 'The score must contain two valid values.';
  end if;
  if jsonb_array_length(p_game_state -> 'scores') <> 2 then
    raise exception 'The score must contain two valid values.';
  end if;
  if jsonb_typeof(p_game_state -> 'scores' -> 0) is distinct from 'number'
    or jsonb_typeof(p_game_state -> 'scores' -> 1) is distinct from 'number' then
    raise exception 'The scores must be whole numbers.';
  end if;
  v_score_one := (p_game_state -> 'scores' ->> 0)::numeric;
  v_score_two := (p_game_state -> 'scores' ->> 1)::numeric;
  if v_score_one < 0 or v_score_two < 0
    or v_score_one > 2147483647 or v_score_two > 2147483647
    or trunc(v_score_one) <> v_score_one or trunc(v_score_two) <> v_score_two then
    raise exception 'The scores must be non-negative whole numbers.';
  end if;
  if p_game_state -> 'teams' is distinct from (
    select jsonb_agg((
      select jsonb_agg(player.value ->> 'id' order by player.ordinality)
      from jsonb_array_elements(team.value) with ordinality as player(value, ordinality)
    ) order by team.ordinality)
    from jsonb_array_elements(court_match.teams) with ordinality as team(value, ordinality)
    where court_match.id = p_match_id
      and public.is_court_venue_member(court_match.venue_id)
  ) then
    raise exception 'The match teams cannot be changed after assignment.';
  end if;
  update public.venue_court_matches as match
  set game_state = p_game_state,
    score_one = v_score_one::integer,
    score_two = v_score_two::integer,
    revision = revision + 1
  where match.id = p_match_id and match.status = 'active'
    and match.revision = p_expected_revision
    and public.is_court_venue_member(match.venue_id)
  returning match.revision into saved_revision;
  if saved_revision is null then
    raise exception 'This court score changed elsewhere or the match is no longer active. Reload the match.';
  end if;
  return saved_revision;
end;
$$;

create or replace function public.finish_court_match(
  p_match_id uuid,
  p_expected_revision integer,
  p_game_state jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_match public.venue_court_matches%rowtype;
  record_id uuid;
  participant_count integer;
  v_venue_id uuid;
  score_one numeric;
  score_two numeric;
begin
  select match.venue_id into v_venue_id from public.venue_court_matches as match
    where match.id = p_match_id and public.is_court_venue_member(match.venue_id);
  if v_venue_id is null then raise exception 'This court match is no longer available.'; end if;
  perform 1 from public.court_venues as venue where venue.id = v_venue_id for update;
  select * into saved_match from public.venue_court_matches
    where id = p_match_id and status = 'active'
      and public.is_court_venue_member(venue_id)
    for update;
  if not found then raise exception 'This court match is no longer active.'; end if;
  if saved_match.revision <> p_expected_revision then
    raise exception 'This court score changed elsewhere. Reload the match before finishing.';
  end if;
  if jsonb_typeof(p_game_state) is distinct from 'object' then
    raise exception 'The score is invalid.';
  end if;
  if p_game_state ->> 'mode' is distinct from saved_match.mode then
    raise exception 'The score format does not match this court match.';
  end if;
  if jsonb_typeof(p_game_state -> 'scores') is distinct from 'array' then
    raise exception 'The score must contain two valid values.';
  end if;
  if jsonb_array_length(p_game_state -> 'scores') <> 2 then
    raise exception 'The score is invalid.';
  end if;
  if jsonb_typeof(p_game_state -> 'scores' -> 0) is distinct from 'number'
    or jsonb_typeof(p_game_state -> 'scores' -> 1) is distinct from 'number' then
    raise exception 'The scores must be whole numbers.';
  end if;
  score_one := (p_game_state -> 'scores' ->> 0)::numeric;
  score_two := (p_game_state -> 'scores' ->> 1)::numeric;
  if p_game_state -> 'teams' is distinct from (
    select jsonb_agg((
      select jsonb_agg(player.value ->> 'id' order by player.ordinality)
      from jsonb_array_elements(team.value) with ordinality as player(value, ordinality)
    ) order by team.ordinality)
    from jsonb_array_elements(saved_match.teams) with ordinality as team(value, ordinality)
  ) then
    raise exception 'The match teams cannot be changed after assignment.';
  end if;
  if score_one < 0 or score_two < 0 or score_one > 2147483647 or score_two > 2147483647
    or trunc(score_one) <> score_one or trunc(score_two) <> score_two
    or score_one = score_two then
    raise exception 'Enter a non-tied final score before ending the match.';
  end if;

  select count(*) into participant_count
    from jsonb_array_elements(saved_match.teams) as team(value)
    cross join lateral jsonb_array_elements(team.value) as player(value);
  if participant_count <> (case when saved_match.mode = 'doubles' then 4 else 2 end) then
    raise exception 'The saved court match has invalid players.';
  end if;

  insert into public.match_records (
    client_match_id, created_by, venue_id, mode, score_one, score_two,
    queue_started_at, played_at
  ) values (
    p_match_id, saved_match.started_by, saved_match.venue_id, saved_match.mode,
    score_one::integer,
    score_two::integer,
    saved_match.started_at, now()
  )
  on conflict (created_by, client_match_id) do update
    set venue_id = excluded.venue_id
  returning id into record_id;

  insert into public.match_players (match_id, player_id, player_name, team_index)
  select record_id,
    nullif(player.value ->> 'userId', '')::uuid,
    left(trim(player.value ->> 'name'), 80),
    (team.ordinality - 1)::smallint
  from jsonb_array_elements(saved_match.teams) with ordinality as team(value, ordinality)
  cross join lateral jsonb_array_elements(team.value) as player(value)
  where not exists (select 1 from public.match_players where match_id = record_id);

  insert into public.match_queue_players (match_id, player_id, player_name, queue_index, team_index)
  select record_id,
    nullif(player.value ->> 'userId', '')::uuid,
    left(trim(player.value ->> 'name'), 80),
    (queue_player.ordinality - 1)::integer,
    (
      select (team.ordinality - 1)::smallint
      from jsonb_array_elements(saved_match.teams) with ordinality as team(value, ordinality)
      cross join lateral jsonb_array_elements(team.value) as team_player(value)
      where team_player.value ->> 'id' = player.value ->> 'id'
      limit 1
    )
  from jsonb_array_elements(saved_match.queue_snapshot) with ordinality as queue_player(value, ordinality)
  cross join lateral (select queue_player.value as value) as player
  where not exists (select 1 from public.match_queue_players where match_id = record_id);

  update public.venue_queue_players as queue_player
  set games_played = queue_player.games_played + 1,
    played_round = true,
    last_played_at = now()
  where queue_player.venue_id = saved_match.venue_id
    and exists (
      select 1 from jsonb_array_elements(saved_match.teams) as team(value)
      cross join lateral jsonb_array_elements(team.value) as player(value)
      where player.value ->> 'id' = queue_player.id::text
    );

  if not exists (
    select 1 from public.venue_queue_players
    where venue_id = saved_match.venue_id and not played_round
  ) then
    update public.venue_queue_players
    set played_round = false where venue_id = saved_match.venue_id;
  end if;

  update public.venue_court_matches
  set game_state = p_game_state,
    score_one = (p_game_state -> 'scores' ->> 0)::integer,
    score_two = (p_game_state -> 'scores' ->> 1)::integer,
    status = 'completed', completed_at = now(), match_record_id = record_id,
    revision = revision + 1
  where id = saved_match.id and status = 'active';

  with participant_order as (
    select (participant.value ->> 'id')::uuid as player_id,
      row_number() over (order by team.ordinality, participant.ordinality) as position
    from jsonb_array_elements(saved_match.teams) with ordinality as team(value, ordinality)
    cross join lateral jsonb_array_elements(team.value) with ordinality
      as participant(value, ordinality)
  ), queue_end as (
    select coalesce(max(queue_player.queue_index), -1) as last_index
    from public.venue_queue_players as queue_player
    where queue_player.venue_id = saved_match.venue_id
  )
  update public.venue_queue_players as queue_player
    set is_queued = true, joined_queue_at = now(),
      queue_index = queue_end.last_index + participant_order.position
    from participant_order cross join queue_end
    where queue_player.id = participant_order.player_id;

  perform public.assign_available_venue_courts();
  return record_id;
end;
$$;

revoke all on function public.is_court_venue_member(uuid) from public, anon;
revoke all on function public.is_court_system_admin() from public, anon;
revoke all on function public.create_court_lobby(text, integer) from public, anon;
revoke all on function public.create_court_venue(text) from public, anon;
revoke all on function public.rename_court_lobby(text) from public, anon;
revoke all on function public.search_court_venues(text) from public, anon;
revoke all on function public.join_court_venue_by_id(uuid) from public, anon;
revoke all on function public.join_court_venue(text) from public, anon;
revoke all on function public.get_court_context() from public, anon;
revoke all on function public.set_court_operating_mode(text) from public, anon;
revoke all on function public.save_venue_court(uuid, text, text, boolean) from public, anon;
revoke all on function public.delete_venue_court(uuid) from public, anon;
revoke all on function public.add_venue_queue_player(uuid, text) from public, anon;
revoke all on function public.add_venue_queue_player(uuid, text) from authenticated;
revoke all on function public.join_venue_queue() from public, anon;
revoke all on function public.leave_venue_queue() from public, anon;
revoke all on function public.remove_venue_queue_player(uuid) from public, anon;
revoke all on function public.reset_venue_session() from public, anon;
revoke all on function public.jumble_venue_queue(uuid[]) from public, anon;
revoke all on function public.jumble_venue_queue(uuid[]) from authenticated;
revoke all on function public.assign_next_court_match(uuid) from public, anon;
revoke all on function public.assign_next_court_match(uuid) from authenticated;
revoke all on function public.assign_available_venue_courts() from public, anon;
revoke all on function public.get_court_match(uuid) from public, anon;
revoke all on function public.save_court_match_score(uuid, integer, jsonb) from public, anon;
revoke all on function public.finish_court_match(uuid, integer, jsonb) from public, anon;

grant execute on function public.is_court_venue_member(uuid) to authenticated;
grant execute on function public.is_court_system_admin() to authenticated;
grant execute on function public.create_court_lobby(text, integer) to authenticated;
grant execute on function public.create_court_venue(text) to authenticated;
grant execute on function public.rename_court_lobby(text) to authenticated;
grant execute on function public.search_court_venues(text) to authenticated;
grant execute on function public.join_court_venue_by_id(uuid) to authenticated;
grant execute on function public.join_court_venue(text) to authenticated;
grant execute on function public.get_court_context() to authenticated;
grant execute on function public.set_court_operating_mode(text) to authenticated;
grant execute on function public.save_venue_court(uuid, text, text, boolean) to authenticated;
grant execute on function public.delete_venue_court(uuid) to authenticated;
grant execute on function public.add_venue_queue_player(uuid, text) to authenticated;
grant execute on function public.join_venue_queue() to authenticated;
grant execute on function public.leave_venue_queue() to authenticated;
grant execute on function public.remove_venue_queue_player(uuid) to authenticated;
grant execute on function public.reset_venue_session() to authenticated;
grant execute on function public.assign_available_venue_courts() to authenticated;
grant execute on function public.get_court_match(uuid) to authenticated;
grant execute on function public.save_court_match_score(uuid, integer, jsonb) to authenticated;
grant execute on function public.finish_court_match(uuid, integer, jsonb) to authenticated;

notify pgrst, 'reload schema';
