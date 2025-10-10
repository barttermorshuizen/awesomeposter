alter table discovery_items
  add column if not exists brief_id uuid references briefs(id) on delete set null;

create table if not exists discovery_item_status_history (
  id uuid primary key,
  item_id uuid not null references discovery_items(id) on delete cascade,
  previous_status text,
  next_status text not null,
  note text not null,
  actor_id uuid not null,
  actor_name text not null,
  created_at timestamptz default now()
);

create index if not exists discovery_item_status_history_item_idx
  on discovery_item_status_history (item_id);

create index if not exists discovery_item_status_history_created_idx
  on discovery_item_status_history (created_at);
