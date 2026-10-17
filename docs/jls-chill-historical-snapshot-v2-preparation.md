# Chill Thái — préparation sur le snapshot historique exact

Version opt-in : `jls-historical-snapshot-v2-vi-v1`.
Format de rédaction : `jls-prioritized-recommendations-v2` ; consignes éditoriales et action température existantes réutilisées.

Source : rapport `39556285-21ee-4962-9892-da3b4f0e8ca3`, analyse 7, vietnamien.
Empreinte historique vérifiée : `5642ee929cce9504e5c21292b5b8b5fbb6f762181c57f918c999760948ba767f`.

## Périmètre

100 identifiants figés, 80 commentaires anglais, 20 avis sans texte. Statistiques générales : dénominateur 100. Fréquences des thèmes : dénominateur 80 si tous les textes sont analysés. Le total Google annoncé dans ce snapshot est 2 745 ; le rapport ne couvre pas ce total.

Les chaînes originales, traductions, données structurées et ancien rapport sont archivés séparément, sans actualiser les traductions. Les identifiants individuels des traductions fournisseur n'étaient pas conservés dans le snapshot historique : cette limite de provenance est indiquée, sans inventer d'identifiant.

Aucun classement historique n'est utilisé comme résultat JEV. Préparation initiale : aucun cache JEV strictement compatible pour Chill ; 80 analyses manquantes. Configuration intégrale `v12_economy_1pass_v1`, 25 thèmes, un passage, modèle demandé `jev-latest`, modèle effectivement servi attendu `jev-1.13.0`. Un changement du modèle servi bloque la compatibilité.

## Réutilisation et CPU

Même file durable, réservation transactionnelle, cache permanent, authentification administrative déléguée, parseur Luna, contrôle de confiance et worker Sol existants. Les anciennes branches restent inchangées par défaut.

Étapes : `jev` → `prepare_evidence` → `luna` → `prepare_sol` → `sol` → `validate_sol`.

Les deux étapes `prepare_*` sont des pauses durables et gratuites. Lors d'un futur GO, Codex exporte l'état autorisé, exécute `scripts/compile-jls-snapshot-v2-stage.ts` sans permission réseau puis lie l'artefact avec `bind_jls_snapshot_preparation`. Aucun dossier n'est reconstruit ou tokenisé dans la réservation Edge. Si Codex s'interrompt, la pause persiste ; le navigateur n'a pas à rester ouvert. Une expiration de consentement bloque sans nouvelle dépense.

La requête finale n'existe qu'après les vraies décisions Luna. Le test technique utilise les textes réels et des classifications/retours entièrement fictifs, explicitement identifiés comme mocks ; aucune référence IA ni prédiction réelle n'en est déduite.

## Plafonds et contrôle préalable

- JEV : 80 appels au maximum, un par commentaire, cache vérifié à nouveau avant réservation.
- Luna : 32 requêtes au maximum, questions regroupées par avis ; nombre exact fixé après sélection réelle, au plus 32 preuves.
- Sol : un appel au maximum, seulement si le dossier accepté passe le contrôle de suffisance.
- Apify : zéro ; aucune relance facturable automatique, aucun SDK avec retry.

Entrée Sol : 32 768 tokens estimés avec marge de 12 % + 256 ; sortie réservée : 9 500. Les instructions, dossier et schéma sont inclus. Le contrôle est refait sur la requête finale. Aucune estimation monétaire pour cette préparation.

Les simulations utilisent uniquement des transports injectés. Les probes Edge authentifiées quittent le handler avant tout chargement de secret fournisseur ; elles ne créent ni consentement, ni run, ni tâche payante. Les mesures natives des cinq phases et la qualification sont archivées dans `analysis_jls_snapshot_preparations`. La préparation locale seule n'autorise pas l'exécution.

## Historique, accès et audit ultérieur

Les artefacts libres sont immuables et idempotents. Lectures owner/admin/manager limitées à l'organisation ; écritures serveur uniquement. Une qualification native complète est requise avant tout nouveau consentement futur.

