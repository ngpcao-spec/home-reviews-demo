# Spécialités et recherche par plat — préparation du 24 novembre 2026

Branche : `codex/restaurant-dish-associations`, depuis `82db1a114ebcc5b4f76b72029e54b0af01b0c8c5`.
Cette évolution n'est pas déployée. Aucun appel Apify ou IA n'est nécessaire à la migration ou aux tests.

## Sources examinées

- Menus Rainminer : `rainminer_menu_jobs.raw/result`, demandes de réutilisation et `private.shared_restaurant_menu_versions`.
- Classification actuelle : `_shared/rainminer-menu.mjs`, conservée sans modification. Les exclusions déjà enregistrées sont réutilisées.
- Identité partagée : `shared_restaurant_for_establishment`, avec la liste pilote et les abonnements existants. Aucun rapprochement sur le nom.
- Accès : appartenance à l'organisation de l'établissement ; modifications réservées aux rôles owner/admin/manager.
- Référentiel des familles déjà validé : distinct de ce catalogue de plats. Aucune famille n'est créée ou attribuée ici.
- Lecture seule du menu de Tiệm Bánh Căn Tháng Năm, Place ID `ChIJU5uiuU5dcDERmQdmaA0SUXk`, run sauvegardé `H8pfAHVslAWq1uno1`. Fixture intégrale : `tests/fixtures/banh-can-menu-saved.json`.

## Architecture mise en place

Migration additive `20261124094341_restaurant_dish_associations.sql` :

- `private.dish_names` : identités indépendantes de la langue, clés sans accents, alias et relation variante → plat.
- `private.restaurant_dish_profiles` : spécialité unique facultative, statut/origine, justificatifs et révision pour le contrôle des modifications concurrentes.
- `private.restaurant_dishes` : associations proposées/confirmées, automatiques/manuelles, avec sources ; une suppression manuelle laisse une exclusion durable.
- `private.dish_menu_evidence` : copie immuable de chaque ligne source, décision et motif, y compris les lignes exclues ou non interprétées.
- `private.dish_edit_history` : auteur, date, état avant/après des corrections.

Tables privées avec RLS, aucun accès direct depuis le navigateur. Quatre RPC authentifiées vérifient les droits côté serveur : lecture, catalogue, correction et recherche. La recherche n'élargit pas l'accès aux établissements. Les droits de modification sont vérifiés à chaque appel ; une révision périmée ou absente est refusée.

Une projection déterministe se fait depuis les menus sauvegardés à la migration, puis lors de l'enregistrement d'un menu terminé, d'une demande de réutilisation ou d'un rattachement partagé. Elle ne déclenche aucun fournisseur. Un même run est idempotent. Les sources brutes, prix, variantes et classifications du menu d'origine restent intacts. Les réponses manuelles et les exclusions ne sont pas écrasées par le prochain menu.

Un restaurant hors du pilote partagé garde sa portée établissement. Un restaurant déjà mutualisé utilise une portée commune, sans différence FR/VI. Cette migration n'active ni n'élargit le pilote.

## Interprétation et exemples

La spécialité automatique exige la concordance du nom du restaurant avec un plat attesté par le menu courant. Une association ajoutée manuellement sans preuve dans ce menu ne suffit pas à créer automatiquement une spécialité. Aucun avis client n'est utilisé.

| Source | Association proposée | Justificatif |
|---|---|---|
| Tiệm Bánh Căn Tháng Năm / titre BÁNH CĂN | Spécialité Bánh căn | Nom du restaurant et rubrique concordants |
| TRỨNG GÀ / THỰC ĐƠN BÁNH CẦN | Bánh căn · TRỨNG GÀ | Variante contextuelle ; pas un plat autonome « œufs » |
| TRỨNG CÚT / même rubrique | Bánh căn · TRỨNG CÚT | Même contexte |
| THẬP CẨM / THỰC ĐƠN BÁNH CĂN THÁNG NĂM | Bánh căn · THẬP CẨM | Variante assortiment, seulement dans ce contexte |
| XÍU MẠI / MÓN ĂN KÈM SIDE DISHES | Xíu mại | Nom explicite ; la source indique un accompagnement |
| TRÀ ĐÁ, NƯỚC SUỐI, NƯỚC NGỌT, DỪA XIEM | Aucune association | Boissons |
| KHĂN LẠNH | Aucune association | Serviette, non alimentaire |

Résultat réel rejoué : **16 lignes sources, 11 associations proposées (10 variantes de Bánh căn et Xíu mại), 4 boissons et 1 article non alimentaire exclus**. Aucune confirmation n'a été enregistrée en production.

Les tests complémentaires utilisent des données explicitement simulées : Phở, Phở bò, Phở gà, pizza au steak et restaurant sans spécialité. Le contexte Pizza prime sur le mot steak. Les ingrédients dans les descriptions ne déterminent pas une exclusion.

