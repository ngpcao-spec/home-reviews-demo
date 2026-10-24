# JEV par lots — préparation et raccordement expérimental

Mise à jour : le raccordement général des nouvelles demandes est désormais livré derrière l'option serveur désactivée `jev_transport=individual`. La création depuis le snapshot courant, la comptabilisation des reçus nouveaux et la publication courante sont décrites dans [la procédure de mise en service](current-jev-batches-rollout.md). Les sections suivantes conservent l'historique de préparation et d'expérience. Le prompt initial et le sélecteur de production restent retenus ; les essais de diversité sont clos hors du parcours actif.

Décision du 24 octobre 2026 : retenir le prompt initial en véritables requêtes multi-avis. Les deux prompts candidats sont écartés. La première préparation hors réseau est décrite ci-dessous ; le raccordement expérimental et le test Sol distinct figurent à la fin. Le parcours de production reste individuel.

## Livré et vérifié hors réseau

`supabase/functions/_shared/jev-review-batches.ts` est un module pur, sans transport et sans consommateur dans le worker. Il importe exclusivement la configuration courte initiale. Les consignes, questions et six choix natifs sont mutualisés comme dans les requêtes déjà exécutées, avec un rattachement explicite avis × catégorie. Aucune option de remplacement des consignes n'est exposée.

Le planificateur conserve l'ordre et l'intégralité des textes. Il vise 50 avis, puis réduit localement la taille si le contexte ou les octets estimés dépassent la garde. Le nombre de lots dépend du corpus : 101 avis courts donnent 3 lots, 527 avis de référence donnent les 11 lots validés (10 × 50 + 27). Aucun identifiant de restaurant ou d'avis n'est traité spécialement.

La qualification sur les 527 entrées sauvegardées vérifie les 11 corps de requête sérialisés et leurs mappings à l'identique, les 2 108 réponses natives, les probabilités, les confiances et les compteurs reconstruits. Elle n'envoie aucune requête. Les tests unitaires couvrent le découpage, la non-troncature, les clés dupliquées/manquantes/étrangères, le modèle servi, les réponses invalides, le cache et la distinction incertitude/absence. Les simulations vérifient le logiciel, pas la justesse sémantique de JEV.

## Taille et marge

Les limites conservées de la documentation précédemment consultée sont : contexte total 64 000 tokens, état + une question 32 000 tokens, corps 32 MiB. Elles ne sont pas revérifiées en ligne pendant cette étape.

Avec `o200k_base`, uniquement comme proxy local :

- S = tokens du JSON de l'état ; Qi = tokens du JSON d'une question + 32.
- Total estimé = S + somme(Qi) + 512 ; plus grande paire = S + max(Qi) + 512.
- Garde = plafond(estimation × 1,8310213108162445) + 2 048.
- Multiplicateur conservé : max(1,5 ; 1,25 × 1,4648170486529957), dernier terme mesuré sur l'usage des 527 appels individuels sauvegardés.

Les 11 lots passent avec cette garde : total maximal 49 377 ; paire maximale 11 222 ; corps maximal 71 198 octets. Un échec local conduit à réduire un lot avant toute réservation ; il ne prouve pas un dépassement de la limite fournisseur. Si un avis seul échoue, demander un traitement explicite ultérieur, conserver son texte et ne pas le tronquer. Aucun long contexte activé implicitement.

## Raccordement serveur à réaliser ultérieurement

Points d'entrée existants : `parallel-report.ts` prépare actuellement les tâches individuelles, `parallel-report-server.ts` les exécute, et `parallelSolEnvelope` attend les reçus individuels. Ils ne sont pas modifiés ici. Le raccordement devra avoir une nouvelle version de contrat de transport, distincte des historiques individuels et des expériences candidates.

1. Figer le snapshot et l'ordre avant planification, puis enregistrer le manifeste complet (lot, IDs ordonnés, texte/hachage, questions/mapping, modèle, paramètres, garde et version). Les 527 textes de référence et leur ordre reproduisent ainsi exactement les 11 lots ; aucune traduction ou import supplémentaire.
2. Réutiliser exclusivement l'accès serveur existant et l'authentification du scheduler. Ne pas déplacer la clé vers le client. Aucune valeur de secret n'est nécessaire au planificateur.
3. Réserver atomiquement une tentative par lot avant l'envoi ; un lot correspond à un seul appel natif multi-avis. Pas de boucle de retry ni de reprise payante après timeout ambigu. Persister l'état de l'envoi et le reçu brut avant validation, puis récupérer hors réseau les reçus déjà présents. La reprise du traitement ne doit pas renvoyer un lot consommé.
4. La limite numérique des quotas du compte reste inconnue dans les sources sauvegardées. Prévoir initialement une concurrence de 1, paramétrable après vérification serveur ; ce nombre est une précaution, pas un quota vérifié. Supprimer l'attente fixe d'une minute entre lots. Un 429 doit être enregistré, sans retry automatique.
5. Réserver le timeout à un niveau compatible avec le worker, enregistrer durée et usage réels une seule fois sur le reçu du lot. Ne pas répartir artificiellement ses tokens par avis. Conserver le corps brut et son SHA, le modèle servi et les réponses natives.
6. Valider d'abord toutes les clés et les quatre rubriques par avis. Une réponse incomplète, invalide ou étrangère reste un diagnostic durable ; aucun avis inventé ou reclassement après réception. Le parseur conserve la tolérance numérique déjà utilisée, sans normaliser les probabilités ni introduire un seuil de confiance. `uncertain` reste une abstention distincte de `not_mentioned`.
7. Produire une projection vérifiable par avis, rattachée au reçu parent et aux clés de question natives, puis adapter explicitement la compilation du dossier Sol. Ne pas fabriquer de faux reçus individuels ni annoncer que le contrat actuel de `parallelSolEnvelope` accepte déjà ce format. Exiger la complétude avant passage automatique à Sol ; afficher une erreur exploitable sinon.
8. Comptabiliser l'avancement en avis reçus, pas seulement en lots. La nouvelle identité du cache inclut le contrat, le modèle, toutes les données du lot dans l'ordre, le corps sérialisé et le mapping. Un changement d'un texte change l'identité du lot ; aucun cache candidat n'est admissible.

