# Menus automatiques HOME Reviews — préparation du 24 novembre 2026

## Architecture livrée

L'import des avis n'attend pas le menu. Un trigger sur le passage de
`initial_import_jobs.status` à `completed` programme le menu, dans la même
transaction que la finalisation. Il couvre `finalize_initial_import_job`
et le chemin court `join_available_shared_restaurant`, sans recopier leurs
règles ni modifier leurs workers. Seuls les imports initiaux réussis, de nouveaux
établissements créés après l'installation, sont éligibles. Les réimports,
imports partiels, traitements en cours, anciens établissements et changements de
configuration ne provoquent aucun rattrapage.

Une erreur de mise en file ne fait pas échouer l'import des avis : le diagnostic
SQLSTATE est conservé dans `private.rainminer_menu_enqueue_errors`. Le panneau
affiche alors un échec et permet une demande manuelle autorisée.

Le Cron existant `home-reviews-rainminer-menu` continue d'appeler la fonction
`rainminer-menu`. Son worker a été extrait dans
`_shared/rainminer-menu-worker.ts` pour exécuter les mêmes étapes en test.
Le navigateur ne fait que lire l'état et éventuellement confirmer une relance.

- Plusieurs jobs peuvent être **queued**.
- Une seule extraction est **starting/running/unknown** dans toute la file.
- Un verrou PostgreSQL et un index par Place ID empêchent deux réservations
  actives pour le même restaurant.
- Les demandes de plusieurs organisations rejoignent le même job via
  `private.rainminer_menu_requests`, uniquement après validation de leur propre
  établissement et de son Place ID. Seul le contenu de menu est réutilisé ;
  aucun avis, état privé, organisation ou abonnement n'est partagé par ce lien.
- Un index durable limite à une tentative automatique par Place ID. Une tentative
  échouée n'est pas relancée par l'ajout du même restaurant dans un autre compte.
- Un résultat terminé, même vide, est réutilisable. Un menu déjà enregistré dans
  le catalogue partagé est réutilisé sous les règles d'activation existantes.
- La suppression d'un établissement retire ses liens de demande, mais conserve
  le job, son reçu et son engagement de dépense. Les autres comptes gardent accès.
- Un bail expiré avant l'autorisation de POST peut reprendre le précontrôle.
  Après l'autorisation, il devient **unknown** et ne peut jamais provoquer un
  nouveau POST automatiquement. Un ID de run et un reçu d'identité déjà sauvés
  permettent uniquement de reprendre les GET de ce run. Le Cron reconnaît aussi
  ce cas après un échec du premier checkpoint ; sans ID vérifié, il ne reprend pas.

## Données et interface

Aucun changement du classificateur `rainminer-menu.mjs`. Les doublons, variantes,
articles `review`, noms, catégories, descriptions, prix absents et devises sont
conservés. Seules les boissons reconnues par le filtre existant sont exclues des
références ; le JSON brut complet reste stocké.

Les jobs conservent l'input envoyé, les tarifs contrôlés, le reçu du run, son build,
ses dates, la date de récupération, le coût fourni par Apify et les références.
Les archives du catalogue conservent leur provenance ; un retraitement du filtre
peut actualiser les références sans remplacer le brut.

Le panneau existant affiche en FR/VI : en attente, extraction en cours, menu
disponible, aucun plat trouvé, extraction échouée, vérification nécessaire.
Le dernier menu reste affiché pendant une nouvelle tentative. Chaque lancement
manuel demande confirmation du plafond, envoie `confirm_paid: true` et réutilise
un request ID conservé localement en cas de réponse perdue. Le serveur impose
également cette confirmation. Une demande au résultat inconnu ne propose pas de
nouveau lancement.

## Coûts et configuration

Migrations : `20261124030622_automatic_rainminer_menu_queue.sql`, puis
`20261124035425_rainminer_menu_five_dollar_release_guard.sql`.

