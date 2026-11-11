# Mutualisation HOME Reviews — version locale du 9 novembre 2026

Les parcours ci-dessous sont raccordés et testés localement. Aucun déploiement, appel Apify,
appel IA payant ou changement de données de production n'a été effectué. Les deux commutateurs
restent nécessaires : `SHARED_RESTAURANTS_ENABLED=true` côté Edge et
`private.shared_restaurant_runtime.enabled=true` côté SQL, initialement désactivé.

## Implémentation

- Identité commune par Place ID enregistré et vérifié côté serveur. Aucun rapprochement sur le nom.
  Les établissements locaux, avis locaux et identifiants de rapports sont conservés.
- `add-establishment` rattache immédiatement un compte à un corpus existant. Un restaurant nouveau
  utilise une réservation commune par restaurant, langue et configuration. Le worker rejoint le corpus
  actuel avant de consulter un ancien résultat d'import.
- Le planificateur et le worker incrémental utilisent les tâches métier existantes : verrou du restaurant,
  index d'unicité des tâches actives, cadence minimale des abonnés actifs par langue, blocage pendant
  un réimport et maintien du blocage des issues fournisseur inconnues. Build Apify `0.0.545` conservé.
- Le commit validant la continuité distribue les données publiques aux projections locales sans copier
  leurs états privés. Chaque projection conserve au maximum 150 avis. Un réimport manuel terminé
  distribue aussi son corpus comme historique, après archivage des preuves des rapports.
- Traductions FR/VI/EN : réutilisation avec empreinte de texte correspondante. Une traduction ancienne
  sans empreinte vérifiable reste locale ; sa compatibilité n'est pas supposée.
- `analyze-review` réserve le calcul commun par contenu, langue, modèle et configuration. Les autres
  comptes attendent une réponse confirmée. Un rappel durable limité au cache remplit leurs propres
  brouillons et notifications. Ce rappel ne peut pas lancer une IA.
- JEV conserve ses tâches et reçus natifs. Les identités locales pointent vers une analyse compatible
  commune. Les résultats réussis antérieurs au catalogue sont recherchés ; une issue inconnue bloque.
- Sol réutilise uniquement une réponse validée à une requête native strictement identique. Le run et
  le reçu d'origine restent traçables, sans nouvelle facturation dans le relevé de consommation.
- Les reprises de rapports échoués gardent leurs règles : nouvelle tentative, aucun lot partiel réutilisé,
  aucune relance payante automatique, protection contre une publication tardive. Le correctif SQL qui
  évite le recalcul JEV en double reste inchangé.
- Publications et autres rapports V2 réussis disponibles : archives avec preuves publiques, sans champs
  de brouillon. La rotation des avis ne supprime plus ces preuves. Une source déjà perdue n'est pas inventée.
- `CurrentReports` expose les versions partagées avec date et langue. Elles restent explicitement datées.
- Menus Rainminer : JSON brut, provenance et résultat filtré partagés ; boissons exclues, doublons,
  variantes et plats sans prix conservés. Aucun classement ni nouvel import ajouté.
- Le désabonnement appelle `remove_establishment_subscription` : retrait des données privées concernées,
  projection locale désactivée, restaurant commun et accès des autres comptes conservés. Les politiques
  RLS existantes restent en place ; les anciens liens du compte désabonné sont restreints.
  Une suppression directe par un ancien client est refusée avec `USE_SUBSCRIPTION_REMOVAL`.

## Parcours effectivement vérifiés

