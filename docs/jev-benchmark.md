# Benchmark expérimental Jev — Phase 1

Ce benchmark est un **decision-layer benchmark** : sentiment textuel et huit
signaux d'axes. La V6 reste inchangée. Sol persisté est une référence de comparaison,
pas une vérité absolue. Aucun appel OpenAI, aucune extraction de thèmes Jev,
aucune rédaction et aucune modification du pipeline de production.

## Interface mobile temporaire

Dans **Plus → Test Jev** (FR) / **Thêm → Thử nghiệm Jev** (VI), seuls les
owner/admin/manager disposent de l'entrée. La route est `/plus/jev-benchmark`.
Les paramètres restent fixes : `jev-latest`, trois répétitions, concurrency huit.

La page lit les sources V6 terminées via le GET authentifié `?eligible=1`,
puis retrouve le benchmark via `?source_generation_id=...` (priorité running,
completed, failed). Aucun snapshot texte n'est retourné à l'application.
Le suivi utilise exclusivement GET par `benchmark_id` toutes les 2,5 secondes
pendant running et uniquement lorsque la page est visible. Le retour au premier
plan relit l'état ; aucun événement de cycle de vie ne lance un POST.

Le clic est protégé immédiatement, sérialisé entre onglets lorsque Web Locks
est disponible, et précédé d'une nouvelle lecture de l'état serveur. Une petite
référence est conservée dans localStorage par utilisateur + source. En cas
d'issue réseau incertaine, un marqueur pending interdit de relancer automatiquement.
Un échec confirmé peut être réessayé uniquement avec un nouveau clic explicite.

Le dernier V6 terminé est proposé par défaut pour chaque établissement. Lorsqu'il
existe plusieurs snapshots V6, un choix de dataset permet de sélectionner aussi
la référence antérieure. Ce choix est mémorisé par utilisateur. Au 6 octobre,
Shabu possède deux snapshots : 101 avis (le plus récent) et 100 avis (la référence
initialement demandée). Pour le premier benchmark demandé, choisir **100 avis**.
Le frontend ne contient aucun identifiant de génération codé en dur.

Les résultats présentent coût, temps, accord, stabilité et F1 par axe au seuil
0,50. Les faibles F1 (<0,80) restent visibles séparément. Les différences de
workload, le tarif configuré et les trois répétitions sont explicitement signalés.
Les détails techniques sont repliables ; jamais de clé ou de texte d'avis.

Retrait facile : route dans `App.tsx`, entrée dans `SettingsPage.tsx`, page/style,
traductions `i18n/jev.ts`, et modules `lib/jev-benchmark.ts` / `use-jev-access.ts`.
Le drapeau `JEV_EXPERIMENT_ENABLED` permet également de masquer l'accès.
Le backend reste indépendant de ce retrait.

## Configuration exclusivement Supabase

Projet autorisé : `ihuztjkblywzjdruusdj`.
Ajouter `TYPESAFE_API_KEY` dans **Edge Functions → Secrets** du projet.
La fonction lit ce secret via `Deno.env.get('TYPESAFE_API_KEY')` uniquement.
Ne pas placer la clé dans GitHub, le frontend ou un fichier source.
Sans secret, un POST authentifié renvoie HTTP 503 `JEV_NOT_CONFIGURED`
avant toute lecture du snapshot, écriture du benchmark ou requête Jev.

Variables optionnelles :

| Variable | Défaut |
| --- | --- |
| `JEV_MODEL` | `jev-latest` |
| `JEV_BENCHMARK_CONCURRENCY` | `8` (maximum 8) |
| `JEV_INPUT_USD_PER_MILLION` | `0.042` |
| `SOL_INPUT_USD_PER_MILLION` | `2` |
| `SOL_OUTPUT_USD_PER_MILLION` | `10` |

Le modèle demandé peut être précisé dans le POST. L'alias est fixé pour tout le
benchmark. `/v1/models` est vérifié avant les décisions. Les modèles réellement
servis et l'usage de chaque réponse sont conservés. Plusieurs modèles servis
déclenchent un indicateur dans `comparison.jev.multiple_served_models`.

## Lancement manuel unique

Le script `scripts/run-jev-shabu.browser.js` peut être exécuté dans la console
d'un onglet HOME Reviews déjà connecté. Il récupère la session utilisateur
existante en mémoire, ne l'affiche pas, lance un seul POST et interroge ensuite
uniquement par GET. Il n'est jamais importé par le frontend ou le déploiement.
Une marque locale évite une relance involontaire dans le même onglet ; en cas
d'issue réseau ambiguë, inspecter la table avant toute nouvelle tentative.

POST vers
`https://ihuztjkblywzjdruusdj.supabase.co/functions/v1/benchmark-jev-historical-analysis`
avec `Authorization: Bearer <JWT utilisateur HOME Reviews>` et
`Content-Type: application/json`. Le compte doit être owner/admin/manager de
l'organisation source. Une clé service role n'est pas une session utilisateur.

```json
{
  "source_generation_id": "1629f8d2-80da-42a7-92c7-af18ff04da32",
  "repeat_count": 3,
  "concurrency": 8,
  "model": "jev-latest"
}
```

La réponse HTTP 202 contient `benchmark_id`. Le traitement reste attaché à
ce lancement via `EdgeRuntime.waitUntil`, sans cron. Lire le résumé avec un
GET authentifié à la même URL et `?benchmark_id=<id>`.
**Ne pas répéter le POST pour interroger la progression** : cela lance un autre
benchmark. Un index unique empêche deux runs simultanés sur la même source.

