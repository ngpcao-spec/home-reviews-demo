# Artisan — diagnostic de génération du 24 octobre 2026

Toutes les heures ci-dessous sont au Vietnam (UTC+7).

## Identités et périmètre

Une seule demande V2 est enregistrée pour Artisan Cafe & Eatery, établissement `252a8dca-14c7-4f09-bd1f-7b2c40ae97aa`. Il n'existe aucune deuxième demande autour de 17 h 06. Les quatre générations Sol antérieures datent du 1er et du 3 octobre.

- Demande : `8e16c7ae-6cbe-48fc-9482-ba4638f48826`, créée à 17:00:02,190, transport `batch_initial_v1`.
- Source : `0f33bed0-36c2-46cd-a5f0-49a62d53d303` ; génération `fbbc3712-c6d6-4c2b-823a-54269442ebfd` ; prise en charge à 17:00:02,562 ; terminée à 17:04:54,511.
- Exécution des lots : `1d3b1de8-39a9-4bfa-ae94-05b59cfaa995`, créée à 17:01:18,162, état `completed`, désarmée, une tentative Sol consommée.
- Rapport affiché : `5087ce58-ad32-4401-8feb-3a9ab4d795f4`, créé à 17:01:18,162, publié à 17:04:54,511, état `completed`, même source et même demande.
- Snapshot : 541 avis, 441 textes et 100 avis sans texte. Empreinte du snapshot `293c010076d662bdc885134b277871e237a8082fbef3634fcb73771d41e6b405`. Empreinte des sources `194f1dc3983855a5268b51799801ec40058c59f75112dfd0d8f26d36a28a7113`. Le snapshot diffère des anciens corpus Sol (501, 505 et 508 avis).
- Plan : 8 × 50 + 41, neuf lots natifs complets, 1 764 classements. Chaque lot a une tentative, HTTP 200, aucun résultat inconnu.

## Chronologie mesurée

| Étape | Bornes enregistrées | Durée |
|---|---|---:|
| File initiale | 17:00:02,190 → 17:00:02,562 | 0.372 s |
| Préparation et attente de plan | 17:00:02,562 → 17:01:18,162 | 75.600 s |
| Lancement du premier lot | 17:01:18,162 → 17:01:25,865 | 7.703 s |
| JEV, orchestration incluse | 17:01:25,865 → 17:02:53,903 | 88.038 s |
| Sélection, préparation Sol et reprises locales | 17:02:53,903 → 17:04:14,576 | 80.673 s |
| Réservation Sol → publication | 17:04:14,576 → 17:04:54,511 | 39.935 s |
| **Demande → publication** | 17:00:02,190 → 17:04:54,511 | **292.321 s** |

Les neuf appels HTTP JEV totalisent **3,648 s**. L'appel HTTP Sol dure **35,078 s**, 10 035 tokens d'entrée et 2 304 de sortie. JEV : 217 320 tokens d'entrée et 118 042 de sortie. Ce sont les usages réels historiques de cette demande, pas des mesures issues de la correction.

| Lot | Avis | Réservation | Projection sauvegardée | HTTP JEV mesuré | Réservation → projection |
|---:|---:|---|---|---:|---:|
| 1 | 50 | 17:01:25,865 | 17:01:31,575 | 0.431 s | 5.710 s |
| 2 | 50 | 17:01:38,940 | 17:01:44,086 | 0.419 s | 5.146 s |
| 3 | 50 | 17:01:47,053 | 17:01:50,668 | 0.458 s | 3.615 s |
| 4 | 50 | 17:01:52,978 | 17:01:56,699 | 0.367 s | 3.721 s |
| 5 | 50 | 17:02:07,809 | 17:02:20,501 | 0.368 s | 12.692 s |
| 6 | 50 | 17:02:27,176 | 17:02:31,710 | 0.377 s | 4.534 s |
| 7 | 50 | 17:02:34,413 | 17:02:38,054 | 0.395 s | 3.641 s |
| 8 | 50 | 17:02:42,177 | 17:02:47,057 | 0.452 s | 4.880 s |
| 9 | 41 | 17:02:50,083 | 17:02:53,903 | 0.381 s | 3.820 s |

