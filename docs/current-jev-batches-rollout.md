# JEV par lots pour les nouvelles demandes

## Contrat livré

Le choix serveur `report_pipeline_settings.jev_transport` a été livré initialement à **`individual`**, puis activé à **`batch_initial_v1`** le 24 octobre 2026 à 15:37:26 au Vietnam. L'engine reste `jev_sol_v2`. La migration de réveil initial ne change pas ce réglage et ne crée aucune demande.

La demande capture le transport lors de `enqueue_current_report`. Cette valeur devient immuable dans `report_generation_requests` : bascule et retour arrière ne modifient que les demandes suivantes. Le certificat d'une demande en lots ne peut pas alimenter le dispatcher individuel.

Transport : `batch_initial_v1`. Manifeste : `jev-current-batches-initial-v1`. Requêtes JEV : `jev-multi-review-initial-v1`, modèle `jev-1.13.0`, prompt initial, quatre rubriques et six choix inchangés. Les règles communes sont liées au SHA-256 `3a82a9c032217a0d10ba8a9ceccdafb71bc702366145d5837a324af580c20d22`. Aucun override de prompt, seuil nouveau ou reclassement après réception.

Le sélecteur reste `jls-direct4-negative-mixed-coverage-v1`. Sol reste `jls-direct4-compact-sol-v1`, modèle `gpt-6.1-sol`, effort `low`, sortie maximale 9 500 tokens. Aucun appel Luna ou Apify. Le sélecteur de diversité et les deux prompts candidats ne sont pas raccordés.

## Création et persistance

Le parcours normal fige son snapshot par les mécanismes V2 existants. La préparation de source existante certifie ses textes et ses métadonnées ; elle ne crée pas de tâches individuelles lorsque le transport est en lots. Le nouveau créateur général verrouille la demande et crée une seule génération de lots et un seul rapport courant par source.

Les avis textuels sont ordonnés par UUID pour tous les restaurants. Le planificateur vise 50 avis par requête, puis réduit la taille selon la garde de contexte et le corps sérialisé. Il ne tronque aucun texte. Un avis seul hors garde provoque `BATCH_SINGLE_REVIEW_LOCAL_GUARD`, sans envoi. Le corpus de référence reproduit exactement les 10 requêtes de 50 avis et celle de 27 ; aucun cas spécial par restaurant n'existe dans le code.

Le manifeste conserve le snapshot, l'ordre, le corps exact de chaque requête, ses empreintes, le mapping avis/rubrique et les gardes. SQL vérifie la provenance certifiée, les textes, le modèle, les consignes initiales, les choix, les questions, le sélecteur et le template Sol. Une variante, une réponse étrangère ou une modification de mapping est rejetée.

Chaque tâche réserve atomiquement sa tentative avant HTTP. `request_count` passe de 0 à 1 une seule fois. Une borne commune autorise au plus **un envoi natif par lots en vol** entre restaurants. Les quotas numériques du fournisseur restent inconnus ; cette borne n'est pas un quota vérifié. Les anciennes tâches individuelles déjà engagées gardent leur orchestration.

Le reçu brut, son hash, le modèle servi, l'identifiant de requête éventuel, la durée et l'usage natif sont sauvegardés avant une invocation distincte de validation/projection. Les reçus et projections sont immuables ; une sauvegarde identique est idempotente. Les tokens restent sur le lot parent, jamais répartis artificiellement par avis. Les réponses sont rattachées par leurs clés explicites à un avis et une rubrique.

Les lots terminés sont conservés. Un reçu déjà sauvegardé est validé sans renvoi. Une réservation expirée sans reçu ou un timeout reste `unknown`, tentative consommée. Les lots non commencés peuvent continuer ; Sol reste bloqué si un lot manque ou est invalide. Aucun fallback individuel ni retry automatique. Une réponse tardive peut être conservée pour le même worker si aucun reçu n'existe ; elle n'autorise aucun nouvel envoi.

Les wakes immédiats poursuivent les étapes après chaque sauvegarde. Un cron de récupération réveille les parcours courants interrompus ; il ne remet jamais une tentative à zéro. Les expirations d'autorisation sont visibles et conservent les reçus. Une tentative inconnue d'une génération courante bloque aussi une nouvelle demande qui contournerait cette issue incertaine.