La recherche utilise une identité exacte normalisée et ses descendants : `pho` trouve Phở et ses variantes ; `pho ga` trouve seulement Phở gà. `ph`, `telephone` et `pho mai` ne correspondent pas à Phở. Les spécialistes sont prioritaires, puis les associations confirmées. Les propositions automatiques ne sont recherchables que si une ligne de menu apporte une preuve explicite ou contextuelle.

## Interface et périmètre

La fiche affiche la spécialité sous le nom, avec son statut, puis un accès discret aux plats/variantes, sources et corrections. Les contrôles sont en FR/VI ; le nom canonique du plat ne change pas avec la langue du compte.

La recherche par plat est dans la liste des établissements, accessible également depuis le parcours privé de recommandations. Les filtres et le moteur de recommandations existants sont conservés, sans changement de score, de cache, de génération ou d'appel IA. La recherche par plat ne constitue pas un nouveau critère transmis au modèle de recommandations.

Le dictionnaire initial est volontairement conservateur. Les noms non reconnus restent visibles « À examiner » ; un utilisateur autorisé peut choisir un plat existant ou ajouter un nom précis. Le système ne prétend pas interpréter exhaustivement tous les menus ni garantir leur disponibilité actuelle.

## Validation

Les tests SQL exécutent la vraie migration dans PGlite, avec les fonctions de partage/menu existantes du banc de test. Les rôles PostgreSQL authentifiés et les deux organisations sont réellement exercés. La session Auth du navigateur est simulée dans le serveur local : ce n'est pas un test de connexion Supabase en production.

Contrôles ciblés : fixture réelle, contexte/variantes, boissons, recherches précises/générales, plusieurs plats/sans spécialité, corrections manuelles après réimport, idempotence, réutilisation d'un menu existant, isolement des comptes, lecture seule pour viewer, refus des appels directs anonymes et des révisions périmées/nulles, initialisation et retour arrière sans perte.

Résultats du 24 novembre :

- 25 tests spécifiques réussis : 16 SQL, 6 composants FR/VI et 3 recherches/changements de compte/réessai explicite.
- Suite générale : 3 607 réussis, 4 dépassements du délai de 5 secondes dans deux fichiers existants, 1 test déjà ignoré. La suite a duré 797 secondes sur ce poste.
- Rejeu ciblé des deux fichiers concernés et des trois fichiers de la fonctionnalité : **83/83 réussis**, un seul worker, délais de test et d'initialisation de 30 secondes, 27,71 secondes au total. Aucune assertion n'a été retirée et la configuration globale des délais n'a pas été modifiée.
- `npm run lint` réussi ; lint des fichiers finaux réussi ; compilation TypeScript et bundle de production réussis.
- `git diff --check` sans erreur. Aucun déploiement, aucune écriture de production, aucun appel fournisseur payant.

Les écritures dans le dictionnaire sont sérialisées par un verrou transactionnel dédié avant le verrou du profil. Cela évite que deux imports rencontrant les nouveaux noms dans un ordre inverse se bloquent mutuellement. La révision du profil protège les modifications concurrentes ; aucun écrasement ni nouvelle soumission automatique après conflit.

Le banc navigateur utilise les vrais composants `EstablishmentDetailPage`, `EstablishmentsPage` et `AppShell`, les vraies RPC SQL via une base locale, et des fournisseurs désactivés. Commande :

```sh
npx vite --config tests/e2e/vite.dishes.config.ts --host 127.0.0.1 --port 4191
```

Pages : `/tests/e2e/fixtures/dishes-mobile.html?language=fr`, `?language=vi&user=b`, `?language=fr&search=pho`.

Les traces des contrôles navigateur sont dans `docs/validation/dishes-20261124`. Le compte B VI retrouve la confirmation faite par A FR et seulement son établissement. Les captures JPEG n'ont pas pu être produites : Chrome renvoie un délai dépassé sur `Page.captureScreenshot` et la fenêtre native ne peut pas être activée. Les traces DOM ne sont pas présentées comme des captures visuelles ; la validation visuelle finale reste à terminer.

## Déploiement ultérieur et retour arrière

1. Sauvegarder les données concernées, contrôler les rôles et les dépendances de la migration sur un environnement Supabase de validation.
2. Appliquer uniquement la nouvelle migration additive. Elle lit les menus déjà stockés et remplit les nouvelles tables ; aucune collecte ni analyse.
3. Publier le frontend de cette branche après validation. Aucune Edge Function, configuration Apify, Cron, synchronisation ou rapport n'est à déployer/modifier pour cette fonctionnalité.
4. Contrôler Bánh Căn Tháng Năm, les accès FR/VI et une correction autorisée.

Retour arrière préparé : revenir au frontend précédent, puis exécuter `scripts/rollback-restaurant-dishes.sql`. Ce script désactive seulement les trois nouveaux triggers et retire l'accès aux quatre nouvelles RPC. Il conserve toutes les données, y compris les corrections et les sources. Il est testé dans la base isolée. Pour réactiver, rétablir ces seuls triggers et permissions après vérification ; ne pas rejouer aveuglément la migration.
