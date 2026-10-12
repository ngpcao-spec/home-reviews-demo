# Luna Decisions : lancement manuel des 40 preuves

Pipeline expérimental : `openai-decisions-evidence40-run-v1`. Configuration historique inchangée : `luna-decisions-evidence-choice-v1`. Modèle demandé : `gpt-6-luna`, endpoint exclusif `POST /v1/decisions`.

## Sources vérifiées

- Expérience immuable : `73a7bfe9-c618-4e2f-aa82-3b0fae8eb989`.
- Contrôle : `3988aa10-0c5c-4a52-b1ff-1b576b488c52` : 40 associations sur 40 avis distincts, anglais figé.
- Comparateur V3 : `dae5d565-6a72-4955-aa01-a4e79c218d12`.
- Références GPT-6 originales : 4 incertitudes exclues des comparaisons binaires. Réexamen IA rétrospectif déjà utilisé, pas Gold humain ni nouvelle évaluation indépendante.
- Empreinte du nouveau manifeste : `c1f7fbcd9f47c1f5c33201e78e7c26c22b92afa9f2bdca8f30d6e6bc711aaf43`.
- 40 hashes de payload vérifiés contre la préparation existante. 23 527 tokens d’entrée estimés ; 0,0023527 USD au tarif standard configuré de 0,10 USD/million. Les tokens facturés, suppléments et accès bêta restent inconnus avant une exécution autorisée.

## Parcours iPhone/iPad

Plus / Thêm → Test Jev → OpenAI Decisions — Test expérimental → Vérifier 40 preuves.

1. Lire le périmètre, le coût et les limites.
2. « Prévisualiser gratuitement » enregistre uniquement le manifeste figé.
3. Lire les questions et textes exacts. Le bouton distinct « Confirmer le coût et lancer Luna » crée atomiquement l’unique run autorisé et ses 40 tâches.
4. La progression reste disponible après fermeture ou rechargement. « Vérifier l’état » ne déclenche aucun appel IA.

Luna Choice et Luna Predicate restent désactivés. Le GO dans ChatGPT, une lecture GET, le chargement de l’écran et le déploiement ne créent aucune autorisation de dépense.

## Tables et serveur

Tables dédiées `analysis_decisions_evidence40_plans`, `_runs`, `_tasks`, `_events`. RLS : lecture uniquement pour owner/admin/manager de la même organisation ; aucun accès anonyme ni écriture client. RPC service-only, SECURITY INVOKER et search_path vide. Plans, événements et états terminaux immuables.

Edge `decisions-evidence40` : authentification utilisateur et rôle, revalidation de toutes les sources avant préparation/confirmation, coût et SHA obligatoires. Edge `process-decisions-evidence40` : secret ordonnanceur serveur, file durable. Le cron ne réveille un worker que si un run explicitement confirmé existe.

Une réservation transactionnelle précède chaque requête. `request_count <= 1`, 40 positions uniques, un seul run par plan et un seul plan par expérience/version. Aucune réinitialisation, aucun retry après timeout, 429, 5xx ou perte de réponse. Une tentative perdue devient `billing_uncertain` après cinq minutes. Un refus d’accès annule les tâches non envoyées ; aucun basculement sur Responses, JEV ou Sol. Quatre tâches au maximum en parallèle, huit tâches nouvelles par invocation ; la file peut reprendre les tâches jamais envoyées.

La clé OpenAI reste uniquement dans les secrets Edge. Aucun probe payant de la bêta. Les réponses, distributions, confiance, refus, usage/cache, modèle servi, IDs éventuels, durées et SHA sont enregistrés séparément. Les coûts sont calculés sur les tokens observés au tarif standard ; ils ne sont pas présentés comme une facture vérifiée.

## Vérification technique

1 440 tests unitaires ; 4 tests Deno sans réseau ; checks/lint Deno ; SQL/RLS/idempotence/anti-retry sur transaction annulée ; lint et build ; 16 tests Playwright FR/VI sur 360/390/430 et iPad 768 px. Fournisseurs exclusivement simulés. Le manifeste réel a été vérifié hors réseau, sans appel provider.

À la livraison technique : 0 plan, 0 run, 0 tâche, 0 tentative et 0 événement réels. Aucun rapport généré, aucune configuration historique modifiée, aucune activation en production.

## Correctif de prévisualisation du 12 octobre

Le rôle `service_role` ne possède pas de lecture SQL de `auth.users`. Le premier test SQL, exécuté comme `postgres`, avait masqué ce défaut. La prévisualisation renvoyait alors `EVIDENCE40_DATABASE_FAILED` avant toute création de plan.

Les RPC restent SECURITY INVOKER et réservées au service. Elles vérifient l'appartenance et le rôle via `organization_members`. L'état actif/non supprimé/non banni du compte est vérifié côté serveur avec `auth.admin.getUserById`, avant préparation/confirmation et avant chaque réservation de tâche. Aucun droit de lecture supplémentaire de `auth.users` n'a été accordé. Aucun SECURITY DEFINER n'a été ajouté.

Le test SQL s'exécute maintenant avec `SET LOCAL ROLE service_role` et vérifie explicitement l'absence de lecture de `auth.users`. Les appels de confirmation, réservation et finalisation restent exclusivement des simulations annulées par ROLLBACK. Onze tests unitaires supplémentaires contrôlent la lecture Auth, les comptes invalides, la réservation et les diagnostics sans secrets. Les logs RPC ne contiennent que le nom de l'opération et le code d'erreur.