Le sélecteur reste inchangé : 32 associations maximum, paire mixte insécable, au plus deux associations ordinaires par avis avec les exceptions existantes, couverture négative par rubrique. Cette couverture ne garantit pas chaque incident : les plats froids, notamment, peuvent rester absents du dossier malgré un classement correct. Le bilan hors réseau documente ces limites ; aucune exclusion par identifiant ni sélection supplémentaire n'est introduite.

## Historique de la première livraison hors réseau

Préparé : constructeur, découpage adaptatif, garde de contexte, identité du cache, validation et projection natives ; plan de raccordement ci-dessus. Testé réellement : rejeu des 11 reçus déjà consommés et comparaison exacte au dossier Sol individuel sauvegardé. Appels réels nouveaux : zéro. Déployé et activé : rien. Les historiques, expériences désarmées et production restent inchangés. Un futur raccordement, ses migrations et son activation constituent une étape distincte.

## Raccordement expérimental réalisé ensuite

`jev-batch-experiment.ts` et l'Edge Function du même nom raccordent les reçus natifs, le sélecteur existant et Sol compact. Les tables `analysis_jev_batch_runs` et `analysis_jev_batch_tasks` sont isolées, avec lecture par les membres de l'organisation et mutations serveur uniquement. Aucun changement de prompt, de sélecteur, de seuil ou de réponse native.

Le démarrage scellé de ce dernier test importe les onze reçus initiaux depuis leur table privée : les 527 avis ne sont ni importés à nouveau ni reclassés. L'autorisation persistée limite les nouveaux appels JEV à zéro et Sol à une tentative. Le constructeur adaptatif général conserve sa cible de 50 avis ; le démarrage scellé de ce test est volontairement limité au corpus déjà autorisé.

Une réservation atomique consomme chaque nouvelle tentative une seule fois. Les reçus reçus sont validés séparément, sans renvoi fournisseur. Une interruption permet de poursuivre les lots non commencés ; une réservation expirée sans reçu devient `unknown`, sans remise à zéro du compteur. Les autres lots non commencés peuvent continuer, mais Sol reste bloqué si un classement manque. Une seule requête JEV native peut être en vol par expérience ; il s'agit d'une précaution, les quotas numériques du fournisseur restent inconnus.

Le dossier compact conserve le reçu parent de chaque avis et ses quatre clés natives. Il ne fabrique pas de reçus individuels dans l'ancien cache. Il est préparé seulement après vérification de la complétude, de l'unicité entre lots et de l'identité des textes. Le nouvel accès serveur emploie les secrets existants ; aucune clé ne sort du serveur.

Sol utilise le même modèle, les mêmes paramètres, le même prompt compact et le même schéma que la référence. Son reçu brut est sauvegardé avant une validation dans une invocation distincte. Une tentative au résultat inconnu reste consommée. La fin de validation désarme automatiquement l'expérience.

L'archive de rapport porte la version `jev-multi-review-initial-v1`. Elle apparaît dans les versions consultables du même établissement, avec progression en lots et avis, étape Sol, et bouton de continuation sans nouvelle autorisation. Elle est explicitement exclue du choix du rapport courant par défaut. `report_pipeline_settings`, les requêtes de génération courantes et le worker de production ne changent pas.

Vérifications : 2 441 tests unitaires passent, lint et build passent. Le test SQL transactionnel est annulé après vérification du démarrage idempotent, des réservations concurrentes, des reçus immuables, de la reprise, du non-renvoi des résultats inconnus et de la tentative Sol unique. Le rejeu des 11 reçus réels retrouve les 2 108 réponses, aucun manquant et exactement le dossier précédemment audité. Ces contrôles techniques ne mesurent pas la justesse sémantique de JEV.

Test réel distinct terminé : expérience `9f3825c3-a977-4d15-acf2-73298f5a6bab`, rapport archivé `4615cf23-7444-4429-93cc-4b859d3b26b3`, référence conservée `55b107c4-a33a-405b-b323-4d63f4898223`. Un seul appel Sol : 8 426 tokens d'entrée, 2 485 de sortie, 36 798 ms. JEV historique réutilisé : 259 417 tokens d'entrée et 141 251 de sortie ; nouveaux appels et tokens JEV : zéro. Aucun appel Luna ni Apify. L'expérience est désarmée ; les lots ne sont pas le parcours par défaut.

