# Conservation des avis et raccordement des statistiques

Correctif préparé le 19 novembre 2026 sur `codex/restaurant-statistics`, à partir du commit `0ec179a` de l'écran Statistiques. **Non déployé.** Aucun appel Apify/IA, aucune écriture en production, aucune récupération d'anciennes archives. Les données utilisées pour les tests sont synthétiques.

## Résultat et périmètre

L'historique est initialisé avec les lignes présentes dans les tables actives locales et communes **au moment de l'application de la migration**. Ensuite, les avis reçus et validés par les parcours actuels d'import/synchronisation sont conservés dans un corpus privé séparé. Leur retrait de la fenêtre active ne retire plus leur note, date, texte original, traduction compatible et informations publiques nécessaires à leur consultation statistique.

`public.reviews`, la rétention active, `retained_review_ids`, les repères VI/FR, les fréquences, les seuils et les règles de génération/réessai des rapports restent inchangés. Le rapport IA conserve donc sa sélection de **150 derniers avis distincts**. Les preuves des rapports existants ne sont ni réécrites ni utilisées pour reconstituer des avis.

L'initialisation ne fait qu'insérer dans les trois nouvelles tables privées. Elle ne réinsère pas les avis dans les tables métier, ne crée pas de tâche et ne lance ni notification, traduction, rapport, ni collecte.

## Stockage et lecture

| Objet | Contenu et garantie |
| --- | --- |
| `private.review_history_scopes` | Début réel de conservation par établissement local ou restaurant partagé, indépendamment de la date de l'avis le plus ancien. |
| `private.review_history` | Une ligne par portée + identifiant source. Date initiale connue conservée ; texte/note de l'observation la plus récente. Une modification ne crée pas un nouvel avis statistique. L'UUID local d'origine est conservé sans clé étrangère vers une ligne active qui pourra être retirée. |
| `private.review_history_translations` | Versions reçues d'Apify, indexées par langue et empreinte exacte de l'original. Une ancienne traduction reste enregistrée mais n'est affichée que si son empreinte correspond. Aucune traduction interne. |
| `private.statistics_rows` | Source unique des agrégats et de leur liste détaillée ; dédoublonnage par identifiant source des copies locales/communes. Les traductions et les organisations ne multiplient pas les avis. |

Le catalogue commun n'est consultable que via le contrôle existant du pilote et de l'abonnement. Hors pilote, seul l'historique local autorisé est lu. Le désabonnement ne supprime pas le corpus partagé et ne donne pas accès à la portée privée d'un autre compte. L'historique contient uniquement la liste blanche des champs publics existante : aucune note privée, aucun brouillon, aucun état lu/traité.

Les tables sont dans le schéma privé, avec RLS activée et sans accès direct `anon`, `authenticated` ou `service_role`. Les fonctions d'écriture sont internes ; les auxiliaires de lot réservés au worker sont accordés uniquement au rôle serveur. Les RPC de lecture existantes vérifient la session, l'appartenance à l'organisation, l'établissement actif, sa langue et l'accès au pilote. Aucun nouvel endpoint fournisseur.

## Raccordement aux traitements existants

- Déclencheurs `history_capture` sur les écritures d'avis/traductions locaux et partagés. Ils s'exécutent avant le déclencheur de rétention active ; aucune capture sur suppression.
- Capture du lot validé dans `ingest_recent_reviews`, avant l'application de la rétention : un avis reçu mais trop ancien pour être admis dans les 150 reste conservé.
- Capture dans `commit_incremental_review_sync_before_sharing`, **après ses contrôles de bail, reçu, identité et continuité**, avant le filtrage des identifiants connus. Le wrapper mutualisé reste inchangé.
- Le worker fournit aussi les lignes déjà reçues dans le chevauchement de collecte, via `history_bundle`. Il n'ajoute aucune requête fournisseur. Le lot est borné à 150, contrôlé contre les identifiants du résultat validé ; le compteur de nouveautés et le calcul du repère continuent d'utiliser le parcours existant.
- L'ancien worker reste accepté pendant le déploiement : absence du nouveau champ = capture du lot existant. Le nouveau champ est ignoré par l'ancienne fonction en cas de retour arrière.
- Les écritures partagées sont sérialisées par un verrou transactionnel d'historique indépendant ; la clé unique protège aussi les rejeux. Aucun nouveau verrou métier restaurant/corpus n'est pris par ce mécanisme.

Les deux corps SQL sont modifiés par ajout ciblé de l'appel de capture, avec vérification de l'ancre. Si la version installée ne possède pas l'ancre attendue, la migration échoue entièrement ; elle ne remplace pas arbitrairement une nouvelle version métier.

