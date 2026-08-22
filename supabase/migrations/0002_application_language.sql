alter table applications add column language text not null default 'en' check (language in ('en', 'nl'));