| Parcours | Preuve locale |
|---|---|
| Restaurant connu | Deux appels simultanés au vrai handler `add-establishment`, deux connexions PostgreSQL natives, projections distinctes immédiatement remplies, aucune collecte |
| Restaurant nouveau | Même handler, réservations concurrentes, vrai worker initial et vraie persistance : un fournisseur simulé appelé une fois, deux imports terminés et avis historiques accessibles |
| Planification | Deux connexions réellement concurrentes : résultats 1 et 0, une seule tâche créée |
| Synchronisation | Vrai `processApifyJob`, normalisation et commit sur PostgreSQL : résultat simulé contenant le repère et un nouvel avis négatif ; un ajout par compte |
| Cadences/langues | 2 heures avec l'abonné rapide, puis 12 heures après son départ ; abonnement VI et tâche VI distincts, sans nouvelle tâche FR |
| Analyse/alertes | Vrai handler `analyze-review`, premier fournisseur simulé maintenu en attente pendant le second appel : un calcul, rappel du cache, deux brouillons et deux notifications |
| Confidentialité | RLS de l'application, rôle `authenticated`, deux identités : lectures croisées invisibles, notification étrangère non modifiable, édition indépendante des brouillons |
| Abonnement tardif | Reprise historique du corpus sans notification rétroactive d'avis négatif |
| Menus/traductions | Vrai filtre Rainminer : 3 lignes, 1 boisson exclue, 2 doublons sans prix conservés ; JSON brut inchangé ; traduction vérifiée reprise |
| Désabonnement | RPC réelle, autre compte toujours accessible, ancienne projection inaccessible sous RLS, menu commun conservé |
| Preuves historiques | Ancien avis retiré après ingestion de 150 plus récents ; citation toujours disponible ; marqueur de brouillon privé absent |
| Réimport | Staging/application SQL réels ; corpus distribué sans alertes historiques ; preuves conservées ; compte désabonné non réactivé |
| JEV | Allocation, réservation, réception et projection SQL dans PGlite : une tâche native partagée entre organisations ; reçus conservés ; cache antérieur retrouvé |
| Sol | Moteur de lots réel et réservation SQL PGlite : attente de validation, reçu réutilisé, deux rapports validés pour un appel simulé ; reprise après échec non mutualisée |
| Interface | Composants FR/VI : doublons et prix manquants affichés ; choix d'un rapport daté dans sa langue ; uniquement des requêtes de lecture |
| Retour arrière | Refus avec opérations actives/inconnues ; désactivation après drainage sans suppression des données communes |

Les tests natifs utilisent des serveurs PostgreSQL temporaires sur `127.0.0.1`, ports libres et
plusieurs connexions. Aucune URL distante n'est acceptée. Les fonctions et contraintes métier viennent
des migrations et définitions sauvegardées. Fournisseurs, Auth distant, push, `net.http_post` et cron
sont simulés. L'adaptateur PostgREST de test exécute du vrai SQL, sans remplacer les tables par des objets.

## Reproduction

Installer `embedded-postgres@18.6.0-beta.19` et `pg` hors du dépôt et définir
`HOME_REVIEWS_TEST_POSTGRES_PACKAGE` vers ce répertoire. Sans cette variable, les deux tests natifs
sont explicitement ignorés. Utiliser `--maxWorkers=1` pour limiter la mémoire des bases PGlite ;
les transactions concurrentes internes aux tests restent réellement simultanées.

Suites ciblées :

```text
tests/unit/shared-operation.test.ts
tests/unit/shared-restaurant-foundation.test.ts
tests/unit/shared-restaurant-postgres.test.ts
tests/unit/shared-restaurant-native-runtime.test.ts
tests/unit/shared-jev-sql.test.ts
tests/unit/shared-jev-worker.test.ts
tests/unit/shared-report-sol.test.ts
tests/unit/manual-review-reload.test.ts
tests/unit/current-report-publication-read.test.ts
tests/unit/report-abandonment.test.ts
tests/unit/incremental-review-sync.test.ts
tests/unit/menu-reference.test.ts
supabase/functions/_shared/jev-batch-experiment.test.ts
supabase/functions/process-initial-import-jobs/shared-import.test.ts
supabase/functions/process-initial-import-jobs/reload.test.ts
src/components/CurrentReports.test.tsx
src/components/RainminerMenuPanel.test.tsx
```

Autres vérifications : `npm run build`, `npm run lint`, `git diff --check`.

Résultat du 9 novembre : 17 suites ciblées, 134 tests réussis ; build, lint et contrôle du diff réussis.
Le scénario natif a ensuite été rejoué pour vérifier le script de migration avec manifeste et le refus
de suppression directe, sans perdre les identifiants des avis ni créer d'appel fournisseur.

## Migration progressive et retour arrière

Les migrations commencent à `20261108160000`, restent additives et n'activent pas le dispositif.
`supabase/maintenance/seed-shared-restaurants.sql` attend un manifeste audité d'établissements,
Place IDs et autorités d'organisation. Il reprend les contenus sans collecte et refuse une identité
incompatible. Ce manifeste et ce script n'ont pas été exécutés en production.