## Couverture affichée

L'aide FR/VI affiche « Conservation de l'historique depuis » et les dates des avis disponibles séparément. Des avis initialisés plus anciens que cette date ne prouvent pas que les périodes antérieures sont complètes. Le total annoncé par Google n'est pas une preuve non plus.

Les comparaisons restent masquées et leurs variations sont nulles dans la réponse tant qu'une couverture continue n'est pas certifiée. Ce correctif **n'ajoute pas de certification automatique des périodes** : l'écoulement du temps depuis l'activation ne suffit pas à faire apparaître des variations. Les agrégats, graphiques, sujets déjà analysés et listes restent disponibles sur l'historique réellement conservé.

La date de l'avis, et non celle de sa collecte, détermine sa période. Les dates absentes/futures sont conservées mais exclues des indicateurs et signalées dans l'aide. La politique de fuseau existante (`Asia/Ho_Chi_Minh`) est conservée. Aucune récupération des avis disparus avant l'activation n'est prévue.

## Vérifications effectivement exécutées

| Parcours isolé | Résultat observé |
| --- | --- |
| Initialisation de 150 avis présents | 150 avis dans l'historique ; date de conservation distincte des dates anciennes ; aucune notification, tâche d'import/synchronisation ou publication créée. Aucun champ privé copié. |
| Import réel de 8 nouveaux avis, rétention réelle | 150 avis actifs et sélectionnables pour le rapport ; **158** dans les statistiques et leur liste. L'ancien avis retiré de `public.reviews` conserve son UUID, son détail et sa traduction. Même total pour le second abonné. |
| Avis reçu trop ancien pour les 150 | 0 insertion active, 150 actifs inchangés ; 151 avis dans l'historique consultable. |
| Préparation + commit incrémental réels | Un nouvel avis, un avis connu modifié et un avis du chevauchement plus ancien : **1** nouveauté métier, **150** actifs, **152** historiques, repère placé uniquement sur le nouvel avis. Rejeu du commit terminé sans seconde écriture. |
| VI puis FR, FR puis VI, rejeu et modification | Un seul avis logique ; traductions distinctes. Une modification réelle conserve la date initiale et ne gonfle pas le total. Traductions anciennes incompatibles conservées mais non affichées. Une observation ancienne tardive n'écrase pas la nouvelle. |
| Deux connexions PostgreSQL simultanées | Deux vrais `ingest_recent_reviews`, deux organisations/langues ; attente sur verrou observée, puis **1** ligne commune et **2** traductions, **151** avis vus par chaque compte. Aucun fournisseur impliqué. |
| Droits et abonnement | Refus du compte étranger, de l'établissement inactif, des lectures directes et de l'appel direct au collecteur. Désactivation du pilote et désabonnement retirent uniquement l'accès commun concerné. RLS et privilèges des 3 tables / 4 fonctions contrôlés dans PostgreSQL natif. |
| Agrégats et pagination | **1 205** avis, moyenne 3,0, 723 avis de 1 à 3 étoiles, 241 par note. Toutes les pages SQL parcourues. Pas de limite implicite à 150 ou 1 000. Distribution et total des détails concordent. |
| Navigateur FR/VI | Interface React réelle et RPC SQL dans PGlite local ; iPhone 390 px, iPad 820 px. Jeu avec 1 205 historiques mais seulement 150 actifs ; 180 détails parcourus, traductions/original/note sans texte, filtres et sujets vérifiés. |
| Rapport | Les dix états FR/VI (absent, à jour, nouveaux avis, en cours, échec) passent ; navigation et dernier rapport valide préservés. Règles de réessai et de réponse fournisseur perdue couvertes par les tests ciblés existants. |
| Retour arrière | Arrêt des captures et restauration de l'ancien lecteur, **sans effacement des 151 historiques enregistrés** ; l'import continue, le rapport conserve 150 avis. |

Résultats : **66 tests ciblés Vitest réussis**, **1 test supplémentaire sur PostgreSQL natif réussi**, **19 scénarios navigateur réussis**. Le scénario d'aide/couverture a également été rejoué après ajustement de sa capture. ESLint des fichiers concernés et compilation de production réussis. `supabase db advisors` sur la base native de test : aucune alerte retournée au niveau warning/error.

Les tests de migration utilisent les fonctions métier réelles de rétention/ingestion et de validation incrémentale, avec un schéma de test réduit et les deux nouvelles migrations intégrales. Ils ne reconstruisent pas toute la production et ne démarrent pas le worker Edge HTTP complet. Le navigateur utilise des claims Auth de test, pas deux connexions GoTrue réelles. Chromium mobile ne remplace pas Safari sur iPhone physique. Ces limites ne sont pas présentées comme des contrôles production.

