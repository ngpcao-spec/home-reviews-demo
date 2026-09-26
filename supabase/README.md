# Backend Supabase — HOME Reviews

## Lancement local

1. Installer Docker Desktop et le CLI Supabase (`npm install` installe la version épinglée).
2. Démarrer l’environnement : `npx supabase start`.
3. Réinitialiser la base et charger la démo : `npx supabase db reset`.
4. Servir les fonctions : `npx supabase functions serve --env-file supabase/.env.local`.
5. Reporter l’URL et la clé publishable locales dans `.env.local` avec `VITE_DEMO_MODE=false`.

Compte local : `demo@home-reviews.fr` / `demohome`.

## Fournisseurs d’avis

- `REVIEW_PROVIDER=outscraper` utilise Outscraper en principal et SerpApi en fallback si sa clé est disponible.
- `REVIEW_PROVIDER=serpapi` utilise SerpApi en principal, puis le mock.
- `REVIEW_PROVIDER=mock` ne fait aucun appel externe.

Les adaptateurs sont centralisés dans `functions/_shared/review-provider.ts`. Ils appliquent timeout, retry limité, backoff, journalisation structurée et circuit breaker simple. Aucun secret n’est lu par le frontend.

## IA

Définir `OPENAI_API_KEY` et `OPENAI_MODEL` via `supabase secrets set`. Sans ces variables, l’analyse et les réponses utilisent un moteur mock déterministe. La sortie d’analyse réelle est contrainte par un JSON Schema strict puis validée avec Zod.

## Cron

Définir `CRON_SECRET`, puis planifier un appel horaire vers `/functions/v1/sync-reviews-cron` avec l’en-tête `x-cron-secret`. En production, conserver cette valeur dans Supabase Vault. Les établissements utilisent `next_sync_at` pour répartir la charge.

## Sécurité

Toutes les tables exposées ont RLS activé et des grants explicites. Les politiques s’appuient sur l’appartenance à l’organisation ; les tâches de synchronisation et d’analyse utilisent `service_role` uniquement dans les Edge Functions. Exécuter `npx supabase test db` après démarrage pour vérifier l’isolation A/B.