Les décisions sont sauvegardées après chaque groupe de maximum huit avis.
Les répétitions restent séquentielles, avec le même ordre de snapshot, les mêmes
questions et le même alias. Une requête contient exactement neuf questions et
seulement `review_alias` et `original_text` comme state.
Les textes vides n'appellent pas System One. Les `null` dans leurs répétitions
signifient absence de décision Jev, pas sentiment neutre.

Timeout HTTP : 15 s. Maximum deux retries pour 429, 5xx et panne réseau
temporaire, avec backoff 1 s puis 2 s. Aucun retry pour 401, 403 ou 422.
Les échecs d'authentification/contrat interrompent les vagues suivantes.
Une limite de temps de 90 s vérifiée après chaque groupe arrête un benchmark
trop lent en conservant les résultats partiels. Une interruption forcée du
runtime peut laisser un run `running` ; vérifier ses données et ses logs avant
toute reprise manuelle. Aucune reprise ni suppression automatique.

## Lecture des résultats

`comparison` contient les métriques par répétition et leurs agrégations :

- Sentiment brut : avis avec texte uniquement, y compris les `insufficient`.
- Sentiment + fallback V6 : `insufficient` ou avis sans texte, note >= 4 positive,
  note <= 3 negative. Comparaisons avec texte seul et ensemble complet séparées.
- Matrice de confusion : lignes Sol V6, colonnes Jev ; désaccords par review_id.
- Axes : Service, Quality, Price, Atmosphere, chaque polarité et seuil
  0.50/0.70/0.80. Booléen de référence = existence d'au moins un finding V6
  correspondant au thème de l'axe. Pas de nouveaux findings.
- Les métriques agrégées des axes sont **pooled** sur avis × répétitions.
  Les métriques de chaque répétition sont également disponibles.
- Precision/recall/F1 vs référence Sol sont `null` si leur dénominateur est nul.
- Stabilité Choice : égalité de toutes les répétitions pour les avis avec
  répétitions complètes. Un seul repeat ne permet pas de mesurer la stabilité.
- Variation Noul : moyenne, min, max et écart max-min par avis et signal, puis
  dérive moyenne/max par signal. Pas d'arrondi avant les calculs.
- Durées : wall-clock total, HTTP individuels, évaluations incluant retries,
  moyenne/p50/p95/max. `request_count` compte les tentatives System One, retries
  inclus ; la vérification de modèles sans décisions est séparée.
- Usage : addition des compteurs API, y compris les réponses reçues dont le
  contrat de décision serait invalide mais l'usage/modèle lisibles. Les requêtes
  échouées sans usage retourné ne permettent pas de mesurer une éventuelle facture.

Le coût est une **ESTIMATION AU TARIF CONFIGURÉ**, avec les tarifs conservés.
Les totaux Jev incluent toutes les répétitions (trois par défaut), contre un
seul run source Sol ; ne pas confondre ce total expérimental avec un coût unitaire.
Le coût Sol représente le run complet extraction + narrative. Son temps comprend
l'orchestration worker/cron. Jev Phase 1 ne remplace pas ce workload complet :
**potential savings require a full hybrid benchmark**. Aucune économie de
production définitive n'est annoncée.

Le verdict de sentiment utilise l'accord brut : >=95 % excellent, >=90 %
prometteur, sinon insuffisant pour remplacement direct. Stabilité : >=98 %
excellente, >=95 % bonne, sinon à investiguer. Toujours examiner séparément
Price et Atmosphere. Les données partielles ne constituent pas un benchmark
réussi (`metrics_complete=false`).

## Isolation et sécurité

Écriture seulement dans `jev_benchmark_runs`. `historical_report_runs` est une
table serveur sans policy SELECT utilisateur : lecture initiale de l'organisation,
vérification owner/admin/manager, puis lecture serveur du snapshot filtrée sur
cette organisation. Les résumés benchmark utilisent le client utilisateur et RLS. La table donne
SELECT aux seuls owner/admin/manager de l'organisation, et les écritures au
service role uniquement. Pas de texte, clé, auteur, réponse propriétaire,
contexte Google ni sous-note dans les décisions persistées.

Toutes les questions indiquent que le texte est une donnée non fiable, jamais
une instruction. Le test de prompt injection vérifie cette séparation dans la
requête ; il ne prétend pas prouver empiriquement l'immunité du modèle.

Logs : `JEV_BENCHMARK_STARTED`, `JEV_REQUEST_COMPLETED`, `JEV_REQUEST_RETRY`,
`JEV_BENCHMARK_COMPLETED`, `JEV_BENCHMARK_FAILED`. Identifiants, alias, répétition,
durée et modèle seulement ; jamais texte ni secret.

## Vérification

```text
npm test -- --maxWorkers=2 --testTimeout=30000
npm run lint
npm run build
npm exec --yes --package=deno -- deno check --node-modules-dir=none --no-lock supabase/functions/benchmark-jev-historical-analysis/index.ts
```

Les tests utilisent uniquement des mocks HTTP. Ils ne lancent ni Jev ni OpenAI.
Le client utilise le contrat officiel TypeSafe :
[OpenAPI System One](https://api.typesafe.ai/redoc).