`supabase/maintenance/disable-shared-restaurants.sql` contrôle les imports initiaux, synchronisations,
opérations génériques, JEV et Sol avant de désactiver le commutateur. Il refuse de rouvrir les parcours
indépendants tant qu'une opération commune risque encore de consommer un fournisseur. Aucune donnée
n'est supprimée. Les projections locales restent disponibles selon les règles historiques ; les archives
communes restent stockées pour une réactivation contrôlée.

## Limites de validation

- Essais PostgreSQL et composants React, pas parcours navigateur complet sur une stack Supabase déployée.
  Aucun JWT distant, push réel ou Edge Runtime Deno déployé n'a été testé.
- Le schéma de test assemble les définitions sauvegardées et migrations pertinentes ; il ne rejoue pas
  l'intégralité des anciennes migrations et extensions Supabase.
- L'inventaire et le manifeste des identités réelles restent à valider avant activation. Un doublon
  conflictuel au sein d'une organisation doit être examiné, sans fusion destructive.
- Sol exige l'identité exacte de la requête. Des sélections de preuves ou ordres d'alias différents ne
  sont pas déclarés équivalents automatiquement.
- L'acheminement distant des rappels et push n'est pas couvert. Un rappel de cache perdu ne refacture
  pas l'analyse ; son résultat reste disponible via le parcours de lecture/analyse.

Ces limites empêchent de présenter les essais locaux comme une validation du déploiement en production.

## Contrôle avant activation — 9 novembre 2026

Statut : activation non validée. Aucun déploiement, aucune fusion, aucun appel fournisseur payant.
Skill Supabase appliqué pour l'inspection. Les seules opérations distantes sont des lectures.

### Identités existantes

Projet inspecté : `ihuztjkblywzjdruusdj` (Home review). Les 24 établissements sont actifs et appartiennent
à une organisation. Inventaire conservé dans `shared-restaurants-identity-audit-20261109.json`.
24 Place IDs et 24 CIDs distincts, aucun identifiant absent, aucune divergence entre Place ID et
`query_place_id` de l'URL. Aucun nom identique après trim/minuscules associé à deux Place IDs différents.
Ce contrôle des noms sert uniquement à signaler une ambiguïté, jamais à décider une fusion.

Les 177 `establishment_snapshots` ont été contrôlés : 105 renseignent `placeId`, 72 ne le renseignent
pas. Aucun Place ID renseigné ne contredit celui du restaurant, aucun CID renseigné ne contredit
`google_id`. Chacun des 24 restaurants possède au moins un instantané concordant. Aucun conflit
avec les Place IDs de `rainminer_menu_jobs` ni les `expected_google_id` des imports initiaux liés.
Aucun cas ambigu démontré dans ces correspondances. Les instantanés sans identifiant ne constituent
pas des preuves autonomes. Cette vérification porte sur les sources sauvegardées, pas sur une nouvelle
résolution Google ni sur la validité actuelle d'un éventuel changement d'identité Google.

### Environnement et essais observés

Les deux connexions Supabase disponibles ont été inventoriées. Aucun projet de test HOME Reviews
identifié et `list_branches` du projet Home review retourne une liste vide. Les autres projets ne sont
pas des environnements de test autorisés pour cette application.
`npx supabase status` échoue avec `StatusDbInspectError` :
`docker: command not found (podman also not found)`.
Aucune variable d'environnement Supabase/database/test URL disponible dans cette session.
Le PostgreSQL embarqué fonctionne mais ne fournit pas GoTrue/Auth, PostgREST, Edge Runtime et leur
passerelle. Il ne permet donc pas le parcours navigateur avec deux vraies sessions Auth demandé.
Aucun test navigateur n'a été présenté comme réussi, aucun compte de production utilisé à sa place.

Rejeu local : `shared-restaurant-postgres.test.ts` et `shared-restaurant-native-runtime.test.ts`,
deux scénarios réussis en 32,50 secondes. Ils exécutent les réservations via plusieurs connexions
PostgreSQL réelles et les handlers applicatifs avec fournisseurs simulés. Ils vérifient les données
communes, la distribution d'un avis négatif, l'analyse unique, les notifications en base et brouillons
isolés par RLS, le désabonnement, les langues et fréquences. Auth et transport PostgREST restent adaptés
par les fixtures. Les notifications dans l'application sont des lignes réellement écrites dans la base
de test ; leur affichage navigateur n'est pas validé ici. Les push externes restent simulés.