Le réveil couvre aussi la première préparation, avant tout snapshot : l'insertion
d'une nouvelle demande courante en lots programme le worker dans la même transaction,
avec envoi après commit. Le double clic réutilise la source sans nouveau réveil initial.
Un échec de programmation laisse la demande en file pour le cron de secours.
Le [diagnostic de l'attente initiale](current-batch-initial-queue-20261024.md)
sépare les 56 secondes d'alignement cron des coûts de dispatch et de préparation.

## Comptabilisation et publication

Chaque reçu sauvegarde les tokens réellement retournés, y compris si les réponses sont incomplètes. Une donnée absente reste inconnue ; elle n'est pas présentée comme zéro consommé. Les totaux sont recalculés à partir des tâches uniques, sans incrément rejouable. Le bilan distingue `historical_usage` et `new_usage`, tentatives nouvelles/réutilisées, usage incomplet, durée cumulée des appels et durée globale de génération.

Quand tous les lots sont complets, le worker reconstruit les compteurs et leurs listes d'identifiants, applique le sélecteur actuel puis prépare Sol compact. Sol conserve sa réservation séparée à tentative unique. Un résultat Sol inconnu reste consommé et bloque toute réémission.

La construction du dossier et son contrôle de taille sont deux étapes locales distinctes, liées par un draft immuable et ses empreintes. Cela sépare le calcul des preuves de l'initialisation du tokenizer sous la limite CPU Edge. Le draft est sauvegardé avant `measure_sol` ; Sol ne peut être réservé qu'après la sauvegarde de l'enveloppe mesurée. Les prompts, le sélecteur et les références ne changent pas. Après gel du snapshot, un wake privé poursuit immédiatement la préparation courante ; le cron reste une récupération.

Le statut du bouton normal lit le transport capturé de la demande, puis les vraies tâches correspondantes. Il ne calcule plus un ancien plan Sol quand la demande V2 n'a pas encore de lots. La demande courante et le rapport disponible sont exposés séparément ; une archive terminée ne peut pas fournir la progression d'une nouvelle demande. Le [diagnostic Artisan du 24 octobre](artisan-generation-progress-20261024.md) documente la cause, les horaires et les limites des mesures.

Le rapport se publie dans `analysis_parallel_reports` avec `current_source_run_id` et le `comparison_id` de la demande. Le cycle V2 normal publie son état. Les totaux facturés nouveaux (JEV + Sol) alimentent la génération courante ; les usages historiques restent séparés. L'interface affiche la progression lots/avis dans l'onglet courant, les compteurs et les avis négatifs/mixtes complets du snapshot. Leur liste provient des identifiants de classement, indépendamment des 32 preuves retenues.

Les rapports historiques, caches individuels et expériences antérieures ne sont ni réécrits ni supprimés.

## Activation — à exécuter seulement après décision

Dans l'éditeur SQL du projet, avec la session d'administration :

```sql
begin;
set local role service_role;
select public.set_current_jev_transport(
  'batch_initial_v1',
  'Activation explicite : JEV initial par lots, selecteur actuel et Sol compact.'
);
commit;
```

Cette commande commute uniquement les futures demandes. Elle ne déclenche aucun rapport ni import. Contrôle sans fournisseur :

```sql
select engine, jev_transport, updated_at
from public.report_pipeline_settings where id;
```

## Retour arrière — prochaines demandes uniquement

```sql
begin;
set local role service_role;
select public.set_current_jev_transport(
  'individual',
  'Retour arriere : JEV individuel initial, meme selecteur et Sol compact.'
);
commit;
```

Les demandes existantes gardent leur transport et leurs reçus. Laisser terminer celles dont l'état est sûr. Pour arrêter une génération concernée par un incident, désarmer son `analysis_jev_batch_runs` sans modifier les tentatives ou les reçus ; les réponses déjà en vol peuvent encore être sauvegardées. Un état inconnu requiert un examen explicite, jamais une remise à zéro ou un remplacement individuel automatique. Les rapports achevés et archives restent consultables.

## Qualification et limites

Les réponses fournisseur sont simulées : ces tests vérifient le logiciel, pas la justesse linguistique. Ils couvrent le parcours normal multi-avis jusqu'à la publication, les compteurs et listes négatives/mixtes, concurrence/doublons, interruption avant/après reçu, lot incomplet et résultats JEV/Sol inconnus. Les tests SQL transactionnels se terminent par `ROLLBACK` : aucune fixture ni requête pg_net n'est engagée. RLS et refus des variantes sont aussi vérifiés.

Le rejeu hors réseau des onze reçus réels retrouve les 527 avis, 2 108 réponses et le dossier compact de référence à l'identique. D'autres snapshots sauvegardés vérifient le découpage adaptatif et la non-troncature. Aucun nouvel appel fournisseur n'est nécessaire à la qualification ou au déploiement.

JEV reste automatique : il peut manquer une réserve explicite, notamment le prix du repas proche de 800 000 VND. Le sélecteur conserve sa limite de 32 associations et son plafond ordinaire par avis : des critiques correctement classées peuvent être écartées (température, valeur ou rattachement qualité d'un signal digestif). Un symptôme rapporté par un client ne démontre aucune causalité médicale. L'accord avec les classements individuels n'est pas une preuve de justesse. Les gardes de contexte restent des estimations locales conservatrices.