La nouvelle configuration privée est initialement :
`automatic_enabled=false`, `launches_enabled=false`,
`budget_limit_usd=5`, `configured_at=null`, `per_run_limit_usd=0.5`,
`billing_ceiling_evidence=null`, `first_test_job_id=null`.
Aucune dépense n'est autorisée par la migration.

Le compteur de dépenses est **cumulatif depuis cette évolution**, pour les nouveaux
runs automatiques et manuels. Il ne se réinitialise pas chaque jour/mois. Avant
POST, le serveur réserve atomiquement le plafond de chaque run. Une fois le run
terminé, le coût communiqué dans un reçu terminal compatible remplace la réserve.
Le reçu doit confirmer l'Actor, le run, PAY_PER_EVENT et le plafond explicite.
Le montant conserve sa précision numérique, sans arrondi libérant du budget.
Si le coût manque ou si le
lancement est incertain, la réserve est conservée. Les anciens runs actifs ou
inconnus gardent une réserve conservatrice de 0,50 USD ; les anciennes dépenses
terminées ne sont pas refacturées ni intégrées rétroactivement.

L'Actor doit conserver l'identité `8GGZ9N7j2JhqnQ3oT`, être opérationnel et utiliser
PAY_PER_EVENT sans facturation de plateforme supplémentaire à la charge du client.
Son minimum doit tenir dans le plafond configuré, lui-même limité à 0,50 USD.
Le POST conserve `maxTotalChargeUsd` et `restartOnError=false`.
L'input existant reste : un Place ID, 10 photos maximum, 100 éléments maximum.
Ces limites peuvent produire un menu partiel ; aucun contenu manquant n'est inventé.

Contrôle public de l'Actor effectué le 24 novembre 2026, sans clé et sans run :
identité correcte, notice NONE, PAY_PER_EVENT, pas de minimum annoncé.
Tarifs publiés dans la réponse API : établissement 0,0069 USD ; photo analysée
0,0049 USD ; élément 0,0009 USD. Le worker revérifie les tarifs au moment du
lancement. Ces montants ne sont pas un reçu réel de ce test.
Sources : https://apify.com/rainminer/google-maps-menu-scraper et
https://docs.apify.com/api/v2/actors-runs-post.

Le pilote utilisait un plafond global de 5 USD. La migration
`20261127141607_remove_rainminer_global_budget_limit.sql` rend ce plafond facultatif.
En régime normal, `budget_limit_usd=null` retire le blocage cumulé. Un montant
explicite permet de rétablir un plafond partagé. L’historique des coûts reste
disponible et les réservations restent attachées aux runs. Ne jamais effacer les
réservations ni remettre des jobs en queued pour libérer du budget.

**Limite tarifaire constatée lors de la préparation** : la documentation Apify
garantit le plafond des événements PPE, mais indique que les lectures du dataset
après le run entraînent des frais de plateforme. La garantie d'un total de
0,50 USD incluant ces opérations n'est donc pas établie pour ce compte.
`billing_ceiling_evidence` reste NULL : même si les drapeaux sont activés par
erreur, `MENU_COST_CEILING_UNVERIFIED` interdit tout nouveau POST.
Ce champ exige une preuve applicable au compte que ces coûts sont inclus dans
le montant total du reçu ou non facturés ; ni une estimation ni la réussite d'un
mock ne convient. Aucun contournement n'est prévu dans le déploiement.
Source : https://docs.apify.com/actors/running/actors-in-store (Post-run storage costs).
Si un reçu contredit malgré tout le plafond, les lancements sont désactivés et
la preuve invalidée ; le montant signalé est conservé.

## Déploiement préparé, non exécuté

1. Sauvegarder le schéma et les lignes rainminer, leur raw/result, ainsi que les
   versions de menus partagées. Vérifier APIFY_API_TOKEN côté serveur, l'URL Vault
   `home_reviews_rainminer_worker_url` et le token du Cron, sans afficher leurs valeurs.