Le script de reprise avec manifeste conserve les identifiants des avis du scénario. Le retour arrière
est refusé avec `SHARED_ROLLBACK_REQUIRES_DRAIN` quand une réservation est active ; après terminaison,
le commutateur est désactivé et les données de menu restent présentes. Les preuves historiques sont
testées après sortie des avis de la fenêtre de 150. Ces assertions ne remplacent pas une répétition
sur une copie complète du schéma/données : le test assemble les migrations pertinentes, pas toute
l'histoire des migrations Supabase. La préservation exhaustive reste à vérifier sur cette copie.

### Ordre proposé, à ne pas exécuter avant validation

1. Fournir une stack isolée Supabase avec Auth, PostgREST et Edge Runtime (Docker/Podman local, ou
   staging identifié). Bloquer les fournisseurs payants et les push externes ; injecter les simulateurs.
2. Sur copie de test, relever avant/après les comptes, identifiants et empreintes des avis, rapports,
   preuves, menus et données privées. Appliquer les migrations additives dans l'ordre chronologique,
   commutateur SQL désactivé. Rejouer tous les parcours navigateur avec deux utilisateurs Auth réels.
3. Tester le retour arrière complet sur cette copie, y compris les réservations JEV/Sol et synchronisations,
   puis vérifier la lecture des anciens rapports et les liens conservés. Lever les limites ci-dessus.
4. Après validation distincte : sauvegarde vérifiée, migrations additives désactivées, fonctions serveur
   compatibles, puis client compatible. Ne pas activer au milieu d'un import, rapport ou appel inconnu.
5. Pilote proposé : K.HOUSE, `ChIJTQBISo9ncDERyPcP3aY9kI4`, avec un manifeste limité à ses abonnements
   explicitement vérifiés. Réutiliser ses sources, sans réimport. Contrôler avis, menus, rapport daté,
   langue et preuves, puis l'abonnement du second compte sans notifications historiques.
6. La migration `20261109051656_shared_restaurant_pilot_allowlist.sql` ajoute maintenant une liste
   serveur vide par défaut. Après validation seulement, enregistrer le Place ID vérifié du pilote avec
   sa preuve dans `private.shared_restaurant_pilot_places`. Le drapeau global seul n'autorise plus
   aucun restaurant. Ne pas ajouter d'autres Place IDs pendant ce pilote.
7. Vérifier un cycle du pilote : une réservation par langue, cadence minimale des abonnés, analyse
   compatible unique et états privés distincts. N'élargir le manifeste qu'après validation du pilote.

Retour arrière opérationnel : suspendre les nouvelles réservations, retrouver l'issue des appels déjà
partis, laisser terminer/réconcilier les opérations, puis exécuter
`supabase/maintenance/disable-shared-restaurants.sql` et désactiver le drapeau Edge. Ne pas forcer le
script en cas de refus, ne pas supprimer les tables et ne pas relancer des appels d'issue inconnue.
Le script révoque certains droits : une future réactivation exige de restaurer explicitement les droits
depuis les migrations auditées, pas seulement de remettre le commutateur à true.

## Restriction du pilote — implémentée localement, non déployée

La liste `private.shared_restaurant_pilot_places` est vide dans la migration. Aucune insertion K.HOUSE
n'est exécutée par une migration ou un script de production. Un opérateur de base doit consigner la
preuve de vérification ; ni un client authentifié ni le rôle applicatif service_role ne peuvent modifier
la liste. Le futur pilote est `ChIJTQBISo9ncDERyPcP3aY9kI4` exclusivement.

Les RPC de résolution, abonnement, attachement, réservation d'import, planification, menus, analyse
et lecture des rapports consultent cette restriction, directement ou via
`shared_restaurant_for_establishment`. Les lectures d'archives et captures de corpus vérifient aussi
la portée. Hors liste, les entrées applicatives reprennent leurs chemins individuels ; les RPC dédiées
exclusivement à la mutualisation refusent l'opération ou retournent une absence de résultat.
L'ancienne réservation basée sur un hash sans identité est déplacée en schéma privé et retirée des
droits applicatifs. L'analyse utilise `reserve_scoped_shared_operation` avec l'identité commune.
Une clé existante ne peut pas changer de restaurant.

