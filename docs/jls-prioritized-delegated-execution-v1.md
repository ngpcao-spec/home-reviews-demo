# Exécution déléguée du rapport vietnamien priorisé

Protocole : `jls-prioritized-vi-delegated-execution-v1`.
Identité Supabase : `1ae7e007-3027-48bc-a823-30db5bdb75ad`.
Format conservé : `jls-prioritized-recommendations-v1`.
Cette livraison prépare uniquement le mécanisme. Aucune directive d'exécution,
aucun consentement, run, tâche payante ou appel fournisseur n'est créé.

## Source immuable et compatibilité

Artisan, plan `5295245f-b2c1-4f5d-80ad-ca9f821ae3da`,
run source `489d42ae-c44c-40c1-8435-16f304c71a9e`, préparation VI événement 232.
Réutilisation de 422 analyses JEV et des 25 décisions Luna issues de 24 requêtes
historiques : 24 ACCEPTED, une REJECTED exclue du dossier. La réutilisation n'est
pas une nouvelle validation humaine indépendante.

`verifyReusedLuna` vérifie les identités, organisations, requêtes, réponses natives,
leurs SHA256, le modèle servi et les décisions recalculées déterministiquement à
partir des réponses déjà stockées. `loadJlsExecution` réutilise les contrôles existants
du snapshot et du cache permanent. Aucune incompatibilité ne déclenche une analyse.
Le dossier, prompt, schéma, configuration et requête du format restent inchangés.

Empreinte du protocole prêt :
`a414cb081b825ca74e75e039c7315eb4fcd0c5557a519dd6ece0fdb06ad9a81c`.

| Objet | SHA256 |
|---|---|
| Plan source | `c096931805dbc7d4e655df7d1aaddd6bc92e96a6de784835e07c0220673b485a` |
| Résultat source | `6cb5318be280aac397f4771be8ff5d05980fe82a28a13cb60be3cef1f99a4612` |
| Décisions réutilisées | `01466fdffe668ed47dbc95fd5fd7960f5cc99601e1a4d0fe48b966aaf541d711` |
| Manifest natif Luna | `0dd5f2da408dabd30d8347764a22247ea3f0fe35e7746c9ed80b6e6d0cd51cc0` |
| Préparation VI | `681f0a58fb2189bc583064042031abc1d5d73aa626b83710dc68250c35b97df0` |
| Dossier | `acb6bbe7ea9bf967101252e38bbe67a3e811c5003992a0e649c10c067a04718e` |
| Prompt | `4bcd1c7ee9bb751b7d99a3d3aaad9b73f6056f17e5bd1c4d3af485f0e4a639c4` |
| Schéma | `c935a4a96e32fc9e194142a2e2dc9207870dc032e07d5296a9a319266b90af13` |
| Requête | `ba71e2a18d9943cb6d90a5f550bf2fc6807b60037ac5c3e8050a9a643537b71f` |
| Configuration | `40f9868144a16ad4a105aac41aff9b32feb9e25be4f3f8854f696d380624e51d` |

## Stockage et serveur

Tables séparées `analysis_jls_prioritized_protocols`, `...runs`, `...tasks`,
`...results`, `...events`. Écritures serveur uniquement ; lectures RLS
owner/admin/manager dans l'organisation du plan. Le protocole et les résultats
sont immuables. Le consentement est signé serveur avec le mécanisme Vault déjà
existant, sans emprunter une session humaine ou réutiliser le consentement historique.

Un run unique par protocole ; une tâche unique par run ; request_count dans {0,1}.
`claim_jls_pri_task` verrouille transactionnellement le run puis la tâche avant l'envoi.
Toutes les opérations utilisent cet ordre de verrouillage. Aucun lease consommé
ne peut être attribué à un second worker. Un lease perdu devient incertain, jamais
remis en file. La réservation n'est pas une preuve de réception par le fournisseur.

Le nouveau worker `process-jls-prioritized` réutilise l'authentification scheduler
et le contrôleur durable existant. Le contrôleur ne réveille que des runs autorisés
queued/running. Avec zéro run, zéro réveil HTTP de ce nouveau pipeline. Aucun nouveau
cron et aucun appel au réveil ne sont exécutés par la migration ou le déploiement.
Les parcours historiques et leurs autorisations restent distincts.

Une seule requête brute vers POST `/v1/responses`, modèle `gpt-6.1-sol`, reasoning low,
max_output_tokens 9500. Zéro SDK retry, redirect, fallback ou appel de correction.
Timeout HTTP 110 secondes ; lease 300 secondes. Une réponse invalide, un refus,
un usage absent ou une réponse perdue restent enregistrés ou signalés pour examen.
Le texte brut non JSON est également conservé ; seul un secret éventuellement
renvoyé par erreur est expurgé. Les SHA256 désignent les captures enregistrées.

## Futur GO uniquement

Instruction proposée au propriétaire :

> GO — J'autorise Codex à lancer une seule fois le rapport vietnamien Artisan au
> format jls-prioritized-recommendations-v1, selon le protocole
> jls-prioritized-vi-delegated-execution-v1 préparé. Maximum un appel gpt-6.1-sol,
> aucun nouvel appel JEV, Luna ou Apify, aucun retry payant. J'accepte l'estimation
> de 0,083124 USD et le scénario haut de 0,134724 USD, qui ne sont pas une facture
> garantie. Réutiliser les sources compatibles et ne pas rouvrir le run historique.

Ce texte dans cette documentation est un EXEMPLE, jamais une autorisation.
Seule une nouvelle instruction directe de l'utilisateur dans ChatGPT permet :

1. Relire le protocole enregistré et toutes les sources ; vérifier aussi l'autorité
   active via l'Auth Admin API serveur existante et l'appartenance organisationnelle.
2. Construire `prioritizedConsent` avec le texte réel du GO, le SHA du protocole,
   requested_at UTC actuel et expires_at exactement 24 heures plus tard.
3. Appeler `jls_pri_authorize` par le canal administratif authentifié Supabase MCP,
   avec rôle serveur, protocole et consentement. Le run et la tâche naissent ensemble
   dans cette transaction ; une confirmation répétée retourne le même run.
4. Déclencher explicitement `jls_pri_wake` pour ce run puis suivre son état. Le
   contrôleur durable assure les réveils suivants ; il ne répète jamais l'appel Sol.
5. Lire le résultat et les coûts, sans autoriser un second essai si l'état est incertain.

Aucun de ces cinq actes d'exécution n'est réalisé pendant la préparation.
Un GET ou rechargement ne crée rien et ne lance rien. Le futur résultat est affiché
séparément, avec le renderer déjà développé et le rapport historique toujours disponible.

## Coût et contrôles

Prévision inchangée : 19 862 tokens d'entrée, 4 340 de sortie ; 0,083124 USD.
Scénario haut : 9 500 tokens de sortie ; 0,134724 USD. Tarifs enregistrés
2 USD/million input et 10 USD/million output. Suppléments non vérifiés.
Le coût final est recalculé depuis l'usage et vérifié aussi en SQL, pas assimilé
à une facture officielle. Modèle ou usage manquant : coût inconnu signalé.

Tests fournisseurs exclusivement simulés : absence de GO, expiration, périmètre,
empreintes, réponses natives incompatibles, concurrence, réveils répétés, timeout,
HTTP 429/500, refus, réponse invalide, sauvegarde ambiguë, télémétrie manquante.
Tests SQL sans création de consentement valide et en transaction annulée : RLS,
grants, source VI exclusive, faux GO absent/expiré, hashes, immutabilité, idempotence.
La conformité technique ne garantit pas la fidélité sémantique d'une rédaction Sol.
