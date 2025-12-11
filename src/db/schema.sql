-- Create table for business information
create table public.business_info (
  id uuid default gen_random_uuid() primary key,
  business_name text not null,
  description text,
  hours text,
  contact_info text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS)
alter table public.business_info enable row level security;

-- Create policy to allow access (adjust as needed for production)
create policy "Allow public read access"
  on public.business_info for select
  using ( true );

create policy "Allow public insert/update"
  on public.business_info for insert
  with check ( true );

create policy "Allow public update"
  on public.business_info for update
  using ( true );