Admission et changement de liste prennent le même verrou transactionnel. Retirer/modifier/tronquer
la liste ou couper le drapeau est refusé avec `SHARED_PILOT_REQUIRES_DRAIN` tant que des opérations
partagées sont actives ou d'issue inconnue. Les traitements déjà engagés peuvent terminer avec leur
réservation ; aucune relance n'est créée. Après drain, retirer l'entrée ferme les lectures/réservations
communes et conserve les données, preuves et projections. Le contrôle de drain est volontairement
conservateur : il couvre toutes les opérations communes, pas seulement la ligne de liste retirée.

Vérifications rejouées parce que touchées par la restriction :

- PostgreSQL natif : liste initialement vide ; K.HOUSE autorisé dans la fixture ; autre identité refusée ;
  accès direct à l'ancienne réservation impossible ; rôle authenticated interdit sur la liste et la
  réservation serveur ; deux sessions concurrentes partagent la réservation et un fournisseur simulé.
- Retrait, TRUNCATE et désactivation globale refusés pendant le traitement. Résultat terminé réutilisé,
  puis retrait après drain ; avis/menus conservés, accès commun fermé, import renvoyé au chemin legacy.
- Parcours natif applicatif : ajout simultané via le vrai handler, worker d'import, worker de sync et
  analyse ; un appel fournisseur simulé pour les imports partagés. Deux ajouts directs hors liste
  produisent des tâches individuelles et leurs réservations retournent `legacy`, sans appel fournisseur
  pendant ce contrôle. Lectures menus/rapports et capture commune fermées après retrait, 150 avis locaux
  toujours présents. Les fixtures Auth/PostgREST restent celles décrites plus haut.
- Lint, build et contrôle du diff réussis. Pas de répétition de la totalité des 134 anciens tests.

Cette validation ne couvre toujours pas les sessions Auth réelles, le navigateur, la passerelle Edge
ni l'ensemble des migrations historiques. La restriction ne constitue pas une validation d'activation.

### Solution concrète pour Auth et navigateur

Option locale recommandée pour ne pas créer de coût cloud : installer WSL2 et un moteur de conteneurs
compatible Docker sur ce Windows, démarrer les services avec la CLI déjà présente, charger le schéma
et les données de test, créer deux utilisateurs dans Auth local, servir les workers et le client sur
les URL locales. Les mocks fournisseurs doivent être exclusifs à cette stack et les clés payantes
absentes. Prévoir virtualisation disponible, droits d'installation/redémarrage, mémoire et espace disque
pour les services. `wsl --status` confirme que WSL n'est pas installé ; Docker/Podman sont absents.
La stack native sans conteneurs documentée par Supabase ne cible pas Windows.
Source : https://supabase.com/docs/guides/local-development

Alternative cloud : branche de test isolée, avec Auth/REST/Edge et données de test. L'organisation
HOME Reviews `imczvxzfukropjnnayhu` est actuellement Free et possède déjà deux projets actifs.
Le branching requiert Pro : prix public à partir de 25 USD/mois, puis calcul Micro de branche à partir
de 0,01344 USD/heure (environ 0,323 USD pour 24 heures), plus usages éventuels. Ce sont des tarifs
publics indicatifs, pas un devis du compte ; devis et accord requis avant création. Les branches ne
bénéficient pas du plafond de dépense. Aucun changement de plan, projet ou branche n'a été créé.
Sources consultées le 9 novembre 2026 :
https://supabase.com/pricing
https://supabase.com/docs/guides/deployment
https://supabase.com/docs/guides/platform/manage-your-usage/branching

## GitHub Actions réellement exécuté — 9 novembre 2026

La voie GitHub Actions remplace la recommandation d'installer WSL2 pour la prochaine validation.
Le dépôt est public et le runner standard `ubuntu-22.04` est gratuit en calcul ; aucun runner élargi,
cache payant, artifact upload ou fournisseur payant n'est utilisé. Aucun changement de forfait.
Branche isolée : `codex/shared-restaurants-auth-validation-20261109`. Aucun push sur main, aucune PR
fusionnée et aucun workflow de déploiement déclenché par cette branche.

Observations distantes :

- https://github.com/ngpcao-spec/home-reviews-demo/actions/runs/42600598294 : succès du prérequis
  Docker + démarrage Supabase éphémère + réponse réelle GoTrue (`v2.197.0`) + suppression des services.
- https://github.com/ngpcao-spec/home-reviews-demo/actions/runs/42601066613 : préparation refusée
  par PostgreSQL sur `ALTER SYSTEM cron.launch_active_jobs` (42501). Corrigé dans le workflow en
  exécutant cette opération avec supabase_admin, uniquement dans le conteneur jetable.
