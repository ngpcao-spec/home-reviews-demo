# Google OAuth configuration for HOME Reviews

No Google Cloud configuration is changed by this repository.

The existing HOME AI Google OAuth Web client can be reused if its owner explicitly adds this HOME Reviews callback to its authorized redirect URIs:

- `https://ihuztjkblywzjdruusdj.supabase.co/auth/v1/callback`

HOME Reviews Supabase Auth must use:

- Site URL: `https://ngpcao-spec.github.io/home-reviews-demo/`
- Production redirect URL: `https://ngpcao-spec.github.io/home-reviews-demo/`
- Development redirect URL: `http://localhost:5173/`

The Google client secret belongs only in the Google provider configuration of Supabase Auth. It must never be committed or exposed through a `VITE_*` variable.
