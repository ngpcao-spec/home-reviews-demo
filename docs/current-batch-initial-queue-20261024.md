# Réveil initial des demandes JEV en lots — 24 octobre 2026

## Cause prouvée sur a6881f52

Demande : a6881f52-1479-473f-b456-09ed9c7a15f3, Quán Mỳ Hoành Thánh Hải Mập.
Source : 2fb8c388-c3bd-45fc-9787-410bb8c38dd0.
L'étape attendue à 19 h 25 était **la première préparation du snapshot**,
avant certification, création des lots et tout appel fournisseur.

| Événement | Heure Vietnam (UTC+7) | Interprétation |
|---|---|---|
| Création transactionnelle demande/source | 19:24:04,614795 | Source queued, sans snapshot ni tentative |
| Réponse d'acceptation HTTP 202 | 19:24:04,831000 | Création validée, disponible au plus tard à cet instant |
| Début du cron historique | 19:25:00,777529 | Job 9 actif, une fois par minute |
| Fin du SQL cron | 19:25:00,875204 | Requête worker mise en file via pg_net |
| Prise en charge de la source | 19:25:01,963235 | Début de préparation |
| Création du plan | 19:25:06,704674 | Fin préparation / certification / plan |

Le suivi des timestamps de commit est désactivé : l'instant exact du commit initial
n'est pas enregistré. La création est une horloge transactionnelle, pas le commit.
La disponibilité est bornée entre création transactionnelle et acceptation HTTP.

- Attente disponible → passage cron : **55,946529 à 56,162734 s**.
- SQL du cron : **0,097675 s**, accès base et mise en file, CPU non isolé.
- Fin cron → claim : **1,088031 s**, transport pg_net/Edge, démarrage et accès base,
  sans ventilation CPU/base/transport enregistrée.
- Création → claim : **57,348440 s**.
- Claim → plan : **4,741439 s**, calcul et accès base, pas du temps de file.
- Total historique : **109,879394 s**, dont **32,624 s HTTP fournisseur**.

Les définitions serveur relues montrent que enqueue_current_report insère la source
et la demande puis retourne sans réveil. Aucun trigger d'insertion n'existait.
Aucun autre run source n'était en cours sur la fenêtre ; aucune reprise de lease
ni délai de retry n'est enregistré. Le premier worker arrive au passage du cron.
Le correctif précédent appelait wake_current_jev_preparation uniquement après le
checkpoint du snapshot, et le wake exigeait aussi un snapshot déjà présent :
il supprimait l'attente **après gel**, sans couvrir le démarrage **avant gel**.

## Correction limitée à l'orchestration

La migration suffixée wake_current_batch_initial_queue ajoute un trigger
**AFTER INSERT** sur les nouvelles demandes jev_sol_v2 / batch_initial_v1.
Il réutilise le réveil privé du worker source, admissible aussi pour une source
queued, jamais démarrée et sans tentative de préparation.
Le réveil appartient à la transaction de création et n'est envoyé qu'après commit :
le worker voit alors la demande et sa source ensemble.
Voir [pg_net et commit](https://supabase.com/docs/guides/database/extensions/pg_net).
Un rollback supprime le réveil. Un échec de programmation conserve la demande en
file et émet un warning sans secret ; le cron minute reste le secours.

Le wake après snapshot et les wakes après sauvegarde des lots/dossier restent en place.
Les fonctions d'enqueue, claim et réservations fournisseur ne sont pas modifiées.
Un double clic réutilise la source sans INSERT ni nouveau réveil initial.
Deux réveils restent sérialisés par les leases, verrous et bornes existants.
Une demande liée à son rapport, terminée, sous lease, différée ou expirée n'est
pas éligible au réveil source. Aucun compteur d'essai ou reçu n'est réinitialisé.
La migration ne crée, ne reprend et ne réveille aucune demande existante.
Le transport individuel, JEV, le sélecteur et Sol restent inchangés.

Retour arrière pour les prochaines demandes : désactiver le seul trigger
current_batch_request_wake sur report_generation_requests. Le cron et les
tentatives/réponses historiques sont conservés ; aucun renvoi n'est nécessaire.

## Qualification hors réseau

Le test current-batch-queue.test.ts charge les définitions SQL de production
capturées avant correction, puis la vraie migration, dans PostgreSQL local PGlite.
net.http_post est remplacé par une boîte d'envoi transactionnelle en mémoire.
Le réseau fetch est interdit et contrôlé. Aucune base distante ni fournisseur
n'est utilisé par ce test.

Les cas couvrent l'absence initiale de réveil, le réveil avant snapshot, l'idempotence,
les doubles claims, la continuation après snapshot, le fallback cron, les rollbacks,
leases/retries/expirations, le transport individuel et les issues JEV/Sol inconnues.
Les fonctions réelles d'enqueue et de claim restent identiques octet pour octet.
PGlite a une connexion exclusive : les deux claims sont testés successivement avec
lease actif, sans prétendre constituer un test de charge distribué.
Les vérifications existantes des lots/projections et du non-renvoi sont réutilisées.

## Gain potentiel

Supprimer l'alignement minute représente **environ 56 s** sur cette chronologie.
À durées de traitement et charge identiques, le total théorique serait d'environ
**54 s**, au lieu de 109,879 s. Ce calcul n'est pas une mesure après correction.
Le dispatch immédiat conserve un coût de transport et de base ; une saturation
conserve les limites de concurrence. L'attente évitable dépend de l'heure d'arrivée.
Aucune nouvelle génération ni reprise de la demande terminée n'est utilisée pour
valider ce gain. Le CPU pur, la publication seule et l'affichage iPhone restent non mesurés.

## Livraison et vérification

Migration **20261024130430_wake_current_batch_initial_queue**, appliquée et relue
à **20:04:51,751164** au Vietnam. Le trigger est actif, le cron reste actif,
et le transport est toujours batch_initial_v1. Aucun déploiement Edge ou frontend
n'est requis : seule la couche SQL d'orchestration change.

Qualification : **39 tests ciblés**, dont **18 tests PostgreSQL locaux** ; suite
complète **2 487 tests / 222 fichiers** avec deux workers, lint et build réussis.
La première exécution globale, trop parallèle sur cette machine, a rencontré des
timeouts ; la suite complète bornée passe sans modifier les seuils de test.
Les fonctions serveur d'enqueue et claim sont identiques aux définitions précédentes.
Les fonctions de réveil restent invoker et exécutables par service_role uniquement.
Le rapport a6881f52, ses deux reçus/projections et ses tentatives sont inchangés
après application ; aucun appel fournisseur ni nouvelle demande ni reprise n'a eu lieu.
