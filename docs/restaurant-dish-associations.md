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

La validation finale est exécutée sur une stack Supabase éphémère dans GitHub Actions, avec reconstruction du schéma applicatif, deux vrais utilisateurs GoTrue, deux organisations et deux sessions de navigateur indépendantes. Le client de l'application, PostgREST, les RPC et le contrôle des rôles sont réellement exécutés. Les fournisseurs sont isolés et n'ont reçu aucun appel.

Commit applicatif testé : `8dd5fd4986a2ed10e06c8a501502a692c3cd87c7`. [Run réussi 45378632840](https://github.com/ngpcao-spec/home-reviews-demo/actions/runs/45378632840), le 24 novembre 2026. Les captures originales, le reçu et les résultats détaillés sont conservés dans [auth-mobile](validation/dishes-20261124/auth-mobile/README.md). Le serveur local avec Auth simulé décrit plus bas reste uniquement un outil de développement ; il n'est plus la preuve de validation finale.

Contrôles ciblés : fixture réelle, contexte/variantes, boissons, recherches précises/générales, plusieurs plats/sans spécialité, corrections manuelles après réimport, idempotence, réutilisation d'un menu existant, isolement des comptes, lecture seule pour viewer, refus des appels directs anonymes et des révisions périmées/nulles, initialisation et retour arrière sans perte.

Résultats de la validation finale :

- Un parcours navigateur de 18,7 secondes couvre six groupes d'assertions : deux sessions/lecture isolée/partage FR-VI ; confirmations manuelles ; retraitement après correction ; refus viewer/anonyme/appels directs/tables privées ; recherche générale/précise ; zéro appel fournisseur. Les actions de confirmation et de retrait utilisent les boutons réels.
- Neuf captures Playwright Chromium, viewport mobile 390 × 844, FR/VI, inspectées visuellement ; largeur du document égale à 390 pixels dans tous les cas.
- Le compte FR confirme TRỨNG GÀ et le compte VI confirme TRỨNG CÚT. Deux retraits explicites de variantes restent appliqués après retraitement du JSON sauvegardé. Le JSON brut et le résultat d'origine restent exactement identiques. Les deux comptes retrouvent les mêmes corrections.
- Un compte passé en rôle viewer garde la lecture et perd la modification, y compris par RPC directe. Les accès aux établissements de l'autre organisation, les appels anonymes et la lecture directe des nouvelles tables privées sont refusés.
- `pho` retrouve les trois restaurants de test (Phở seul, Phở gà, Phở bò) ; `phở gà` ne retrouve que celui associé à Phở gà ; `pho mai` ne correspond à aucun. Les propositions gardent leur statut et une mention explicite d'incertitude sur la disponibilité.
- Le badge « Spécialité » utilise le nom de la spécialité enregistrée, et non celui d'une variante ayant permis la recherche. Un défaut découvert pendant l'examen des premières captures a été reproduit par une assertion en échec, corrigé dans la migration non déployée, puis vérifié dans le run final.
- **83/83 tests ciblés réussis** dans cinq fichiers : SQL métier, composants FR/VI, recherche, automatisation Rainminer et fiches de recommandations. Lint global, compilation TypeScript et build de production réussis.
- Aucun déploiement, aucune écriture de production, aucune collecte ni analyse payante. La stack isolée a été supprimée après le test.

Historique des contrôles précédents du même chantier (distinct du run final) :

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

Les anciennes traces DOM restent dans `docs/validation/dishes-20261124` pour traçabilité. Le blocage de capture de fenêtre Chrome a été contourné par les captures de page Playwright du run final ; les neuf PNG ne proviennent pas d'une maquette ni d'une session Auth simulée.

Limites : viewport mobile Chromium, pas de Safari sur iPhone physique ; connexion par mot de passe Supabase Auth, pas de nouveau contrôle Google OAuth. La fixture Bánh Căn provient du menu sauvegardé, tandis que les restaurants Phở, les comptes et leurs organisations sont des données de test. L'activation du partage pour Bánh Căn est limitée à la base éphémère et n'élargit pas le pilote de production. Le menu ne garantit pas la disponibilité actuelle des plats. Aucun contrôle de production n'est revendiqué pour cette fonctionnalité non déployée.

## Déploiement ultérieur et retour arrière

1. Sauvegarder les données concernées, contrôler les rôles et les dépendances de la migration sur un environnement Supabase de validation.
2. Appliquer uniquement la nouvelle migration additive. Elle lit les menus déjà stockés et remplit les nouvelles tables ; aucune collecte ni analyse.
3. Publier le frontend de cette branche après validation. Aucune Edge Function, configuration Apify, Cron, synchronisation ou rapport n'est à déployer/modifier pour cette fonctionnalité.
4. Contrôler Bánh Căn Tháng Năm, les accès FR/VI et une correction autorisée.

Retour arrière préparé : revenir au frontend précédent, puis exécuter `scripts/rollback-restaurant-dishes.sql`. Ce script désactive seulement les trois nouveaux triggers et retire l'accès aux quatre nouvelles RPC. Il conserve toutes les données, y compris les corrections et les sources. Il est testé dans la base isolée. Pour réactiver, rétablir ces seuls triggers et permissions après vérification ; ne pas rejouer aveuglément la migration.
