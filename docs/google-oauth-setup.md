# Google OAuth configuration for HOME Reviews

No Google Cloud configuration is changed by this repository.

The existing HOME AI Google OAuth Web client can be reused if its owner explicitly adds this HOME Reviews callback to its authorized redirect URIs:

- `https://ihuztjkblywzjdruusdj.supabase.co/auth/v1/callback`

HOME Reviews Supabase Auth must use:

- Site URL: `https://ngpcao-spec.github.io/home-reviews-demo/`
- Production redirect URL: `https://ngpcao-spec.github.io/home-reviews-demo/`
- Development redirect URL: `http://localhost:5173/`

The Google client secret belongs only in the Google provider configuration of Supabase Auth. It must never be committed or exposed through a `VITE_*` variable.
# Installed iPhone login return

HOME Reviews is a client-only static app. iOS Google navigation may return in
Safari rather than the standalone PWA's initiating storage context; PKCE then
has no local verifier and the SDK can silently restore an empty session.
The client uses Supabase's supported implicit browser flow for iOS/iPadOS;
ordinary desktop initiation stays PKCE. An incoming implicit callback is also
accepted in its destination context, with the SDK validating the access token
via Auth before persisting the session. Tokens stay in the URL fragment, never
in a query, logs, source files or a backend handoff table.

At OAuth return, startup waits for SDK initialization and session persistence
before mounting HashRouter, then strips auth parameters/tokens from the URL.
Old PKCE callbacks still use a stored verifier through the public SDK exchange
method when one exists; missing verifiers show a safe restart message instead
of silently returning to login. Future iOS Google starts use browser flow.
Password recovery is captured before cleanup and handed to the existing recovery
screen. Immediate button locking prevents two concurrent Google starts.

Auth-session/permissions/account-cache rules remain in force; this is not a
change to RLS, provider secrets, Google client configuration or model pipelines.
OAuth tests use the real SDK with a fake Auth server and empty verifier storage;
the user must still confirm the behavior on their physical iPhone after deployment.