2. Mettre uniquement le Cron menu en pause et attendre la fin des précontrôles
   démarrés par l'ancien worker. La migration refuse une ligne **starting**.
   Si son lancement est incertain, retrouver le run avant toute résolution.
   Aucun changement des Crons d'avis ou de rapports.
3. Appliquer uniquement les deux nouvelles migrations, dans l'ordre ci-dessus. Elles gardent les jobs et les menus
   existants ; elle n'enfile pas les établissements historiques.
4. Déployer `rainminer-menu` avec son helper, puis le client. Ne pas redéployer les
   workers d'avis, rapports ou recommandations.
5. Vérifier le budget 5 USD, le plafond 0,50 USD, les deux drapeaux false,
   `configured_at` et `billing_ceiling_evidence` NULL. Ne pas armer de test.
6. Vérifier uniquement les lectures et les droits. Les lancements restent
   désactivés. La reprise du Cron pour lire un run connu ne doit pas être
   confondue avec l'autorisation de créer un run.

La préparation, le premier test futur limité à une seule tâche et les contrôles
de sauvegarde sont détaillés dans [rainminer-production-preparation.md](rainminer-production-preparation.md).
Le premier test attend une autorisation distincte et la levée documentée du
blocage tarifaire. Il ne nécessite pas l'activation automatique globale.

Le drapeau automatique seul n'autorise pas de coût : activation, autorisation
de lancement, garantie tarifaire, périmètre du test et budget sont contrôlés en base.
La désactivation bloque les nouvelles réservations, y compris après un claim
mais avant le POST. Les POST déjà autorisés peuvent finir et leurs runs connus
continuent d'être consultés. Retirer le secret URL du worker couperait aussi ces
lectures : utiliser les drapeaux pour une pause normale.

## Retour arrière sans perte

Mettre `automatic_enabled=false` pour retirer l'automatisation, ou les deux
drapeaux à false pour arrêter aussi les lancements manuels. Garder le nouveau
worker et le Cron pour terminer les lectures des runs déjà autorisés.
Les jobs en attente restent stockés. Aucun retour à queued d'un lancement
incertain, aucune suppression de raw, résultat, reçu ou réserve budgétaire.

Laisser la migration additive en place. Ne pas restaurer l'ancien worker après
activation : il ne connaît pas le budget global ni les demandes multi-comptes.
En cas de retour d'interface seulement, conserver la confirmation des demandes
payantes ; les anciennes requêtes sans `confirm_paid` sont refusées sans coût.

## Vérifications reproductibles

- `npx vitest run tests/unit/rainminer-menu-automation.test.ts src/components/RainminerMenuPanel.test.tsx --maxWorkers=1`
  exécute le SQL et le worker réels sur PostgreSQL PGlite isolé, ainsi que le panneau.
  Seuls le schéma réduit des modules hors périmètre, Auth et le fournisseur y sont simulés.
  Il couvre succès, absence de plats, pagination, Place ID absent/invalide,
  plusieurs jobs, deux organisations, réutilisation, coûts, erreurs, interruption,
  réponse POST perdue, checkpoint perdu, reprise des GET, relance explicite,
  droits, suppression du propriétaire et absence de backfill.
- Le workflow `automatic-menus-isolated.yml` reconstruit toute la chaîne de schéma
  dans Supabase Linux éphémère, crée deux vrais comptes Auth, sert les Edge
  Functions réelles et vérifie le parcours navigateur mobile FR/VI. Deux requêtes
  HTTP simultanées au worker sont confrontées à PostgreSQL réel.
- Les fournisseurs Apify/IA/push externes sont bloqués ou simulés dans cette stack.
  Les screenshots et le reçu des scénarios sont publiés comme artefact de test.
  Une préparation échouée ou un scénario non exécuté fait échouer le workflow.
- Le workflow exécute aussi lint, suite de tests et build. Aucun appel payant de
  validation, aucune modification de données de production.

Consulter le reçu du dernier run réussi et le commit correspondant dans la PR ;
ne pas considérer un workflow seulement lancé comme une validation acquise.