Accès : Plus / Thêm → Test Jev → Rapport hybride JEV + Luna + Sol → Chill Thái. Le résultat futur réutilise le lecteur V2, avec preuves et recommandations masquées conservées. Export authentifié `jls-restaurant?establishment_id=…&view=audit` : source historique complète, protocole, tâches et artefacts du nouveau run. Les mocks restent exclus de cet export.

L'export sert à l'audit comparatif dans le chat d'analyse ; aucun audit qualitatif n'est réalisé pendant la préparation. Il permet de distinguer les étapes réellement exécutées/réutilisées, les fréquences par avis distinct, les décisions Luna, les contrôles de recommandations, l'usage et les durées enregistrées.

Le protocole définitif et son SHA256 sont conservés dans Supabase après les tests, avec la provenance du commit de code. Le GO futur doit identifier explicitement ce protocole ; aucun consentement n'est enregistré lors de cette livraison.

## Préparation enregistrée le 17 octobre 2026

- Protocole : `52964d84-f0a0-411c-8c64-8fbc69e00913`.
- SHA256 : `b466a654bf4a4ef630faff3479beec1c9639ee0b7553ca8a4f926400ebc8b71f`.
- Provenance du compilateur : `cf81e1cebbc94fe46fafedd2455cc543bddd7da3`.
- Archive source : `a7827793-aa25-4181-8b8f-8d7abcb4fc98`.
- Qualification : `1cd37216-23bd-43f4-b5e9-912b093a260e`.
- CPU natif Edge : JEV 261 ms, Luna 324 ms, réception Sol 263 ms, validation 301 ms, validation volumineuse 256 ms. Arrêts `EarlyDrop` sans dépassement. Critère conservateur : 1 500 ms ; limite Edge : 2 000 ms.
- Durées totales correspondantes : 2 146 / 1 812 / 1 306 / 754 / 668 ms, distinctes du CPU. Mémoire native à l'arrêt : 28,1–28,7 Mo ; mémoire JS observée pendant la probe : jusqu'à 53,4 Mo.
- Simulation sur textes réels : 80 analyses fictives, 32 preuves fictivement acceptées réparties sur 30 avis, une réponse Sol fictive validée et sauvegardée. Ce ne sont pas des résultats fournisseurs. Plafond Luna réel futur : 32 requêtes, nombre exact non encore connu.
- Requête Sol simulée complète : 79 318 octets, 21 625 tokens locaux, 24 477 avec marge, 8 291 de réserve sur l'entrée, 9 500 réservés pour la sortie. Les mesures du dossier final seront refaites après JEV et Luna réels.
- Empreintes du rapport historique, caches existants, anciens runs, opérations V2 et résultats Artisan identiques avant/après.
- Contrôle SQL des citations corrigé pour les positions UTF-16 JavaScript : un emoji présent dans une source aurait provoqué un faux rejet. La correspondance exacte des citations et des fenêtres de contexte reste exigée, y compris après un caractère hors BMP.
- Contrôles : 11 régressions réelles hors réseau avec mocks, 9 tests Deno, SQL/RLS, unitaires, lint, build et affichage FR/VI en 360/390/430/768 px. CI GitHub et Pages vérifiés.

GO proposé : « GO — J'autorise Codex à exécuter une seule fois le rapport vietnamien Chill Thái - Thai Food selon le protocole 52964d84-f0a0-411c-8c64-8fbc69e00913. Maximum 80 appels JEV V12 économiques, 32 requêtes Luna regroupées par avis, puis un seul appel gpt-6.1-sol si les preuves sont suffisantes. Réutiliser uniquement les caches exactement compatibles. Aucun appel Apify et aucune relance payante automatique. Conserver les rapports et historiques inchangés. Assurer le lancement et le suivi, puis présenter le rapport, les contrôles et les appels, tokens et durées observés. »
