-- People and permission to record them (RF-05, RF-22, Ley 1581 de 2012).

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  full_name     text        not null,
  -- The identifier the Oracle export writes in its COUNTER column, e.g. PABLO.R.
  counter_code  text        unique
                            check (counter_code ~ '^[A-Z0-9]+(\.[A-Z0-9]+)*$'),
  role          public.app_role not null default 'operator',
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.profiles is
  'Application identity, 1:1 with auth.users. Deactivation is a flag, never a delete: records keep pointing here (RF-32).';

create index profiles_role_idx on public.profiles (role) where is_active;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function extensions.moddatetime (updated_at);

-- A profile row must exist the moment a user does, otherwise every RLS helper
-- has to cope with a null role.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data ->> 'role')::public.app_role, 'operator')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Voice authorisation
-- ---------------------------------------------------------------------------
-- The microphone screen is a legal gate, not a UX nicety: without a `granted`
-- row the app must fall back to typing. Consent is append-only so that
-- "authorised on the 30th, revoked on the 2nd" survives as history.

create table public.voice_consents (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid        not null references public.profiles (id) on delete cascade,
  status          public.consent_status not null,
  policy_version  text        not null,
  decided_at      timestamptz not null default now(),
  user_agent      text,
  created_at      timestamptz not null default now()
);

comment on table public.voice_consents is
  'Append-only consent ledger (Ley 1581 de 2012). The current state is the newest row per profile.';

create index voice_consents_profile_idx on public.voice_consents (profile_id, decided_at desc);

-- The app asks one question — "may this person open the microphone?" — so it
-- gets one answer instead of a window function in the client.
create view public.v_current_voice_consent
with (security_invoker = true) as
select distinct on (c.profile_id)
  c.profile_id,
  c.status,
  c.policy_version,
  c.decided_at,
  c.status = 'granted' as may_record
from public.voice_consents c
order by c.profile_id, c.decided_at desc, c.created_at desc;

comment on view public.v_current_voice_consent is
  'Newest consent decision per profile. `may_record` gates the push-to-talk button.';