- https://github.com/ngpcao-spec/home-reviews-demo/actions/runs/42601502372 : la deuxième migration
  attend le helper hébergé `public.rls_auto_enable()` absent dans l'image locale. Le préparateur ignore
  uniquement sa révocation quand la fonction n'existe pas ; aucune politique RLS applicative supprimée.
- https://github.com/ngpcao-spec/home-reviews-demo/actions/runs/42601921163 : échec démontré du replay
  de schéma à `20260928090000_recalculate_next_sync_on_interval_change.sql`, erreur PostgreSQL 42703 :
  `column organization.monitoring_interval_hours does not exist`. Le navigateur est explicitement
  marqué skipped. Nettoyage des conteneurs réussi.

Le contrôle des fichiers de migration ne trouve pas la définition initiale de cette colonne, ni celles
de `establishments.next_sync_at`, `establishments.last_sync_status` et du RPC
`verify_review_scheduler_token` utilisés ensuite. Ce n'est pas un problème de quota ou d'Auth GitHub.
Il faut une définition de référence versionnée du socle préexistant (types, valeurs par défaut,
contraintes, fonctions et droits), ou une restauration de schéma seule auditée, avant de rejouer
fidèlement l'application. Ne pas inventer des colonnes ou des RPC permissifs pour faire passer le test.

Fichiers préparés : `.github/workflows/shared-restaurants-isolated.yml`,
`tests/ci/shared-stack-prepare.mjs`, `playwright.shared-stack.config.ts`,
`tests/e2e/shared-stack.spec.ts`. Le test navigateur préparé est seulement le contrôle préalable de
deux connexions Auth réelles, de leurs organisations via RLS et de l'accès à l'interface. Il n'est pas
une implémentation achevée du scénario complet de mutualisation et n'a pas été exécuté.
Les tests des ajouts, workers, menus/rapports/preuves, avis négatif, états privés, désabonnement et
rollback restent donc non validés de bout en bout sur cette stack. Les tests PostgreSQL précédents
ne sont pas requalifiés en tests navigateur.

Séparation : URL DB limitée à localhost:54322, clés exclusivement générées par la stack temporaire,
aucun secret de production fourni au runner ; cron désactivé et URLs historiques de callbacks
remplacées par un port local inactif dans la copie de test. Aucun compte Auth de production créé,
aucune donnée réelle importée, aucune activation de K.HOUSE. Les fichiers temporaires et volumes
ont été retirés avec le runner. Aucune nouvelle exécution n'est en cours à la clôture de ce contrôle.

## Reconstruction et navigateur réels — 11 novembre 2026

Cette section remplace les limites de préparation du 9 novembre ci-dessus.
Run réussi : https://github.com/ngpcao-spec/home-reviews-demo/actions/runs/42952760483
Commit testé : `5da1928cad94de5f834c7066e492c00527e03b86`.
Job : `130300675433`. Parcours Playwright : 35,7 secondes (38,6 secondes avec démarrage du test).
Les neuf reçus obligatoires ont été émis et contrôlés. La préparation, le navigateur,
le contrôle final et l'étape de nettoyage sont tous terminés avec succès.

### Cause et reconstruction

`monitoring_interval_hours`, `next_sync_at` et `verify_review_scheduler_token` étaient
réellement absents de la chaîne Git, pas mal orthographiés dans la migration de recalcul.
Leurs définitions exactes viennent de l'historique appliqué `20260927041042` consulté
en lecture seule. La colonne d'intervalle est un smallint obligatoire, défaut 12,
avec les valeurs autorisées 1, 3, 6, 12 et 24 ; la date est un timestamptz ; le RPC
vérifie le hash SHA-256 du jeton, avec exécution réservée au service_role.

Les prérequis manquants des anciens audits et des gardes de rétention ont été retrouvés
dans le même historique. Le préparateur versionné insère 21 fichiers de référence
dans l'ordre des dépendances de la chaîne distante de 271 migrations. Le manifeste
`tests/ci/reconstruction-plan.json` distingue absences, renommages et opérations exclues.
Il restaure aussi le vrai pg_cron et le trigger hébergé de RLS, sans fonctions factices.
Les correctifs existants d'ordre des triggers JEV et de lecture des notifications,
absents de la branche distante, sont inclus avec leurs définitions appliquées exactes.