Le reçu Sol comporte une création fournisseur à 17:04:16 (précision seconde). La publication est enregistrée à 17:04:54,511. La durée HTTP mesurée est distincte des bornes de réservation et de projection : ces dernières incluent validation, sauvegarde et déclenchement des étapes suivantes.

## Causes vérifiées

1. `currentHistoricalStatus` suivait seulement `analysis_jls_restaurant_runs`. Le rapport en lots possède `run_id = null` et un run dans `analysis_jev_batch_runs`. Après création du plan, le lookup individuel échouait et l'endpoint de statut renvoyait 500. Les journaux enregistrent ces erreurs dès 17:01:28,487 et encore après publication, notamment à 17:06. L'observateur client gardait alors son ancien état local en pause, affiché comme analyse en cours.
2. Avant création du plan, le helper passait `total_steps = null` au calcul historique. Celui-ci retombait sur `consultantBatches(snapshot)`, ancien découpage Sol de 20 textes. Le rejeu hors réseau du vrai snapshot confirme **24 étapes**. Le compteur **0/24** était ce plan ancien avec le curseur source resté à zéro. Le compteur **9/9, 441/441** était la vraie projection du plan JEV. Les deux concernaient la même demande.
3. Après gel du snapshot, la préparation libérait son lease sans déclenchement immédiat : elle attendait le cron à la minute suivante. Le premier worker a répondu à 17:00:05,390 ; la certification est datée 17:01:04,144 et le plan de lots 17:01:18,162. La durée exacte du gel et la frontière exacte d'attente ne sont pas persistées séparément ; ne pas présenter toute cette période comme calcul ou comme attente mesurée.
4. Deux logs `CPU Time exceeded` apparaissent à **17:03:00,039** et **17:03:18,377** pendant la préparation Sol. La construction des preuves et l'initialisation du tokenizer partageaient un seul budget Edge. Le cron a repris cette étape locale à 17:04. Aucun lot JEV n'a été réémis. La limite documentée est de 2 s CPU, hors I/O : https://supabase.com/docs/guides/functions/limits.

## Correction

- Le statut normal suit le transport capturé, la source, le run de lots et leurs tâches. Avant planification, il n'invente aucun ancien total. Après publication, il renvoie `completed`, 9/9 et 441/441.
- Le rafraîchissement du rapport Sol historique ne peut plus remettre en chargement une demande déjà confirmée terminée.
- Le rapport disponible et la demande courante ont des identités et états distincts. Quand un ancien rapport reste visible pendant une nouvelle demande, son état reste celui du rapport, tandis que la progression est celle de la nouvelle demande.
- Après le checkpoint gratuit du snapshot, un wake privé poursuit immédiatement la préparation existante. Le cron reste une récupération.
- La préparation Sol sauvegarde un dossier immuable, puis vérifie sa taille dans une invocation séparée avant toute réservation Sol. Les réservations natives, le prompt JEV, le sélecteur, le dossier et le prompt Sol restent identiques. Les contrôles complets des reçus et projections sont conservés.
- Les tests SQL se terminent par ROLLBACK : aucun message pg_net de fixture n'est engagé.

## Limites de mesure et conservation

L'instant d'affichage précis sur le téléphone n'est pas télémétré. L'écran signalé vers 17 h 06 accuse déjà environ 65 s après la publication, avec l'endpoint de statut toujours en erreur. On ne peut pas dater exactement le premier affichage ni son rafraîchissement. Aucun appel fournisseur supplémentaire ni nouvelle demande n'est nécessaire pour ce diagnostic. Les sondes serveur rejouent seulement des données sauvegardées et sont explicitement en lecture seule ; elles ne mesurent pas le délai d'une future génération.

