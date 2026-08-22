# Job Agent NL

Job-hunting assistant for the Netherlands. Upload a CV once; it scans Adzuna job
listings, and an AI (Google Gemini) drafts a tailored CV + cover letter per job,
using only facts already in the uploaded CV. Every draft is previewed before use,
can be revised via chat, and gets a warning list of any claim it can't trace back to
the source CV.

Static frontend (GitHub Pages) + Supabase (auth, database, storage, edge functions).
Supabase project: `zfrppqbfqfmpqzydorrn` (org: Horila's Org, region eu-central-1).

## One-time setup (do this before it works)

### 1. Get free API keys

- **Adzuna**: sign up at https://developer.adzuna.com/ → get `app_id` + `app_key`.
- **Gemini**: get a free key at https://aistudio.google.com/apikey.

### 2. Set them as Edge Function secrets

In the Supabase dashboard → this project → Edge Functions → Secrets, add:
- `ADZUNA_APP_ID`
- `ADZUNA_APP_KEY`
- `GEMINI_API_KEY`

(Or via CLI: `supabase secrets set ADZUNA_APP_ID=... ADZUNA_APP_KEY=... GEMINI_API_KEY=... --project-ref zfrppqbfqfmpqzydorrn`.)

### 3. Create your friend's login (no public signup)

Supabase dashboard → Authentication → Users → Add User. Set an email + password,
mark email confirmed. That's the only account — there is no sign-up form in the app.

### 4. Push to GitHub + enable Pages

```
git remote add origin <your-empty-github-repo-url>
git branch -M main
git push -u origin main
```

Then in the GitHub repo: Settings → Pages → Source: Deploy from branch → `main` / `/ (root)`.
The site will be live at `https://<you>.github.io/<repo>/`.

## How it works

- `config.js` holds the public Supabase URL + publishable (anon) key — safe to
  expose, every table is RLS-locked to the one logged-in user.
- `search-jobs`, `generate-application`, `revise-application` are Supabase Edge
  Functions holding the real secrets (Adzuna, Gemini) server-side.
- The CV your friend uploads/pastes is the only source of truth. Every prompt to
  Gemini explicitly forbids adding any employer, date, title, skill, or achievement
  not literally present in that text. Both `generate-application` and
  `revise-application` automatically run a second Gemini pass afterward that flags
  any claim it can't trace back to the source CV — shown as a warning banner in the
  Draft tab. The final backstop is still the human preview step before approval.
- Adzuna's free tier caps at 250 calls/day; each "Scan jobs" click uses 2 calls
  (~100 results). This is real coverage of current NL listings, not literally every
  job posting that exists anywhere.

## Local files

```
index.html, style.css, app.js, config.js   — the static site
supabase/migrations/0001_init.sql          — DB schema + RLS policies
supabase/functions/                        — the 3 edge functions + shared helpers
```
