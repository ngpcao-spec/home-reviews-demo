# Préparation de production Rainminer — 24 novembre 2026

## État et périmètre

Cette préparation prolonge la PR #123, validée initialement sur `c979d81` par le
run [45321095637](https://github.com/ngpcao-spec/home-reviews-demo/actions/runs/45321095637).
Les résultats du nouveau commit sont consignés dans la PR après les tests.
Aucune migration, fonction ou configuration de production n'a été appliquée
pendant cette préparation. Aucun run Apify et aucun appel IA payant.
Les autres worktrees Codex ne sont pas modifiés. La PR n'est pas fusionnée :
un push sur main déclencherait le client GitHub Pages et n'est pas effectué.

État attendu après le futur déploiement inactif :

| Paramètre serveur privé | Valeur |
| --- | --- |
| `budget_limit_usd` | 5,00 USD, maximum imposé par contrainte |
| `per_run_limit_usd` | 0,50 USD, maximum imposé par contrainte |
| `automatic_enabled` | false |
| `launches_enabled` | false |
| `configured_at` | NULL |
| `billing_ceiling_evidence` | NULL, lancement interdit |
| `first_test_job_id` | NULL, aucun test armé |

Budget cumulatif partagé par toutes les organisations, sans période comptable
ni rechargement. Les réservations et dépenses ne sont pas effacées lors d'un
redémarrage, d'une désactivation ou de la suppression d'un établissement.
Un résultat terminal ne libère la réserve que si son reçu permet de valider le
montant payé, l'identité et le plafond demandé. Sinon 0,50 USD reste engagé.
Les anciennes dépenses terminées antérieures à cette fonctionnalité ne sont
pas reprises ; les anciens runs actifs/incertains sont conservativement réservés.

## Garantie du plafond : blocage identifié

Apify documente un plafond des événements PPE via `maxTotalChargeUsd`, mais
précise que l'accès au dataset après le run entraîne des coûts de plateforme,
quel que soit le modèle. La valeur `usageTotalUsd` décrit le coût du run ; elle
ne prouve pas à elle seule la gratuité des lectures réalisées ensuite.

- [Plafond PPE et frais après run](https://docs.apify.com/actors/running/actors-in-store)
- [Paramètre de lancement](https://docs.apify.com/api/v2/actors-runs-post)
- [Coût communiqué par le run](https://docs.apify.com/api/v2/actor-run-get)

La requête publique de métadonnées du 24 novembre confirme l'identité attendue,
PAY_PER_EVENT et l'absence de minimum annoncé. Elle ne prouve pas un plafond
global couvrant les frais annexes de ce compte. La préparation n'affirme donc
pas cette garantie : les nouveaux lancements restent interdits.

Avant de lever ce verrou, obtenir une garantie applicable au compte/projet,
référencée et datée, que toutes les opérations requises (y compris récupération,
transfert et stockage après run) sont incluses dans le plafond et le reçu du run,
ou ne sont pas facturées. Une simple provision estimée ou des crédits mensuels
ne constitue pas cette garantie. Si cette condition ne peut pas être établie,
**ne pas lancer le test**. Ne pas remplir le champ avec une valeur fictive.
Les tests utilisent une preuve explicitement `SIMULATED_PROVIDER_ONLY` dans une
base éphémère dont tous les appels sont interceptés.

## Revue des changements et non-destruction

1. `20261124030622_automatic_rainminer_menu_queue.sql` : colonnes et tables privées,
   index de file, hooks après import, fonctions et Cron menu uniquement.
   L'ancien index global incluant queued est remplacé par un index d'exécution
   starting/running/unknown ; un autre index protège chaque Place ID.
   Le FK d'établissement devient SET NULL pour conserver runs, brut et budget.
   Aucune suppression d'avis, plats, rapports, preuves ou jobs.
2. `20261124035425_rainminer_menu_five_dollar_release_guard.sql` : budget maximal
   5 USD, verrou tarifaire, restriction d'un premier test à une tâche et validation
   du reçu comptable. La conversion numeric conserve les valeurs existantes.
   Les deux patchs de fonctions exigent chacun une ancre unique ; un décalage de
   schéma fait échouer la migration, sans remplacement approximatif.
3. `rainminer-menu` : même Actor et même input, POST unique après autorisation SQL,
   reçus expurgés des options non nécessaires. Les GET d'un run déjà accepté
   continuent même si les nouveaux lancements sont désactivés.
4. RLS et privilèges : pas d'accès client aux jobs/configurations/liens privés ;
   RPC de lancement réservé au service ; lecture d'un établissement soumise à
   l'organisation. Les menus du catalogue respectent les restrictions partagées
   existantes. La classification, les avis et leurs workers ne changent pas.

## Ordre du futur déploiement inactif

À exécuter uniquement lors d'une intervention de déploiement autorisée.

1. Vérifier le SHA validé de la PR et les différences avec main. Ne pas fusionner
   main avant le serveur : `.github/workflows/deploy-pages.yml` déploie le client
   sur chaque push main. Ne pas inclure d'autres travaux Codex.
2. Exécuter `supabase/maintenance/rainminer-deployment-preflight.sql` en lecture
   seule. Enregistrer les comptes et empreintes, les migrations appliquées, les
   jobs actifs et la présence des noms Vault, sans exposer leurs valeurs.
3. Suspendre uniquement le Cron menu :
   `select cron.alter_job(jobid, active := false) from cron.job where jobname='home-reviews-rainminer-menu';`
   Attendre la fin du worker déjà engagé. Résoudre toute tentative starting ou
   unknown avant de poursuivre ; aucune relance automatique ni faux succès.
4. Faire une sauvegarde PostgreSQL restaurable via le mécanisme habituel, avec
   schéma, données des jobs, raw/result, catalogue de menus et relations privées.
   Une empreinte ou un CSV ne remplace pas cette sauvegarde. Utiliser par exemple
   `pg_dump --format=custom --file=rainminer-before.dump` avec une connexion fournie
   par l'environnement sécurisé, sans copier la chaîne dans le dépôt ou les logs.
   Vérifier `pg_restore --list`, puis une restauration dans une stack isolée
   compatible, Cron arrêté et accès fournisseurs bloqués. Ne jamais restaurer
   cet essai sur production. Conserver les résultats de la vérification.
5. Appliquer **seulement** les deux migrations ci-dessus dans l'ordre. Vérifier
   d'abord leur absence dans `supabase_migrations.schema_migrations` ; enregistrer
   leurs versions par l'outil de migration habituel. Ne pas exécuter tous les
   scripts historiques, de purge, de reconstruction ou de test du dépôt.
6. Déployer seulement `rainminer-menu` et son helper depuis le SHA testé, avec
   l'authentification existante. Conserver les secrets et URL Vault existants.
   Aucun déploiement des workers avis, rapports ou recommandations.
7. Publier ensuite le client via le workflow GitHub Pages habituel. Contrôler
   le SHA du déploiement et le panneau dans les deux langues, sans cliquer sur
   une extraction. Comparer les empreintes de données avec le précontrôle.
8. Vérifier la configuration du tableau ci-dessus, l'absence de nouveaux jobs
   et de réservations, les droits et la santé de HOME Reviews. Garder le Cron
   menu arrêté tant qu'aucun run connu ne nécessite de lecture.

La première migration réenregistre le Cron existant. Les drapeaux sont false,
donc elle n'autorise aucun nouveau POST. Contrôler son état après migration et
le remettre en pause au besoin. Les Crons d'avis ne sont pas modifiés.

## Premier test réel futur, un seul restaurant

Ce test n'est **pas autorisé pendant la présente mission**. Il exige à la fois
l'autorisation explicite de l'utilisateur et la garantie tarifaire ci-dessus.

1. Choisir un seul établissement actif et son Place ID vérifié. Rechercher le
   menu déjà disponible et les jobs queued/starting/running/unknown. Réutiliser
   tout résultat disponible, y compris un menu vide. Ne pas créer un nouveau run
   pour vérifier un résultat déjà réussi. Vérifier le budget restant >=0,50 USD.
2. Dans une session DBA sécurisée, fixer les paramètres de session suivants avec
   les valeurs vérifiées (un UUID de demande neuf, conservé pour les contrôles) :

   ```sql
   select set_config('home.rainminer_first_test_authorized','yes',false);
   select set_config('home.rainminer_test_establishment','<UUID établissement>',false);
   select set_config('home.rainminer_test_user','<UUID administrateur de son organisation>',false);
   select set_config('home.rainminer_test_request','<UUID demande unique>',false);
   select set_config('home.rainminer_billing_evidence','<référence datée de la garantie vérifiée>',false);
   ```

3. Exécuter `supabase/maintenance/rainminer-first-test.sql` dans **cette même
   session**. Le script refuse un menu existant, un autre run actif, un budget
   insuffisant ou un test déjà armé. Il enfile une seule demande manuelle et
   lie `first_test_job_id` à son ID. `automatic_enabled` reste false.
   Le script ne contient aucun appel fournisseur.
4. Réactiver uniquement le Cron menu avec `cron.alter_job(..., active := true)`.
   Le worker vérifie encore prix, identité, budget et restriction avant le POST.
   Aucune autre tâche ne peut démarrer, même si des utilisateurs demandent une
   relance en parallèle. Laisser le worker suivre le run accepté.
5. Observer l'ID et le statut du run, les réservations/coût, le JSON brut,
   provenance et compteurs dans les deux langues autorisées. En cas de réponse
   incertaine, conserver unknown et la réserve ; rechercher le run, sans POST.
6. Refermer `launches_enabled=false` et `automatic_enabled=false`. Conserver
   `first_test_job_id`, les reçus et réservations : réexécuter le script doit
   échouer, pas dépenser une seconde fois. Terminer les GET d'un run connu, puis
   arrêter le Cron menu. Présenter le coût et le résultat avant toute extension.

Le premier test n'active pas l'automatisation générale. Cette activation et la
suppression du verrou de tâche nécessitent une instruction ultérieure.

## Retour arrière

Sous verrou PostgreSQL (le trigger de configuration prend le même verrou que
les workers) :

```sql
update private.rainminer_menu_config
set automatic_enabled=false, launches_enabled=false
where singleton;
```

Conserver le worker corrigé pour terminer les lectures connues, puis arrêter
uniquement son Cron. Ne pas remettre un job en queued ni supprimer une réserve.
Ne pas revenir à l'ancien worker qui ignore les nouveaux contrôles de coût.
Conserver les migrations additives et les données ; le retour arrière normal
est une désactivation. Si la migration échoue, sa transaction est annulée.
En cas d'incident de données démontré, utiliser la sauvegarde vérifiée dans une
intervention distincte, sans écraser les avis collectés depuis sa création.