Mesure locale indicative sur 1 205 avis : agrégats 417/414/424 ms, première page 482 ms dans PGlite. Aucun engagement de latence réseau/production. Le volume disque croîtra avec les avis et les versions de traductions ; aucune nouvelle dépense fournisseur, aucun devis d'augmentation du stockage effectué.

Preuves enregistrées : [concurrence native](evidence/review-history-20261119/native-concurrency.json), [mesures](evidence/review-history-20261119/statistics-performance.json), [advisors](evidence/review-history-20261119/advisors.json). Les captures représentent des **données de test**, pas les chiffres réels de K.HOUSE : [FR iPhone](evidence/restaurant-statistics-20261119/statistics-fr-iphone.png), [VI iPhone](evidence/restaurant-statistics-20261119/statistics-vi-iphone.png), [couverture et date de conservation](evidence/restaurant-statistics-20261119/statistics-fr-comparison-iphone.png), [détails historiques](evidence/restaurant-statistics-20261119/statistics-reviews-fr-iphone.png).

Commandes ciblées :

```sh
npx vitest run tests/unit/review-history.test.ts tests/unit/restaurant-statistics.test.ts tests/unit/statistics-buckets.test.ts tests/unit/incremental-review-sync.test.ts tests/unit/review-sync-lost-response.test.ts tests/unit/manual-review-reload.test.ts tests/unit/report-abandonment.test.ts tests/unit/current-report-publication-read.test.ts --maxWorkers=1
npx playwright test --config playwright.statistics.config.ts
npm run build
```

Le test natif est optionnel dans la commande standard. Pour le rejouer, `HISTORY_NATIVE_PACKAGE` désigne un répertoire local contenant `embedded-postgres` et son binaire natif (version utilisée : `18.6.0-beta.19`) ; exécuter `tests/unit/review-history-native.test.ts`. `HISTORY_RUN_ADVISORS=1` ajoute le contrôle CLI. Le test choisit un port loopback libre et un mot de passe aléatoire, n'accepte aucune URL de base distante et n'affiche aucun mot de passe. La désactivation TLS ne concerne que ce serveur éphémère loopback. Les résultats sont dans `test-results/`.

## Déploiement proposé — non exécuté

1. Sauvegarder les tables actives avis/traductions locales et communes, leurs identifiants, les corps des fonctions touchées et l'état des migrations. Vérifier la place disque ; privilégier un créneau sans ingestion. Aucun réimport ni collecte de vérification.
2. Si absente, appliquer **uniquement** `20261119105944_restaurant_statistics_readonly.sql` (RPC déjà préparées).
3. Appliquer `20261119120255_retained_review_history.sql` (tables, captures et initialisation courante). Transaction atomique ; attente de verrou limitée à 5 s et durée de requête à 120 s. En cas d'attente excessive ou d'ancre absente, arrêter et examiner, sans modification partielle.
4. Appliquer `20261119120531_statistics_retained_history.sql` (lecture des agrégats/détails sur l'historique, date de conservation et couverture prudente).
5. Déployer `process-review-sync-jobs` avec son module `_shared/incremental-review-sync.ts`, puis le client. Aucune autre fonction métier n'a besoin d'être remplacée.
6. En lecture seule, vérifier les comptes distincts par identifiant source, la concordance statistiques/détails, les droits, la date d'initialisation et la sélection du rapport limitée à 150. Observer ensuite une synchronisation normale ; ne pas la provoquer pour ce contrôle.

Ne pas appliquer les anciennes migrations de purge/test. Ne pas utiliser un `db push` aveugle sur tout l'historique du dépôt. Ne pas étendre le pilote de mutualisation. Les migrations n'altèrent ni les curseurs ni la programmation des restaurants.

## Retour arrière

En cas de problème d'interface seul, revenir au client précédent ; la conservation peut continuer.

Pour arrêter la nouvelle conservation : revenir au worker précédent si nécessaire, puis appliquer [scripts/rollback/review-history.sql](../scripts/rollback/review-history.sql). Ce script transactionnel retire les captures et les deux appels ajoutés aux fonctions existantes, puis restaure les lecteurs statistiques antérieurs. **Il conserve les trois tables et toutes leurs lignes.** Aucune purge, reprise fournisseur ou régénération.

Les avis peuvent à nouveau sortir de l'ancien lecteur statistique après ce retour arrière, mais restent sauvegardés dans l'historique. Une réactivation se fera par une migration de reprise conservant les tables et leur date, avec la période d'interruption considérée comme non certifiée ; ne pas rejouer aveuglément la migration de création. La date de début seule ne prouve jamais une continuité après une interruption.
