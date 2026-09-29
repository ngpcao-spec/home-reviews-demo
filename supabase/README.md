# Backend Supabase — HOME Reviews

## Lancement local

1. Installer Docker Desktop et le CLI Supabase (`npm install` installe la version épinglée).
2. Démarrer l’environnement : `npx supabase start`.
3. Réinitialiser la base et charger la démo : `npx supabase db reset`.
4. Servir les fonctions : `npx supabase functions serve --env-file supabase/.env.local`.
5. Reporter l’URL et la clé publishable locales dans `.env.local` avec `VITE_DEMO_MODE=false`.

Compte local : `demo@home-reviews.fr` / `demohome`.

## Fournisseurs d’avis

- `REVIEW_PROVIDER=apify` utilise `compass/google-maps-reviews-scraper` et conserve texte original et traductions séparément.
- `REVIEW_PROVIDER=outscraper` reste disponible comme rollback sans modification frontend.
- `REVIEW_PROVIDER=mock` ne fait aucun appel externe.

La fonction `fetch-google-reviews` limite la première récupération à 20 avis, demande le tri `newest` et normalise les données avant de les renvoyer. `OUTSCRAPER_API_KEY` est lu exclusivement depuis Supabase Secrets ; il ne doit être placé ni dans `.env.local`, ni dans une variable `VITE_*`. SerpApi n’est pas branché à ce flux.

## IA

Définir `OPENAI_API_KEY` et `OPENAI_MODEL` via `supabase secrets set`. Sans ces variables, l’analyse et les réponses utilisent un moteur mock déterministe. La sortie d’analyse réelle est contrainte par un JSON Schema strict puis validée avec Zod.

## Cron

Définir `CRON_SECRET`, puis planifier un appel horaire vers `/functions/v1/sync-reviews-cron` avec l’en-tête `x-cron-secret`. En production, conserver cette valeur dans Supabase Vault. Les établissements utilisent `next_sync_at` pour répartir la charge.

## Sécurité

Toutes les tables exposées ont RLS activé et des grants explicites. Les politiques s’appuient sur l’appartenance à l’organisation ; les tâches de synchronisation et d’analyse utilisent `service_role` uniquement dans les Edge Functions. Exécuter `npx supabase test db` après démarrage pour vérifier l’isolation A/B.