Les différences de noms/dates du socle initial et de V13 ne sont pas rejouées deux fois.
L'ancien prototype local de lecture IA des menus, jamais appliqué, n'est pas incorporé ;
Rainminer conserve sa migration appliquée `20261107120320`.
Les purges historiques, données d'audit ponctuelles, autorisations d'expérience et
l'exécution du benchmark historique sont exclus explicitement, en conservant leurs DDL,
contraintes, fonctions, droits et configurations persistantes nécessaires.

Ces fichiers de reconstruction sont hors de `supabase/migrations`. Le préparateur refuse
une base distante ou déjà initialisée et exige cron désactivé. Les secrets historiques
ne sont pas copiés : Auth et jetons sont créés uniquement dans la stack jetable.
Aucune migration déjà appliquée n'a été réécrite, aucune commande n'a écrit en production.

### Résultats observés

| Parcours réel | Résultat |
|---|---|
| Deux sessions GoTrue, deux organisations, ajout simultané depuis le navigateur | Deux projections distinctes, une seule collecte initiale et un seul POST fournisseur simulé |
| Menus et rapports | Les deux comptes voient les deux variantes alimentaires sans prix ; boisson exclue ; même rapport daté et mêmes preuves retournés par le serveur |
| Langue | Le compte passé en VI ouvre le rapport FR enregistré, sans appel IA |
| Synchronisation | Deux planificateurs concurrents créent une tâche ; deux workers démarrent un seul run, puis un cycle récupère ce même run ; nouvel avis négatif visible dans les deux comptes |
| Fréquences | Abonnements à 3 h et 12 h : échéance commune à 3 h |
| Analyse | Deux appels simultanés au vrai worker : un appel IA simulé ; résultat compatible réutilisé dans les deux comptes et callbacks de réutilisation sans nouvelle facturation |
| Données privées | Brouillon modifié dans un compte seulement ; lecture du brouillon de l'autre organisation refusée par RLS ; notification lue dans un compte, non lue dans l'autre |
| Désabonnement et réabonnement | L'autre compte conserve le menu ; réabonnement avec le même identifiant, sans collecte et sans notification rétroactive |
| Hors pilote | Appel direct authentifié pour un autre restaurant : réservation legacy, aucune identité commune créée |
| Désactivation | Refus pendant la collecte en cours ; après drainage, retrait du pilote et script de rollback exécutés, identifiants et avis conservés et consultables |

Compteurs finaux : **2 POST Apify simulés** (initial + synchronisation), **1 appel IA simulé**.
Aucun appel Apify/IA réel ni activation de production. Les notifications dans l'application
sont réelles ; les push externes ne sont pas envoyés (aucun abonnement push de test).

Le navigateur a révélé un défaut d'affichage : un rapport partagé disponible était masqué
si le moteur de la prochaine génération était Sol seul. `CurrentReports` affiche désormais
ce rapport sans changer le moteur ni les règles de relance. Les 15 tests ciblés du composant,
ESLint des fichiers concernés et la compilation TypeScript/Vite passent.
La résolution d'un restaurant ignore aussi sa projection inactive pour permettre le réabonnement.

### Portée et limites

Le navigateur, Auth, PostgreSQL, RLS, Edge Runtime et les fonctions applicatives sont réels.
Les réponses Apify et IA sont synthétiques et les URLs sont isolées dans des copies temporaires
des workers. Les cycles et callbacks sont déclenchés par le test ; cron reste désactivé.
La livraison automatique pg_net des callbacks et la livraison push externe ne sont donc pas validées.
Le rapport et le menu sont des archives synthétiques injectées avant leur lecture : ce run ne teste
ni une nouvelle génération complète JEV/Sol, ni une extraction Rainminer réelle, ni la qualité IA.
Le restaurant hors pilote est vérifié jusqu'à sa réservation legacy, sans collecte fournisseur.
La fenêtre de 150 reste appliquée par les vrais workers ; ce petit scénario ne la sature pas.
Il ne constitue pas une répétition de migration sur une copie complète des données de production.

La branche de validation est prête à être revue. Le socle de reconstruction ne doit jamais être
déployé sur la production. Avant toute activation distinctement autorisée : appliquer seulement
les migrations additives de mutualisation non encore appliquées, déployer les raccordements avec
les commutateurs désactivés et la liste vide, puis autoriser uniquement le Place ID K.HOUSE vérifié.
Le retour arrière exige le drainage des opérations en cours et conserve les données communes.
