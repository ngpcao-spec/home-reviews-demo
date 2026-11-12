# K.HOUSE — rapprochement Apify du 12 novembre 2026

Base de travail : bb4ab6d1843a3202c160336f5bd4d4a9e2307530.
Branche locale : codex/khouse-apify-reconciliation-20261112.

## Observation de production

Tâche : 387493e7-c236-40c8-9d71-416eda6869e0.
Établissement : fd26fcc5-00ae-481c-b4e5-6f2b17ff1593.
Place ID : ChIJTQBISo9ncDERyPcP3aY9kI4.
Lancement tenté le 2026-11-11 à 20:21:01.628607 UTC.
Fin de tentative : 20:21:02.534385 UTC.
Statut existant dead ; erreur APIFY_START_OUTCOME_UNKNOWN ; run, dataset et confirmation d'absence tous null. Aucune de ces valeurs n'a été modifiée.

Une fonction temporaire khouse-apify-reconcile-20261112 a été déployée, protégée par le mécanisme existant verify_review_scheduler_token. Elle utilisait uniquement le secret APIFY_API_TOKEN côté serveur et des GET Apify, avec établissement, tâche, actor et fenêtre temporelle fixes. Aucun endpoint de lancement Apify, aucune écriture de données métier.

Les requêtes internes 104601 et 104602 ont échoué à la première lecture /v2/acts/compass~google-maps-reviews-scraper : HTTP 401 Apify (enveloppe diagnostic HTTP 502). La seconde applique explicitement trim(), comme le worker. Aucun run ni input n'a donc pu être consulté. Aucun run n'est identifié ; aucune absence n'est établie. Le refus actuel n'établit pas le statut de la clé au moment historique.

La fonction temporaire a été fermée par remplacement intégral, version 3 : retourne seulement HTTP 410 DIAGNOSTIC_CLOSED. Vérification HTTP externe réussie. Aucun secret exposé, enregistré ou modifié.

## Cause démontrée et limites

Le worker réserve avant POST, puis enregistre le run après sa réponse. Une réponse perdue ou un échec du checkpoint laisse une réservation sans run ; le catch remplace la cause par APIFY_START_OUTCOME_UNKNOWN. C'est une perte diagnostique démontrée. La cause exacte de la tentative historique ne peut pas être reconstruite depuis les journaux disponibles.

Correctif local uniquement : journal corrélé avec job/run/dataset dès réception ; journal de cause Apify typée avant remplacement du code terminal. Pas de message d'erreur arbitraire, réponse brute, clé ou input dans ces nouveaux journaux. mapped_http_status représente le statut interne ApifyError, pas nécessairement le statut HTTP natif du fournisseur. Aucun changement des réservations ou règles de relance.

## Vérifications hors réseau

11 tests réussis dans review-sync-lost-response.test.ts et incremental-review-sync.test.ts. Les nouveaux cas exécutent les fonctions réelles processJob/processApifyJob avec HTTP et persistance simulés :
- Apify accepte mais la réponse est perdue : un seul POST, état inconnu terminal, aucune relance ni import.
- Réponse reçue puis checkpoint refusé : identité conservée dans le journal ; pas de second POST.
- Réservation enrichie d'un run préalablement vérifié : reprise GET uniquement, sans nouvelle réservation.
- HTTP 401 simulé : cause conservée, résultat inconnu et retry désactivé, aucun secret dans le journal.

TypeScript tsc -b et ESLint du fichier de test réussis. Le fichier Edge est exclu par la configuration ESLint du projet ; ne pas présenter cette exclusion comme une validation lint serveur.

## Déploiement du pilote

Toujours suspendu. Aucune migration, fonction métier, version client, donnée de restaurant ou liste d'activation modifiée. Aucun appel fournisseur payant. Le correctif local de journalisation n'a pas été déployé.

Prérequis concret : rétablir APIFY_API_TOKEN directement dans les secrets Edge Supabase, sans transmettre sa valeur dans le chat. Alternative pour le seul rapprochement historique : export complet des runs du 11 novembre 2026, 20:11–20:31 UTC, avec IDs, actId/actor, build, startedAt/status/dataset et INPUT. Actor compass/google-maps-reviews-scraper, build attendu 0.0.545, langue vi, Place ID ci-dessus, maxReviews 150, reviewsSort newest, reviewsStartDate 2026-11-07T15:26:12.925Z. La proximité horaire seule ne permet pas un rattachement.

Un accès Apify valide reste nécessaire au fonctionnement normal du pilote même si un export permet de résoudre la tentative passée. Après résolution, actualiser la sauvegarde avant les écritures de reprise/déploiement ; ne pas réutiliser aveuglément le snapshot préalable si les données ont changé.

