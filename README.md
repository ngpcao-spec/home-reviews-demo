# HOME Reviews V1

Application web mobile-first pour surveiller les avis publics Google Maps, détecter les problèmes, produire une analyse structurée et aider le responsable à répondre puis à traiter chaque avis.

## Démarrage immédiat (mode démo)

```bash
npm install
copy .env.example .env.local
npm run dev
```

Conserver `VITE_DEMO_MODE=true` et `REVIEW_PROVIDER=mock`. Aucun compte ni aucune clé externe n’est nécessaire. Les quatre établissements et vingt avis de démonstration sont disponibles dès le premier écran. Le bouton « Injecter un nouvel avis négatif » simule toute la chaîne : avis, analyse, notification et compteurs.

## Commandes qualité

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```

Les tests E2E utilisent les viewports iPhone 14 (390×844), petit mobile (360×800) et desktop. Si Chromium n’est pas déjà installé : `npx playwright install chromium`.

## Architecture

- React 19, TypeScript, Vite, React Router, TanStack Query, Recharts et Lucide.
- PWA installable avec service worker, cache du shell, état hors ligne et support Web Push.
- État de démo persistant dans `localStorage`; aucun secret et aucune fausse donnée dynamique inscrite dans les composants.
- Supabase Auth, PostgreSQL/RLS, Edge Functions et seed local dans [`supabase/`](./supabase/README.md).
- Adaptateur `ReviewProvider` commun avec Apify, Outscraper et MockProvider. Apify est le fournisseur principal configurable ; les appels et traductions restent exclusivement côté serveur.
- Abstraction `BillingProvider` avec implémentation mock.

## Variables d’environnement

Copier `.env.example` vers `.env.local` pour le frontend. Les secrets backend se configurent avec `supabase secrets set` et ne doivent jamais porter le préfixe `VITE_`.

| Variable | Nécessaire en démo | Rôle |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Non | URL publique du projet Supabase |
| `VITE_SUPABASE_ANON_KEY` | Non | Clé publishable/anon Supabase |
| `VITE_DEMO_MODE` | Oui (`true`) | Active les données et actions locales |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend réel | Accès serveur pour sync/IA |
| `REVIEW_PROVIDER` | Oui (`mock`) | `apify`, `outscraper` ou `mock` ; configuration Supabase côté serveur |
| `APIFY_API_TOKEN` | Production Apify | Secret Supabase uniquement, jamais `VITE_*` |
| `OUTSCRAPER_API_KEY` | Production Outscraper | Secret Supabase uniquement, jamais `VITE_*` |
| `OPENAI_API_KEY` + `OPENAI_MODEL` | IA réelle | Analyse et génération côté Edge Function |
| `WEB_PUSH_PUBLIC_KEY` + `WEB_PUSH_PRIVATE_KEY` | Push réel | Notifications Web Push |
| `BILLING_PROVIDER` | Oui (`mock`) | Abstraction de facturation |
| `CRON_SECRET` | Cron réel | Authentifie la fonction planifiée |

## Sécurité et multi-tenant

La migration active RLS sur toutes les tables exposées, révoque les droits par défaut, accorde seulement les opérations nécessaires et isole chaque ligne par appartenance à l’organisation. Les vérifications de rôle sont effectuées par des fonctions privées `security definer` avec `search_path` vide et contrôle explicite de `auth.uid()`. Les clés Outscraper, OpenAI, Web Push et `service_role` sont lues uniquement par les Edge Functions.

Une suite pgTAP vérifie qu’une organisation B ne peut ni lire ni modifier les établissements de l’organisation A. Les listes d’avis sont préparées pour une pagination par curseur `(published_at, id)` en production.

## Synchronisation et IA

L’import initial récupère jusqu’à 50 avis, les marque historiques et ne crée aucune notification. Les synchronisations suivantes utilisent une fenêtre de 20 avis, l’unicité `(establishment_id, source_provider, external_review_id)` et `next_sync_at`. Le refresh manuel est limité à cinq minutes.

Les avis 1–2★ sont toujours à traiter, les 3★ suivent la décision IA et les 4–5★ restent disponibles sans analyse. L’appel OpenAI utilise `OPENAI_MODEL`, traite l’avis comme donnée non fiable, impose un JSON Schema strict et valide une seconde fois avec Zod. Une erreur IA conserve toujours l’avis.

## Déploiement

La démo statique est publiée sur GitHub Pages par `.github/workflows/deploy-pages.yml`. Ce build force `VITE_DEMO_MODE=true`, `REVIEW_PROVIDER=mock` et le routeur hash adapté à Pages. Aucune variable Supabase et aucun secret fournisseur ne sont injectés. Le backend réel se déploiera séparément sur Supabase lorsqu’il sera activé.
