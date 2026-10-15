-- 로컬 Postgres 테스트용: Supabase 가 기본으로 제공하는 것들의 최소 흉내.
-- (실제 Supabase 프로젝트에는 이 파일을 적용하지 않는다)
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (id uuid primary key, email text);

-- Supabase 의 auth.uid(): 요청 JWT 의 sub
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on auth.users to authenticated;
