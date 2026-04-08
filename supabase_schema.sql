-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Rooms Table
create table public.rooms (
  id uuid default uuid_generate_v4() primary key,
  room_code varchar(10) unique not null,
  status varchar(20) default 'LOBBY' not null, -- LOBBY, AUCTION, RESULTS
  current_player_index integer default 0,
  admin_id uuid, -- socket or local user id
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Users Table
create table public.users (
  id uuid default uuid_generate_v4() primary key,
  name varchar(50) not null,
  room_id uuid references public.rooms(id) on delete cascade
);

-- Teams Table (which team each user picked)
create table public.teams (
  id uuid default uuid_generate_v4() primary key,
  room_id uuid references public.rooms(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  team_name varchar(50) not null, -- CSK, MI, RCB, etc.
  purse bigint default 1000000000 not null, -- 100 Cr in decimal or just 10000 Lakh
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(room_id, team_name), -- Only one CSK per room!
  unique(room_id, user_id)    -- One team per user per room
);

-- Bids Table
create table public.bids (
  id uuid default uuid_generate_v4() primary key,
  room_id uuid references public.rooms(id) on delete cascade,
  player_id integer not null, -- From our JSON list
  team_id uuid references public.teams(id) on delete cascade,
  amount bigint not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Squads Table (Assigning players to teams when sold)
create table public.squads (
  id uuid default uuid_generate_v4() primary key,
  room_id uuid references public.rooms(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  player_id integer not null,
  bought_for bigint not null
);

-- Enable Realtime for all tables!
alter publication supabase_realtime add table public.rooms, public.users, public.teams, public.bids, public.squads;

-- Since this is an ephemeral auction, we can disable RLS for simplicity, 
-- or enable it with generous policies (allow all authenticated/anon to select/insert/update/delete)
alter table public.rooms enable row level security;
alter table public.users enable row level security;
alter table public.teams enable row level security;
alter table public.bids enable row level security;
alter table public.squads enable row level security;

create policy "Allow all operations" on public.rooms for all using (true) with check (true);
create policy "Allow all operations" on public.users for all using (true) with check (true);
create policy "Allow all operations" on public.teams for all using (true) with check (true);
create policy "Allow all operations" on public.bids for all using (true) with check (true);
create policy "Allow all operations" on public.squads for all using (true) with check (true);
