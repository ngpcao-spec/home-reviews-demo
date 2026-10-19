# Raccordement du rapport direct à quatre catégories

Version de raccordement : `jls-direct4-worker-v1`.
Protocole : `jls-direct4-execution-v1`. Artefact Sol : `jls-direct4-sol-ready-v1`.

Le dossier immuable `bace8577-e302-42fe-8625-ff9951c1c788`, SHA256
`4752a9a1e214633052a1138faa3b6ef45e487a8cbc040048c6ceaea3c6e0a813`, reste la seule source.
Ses instructions, quatre catégories, 32 citations, questions Luna, critères de
suffisance et schéma Sol restent inchangés. Aucune projection vers les 25 thèmes.

## Chemin réutilisé

L'adaptateur branche le dossier sur les protocoles, autorisations déléguées,
réservations atomiques, tâches et artefacts `analysis_jls_restaurant_*` existants.
Le worker `process-jls-restaurant` utilise le transport Luna existant. Après les
32 réponses, il conserve les décisions et passe à `prepare_sol`.

La compilation gratuite du dossier accepté se fait hors du chemin Edge de
dépense avec `scripts/compile-jls-direct4-sol.ts`, comme pour les snapshots
historiques. Elle produit la requête exacte et le certificat de tokens. Le RPC
existant `save_jls_sol_ready_artifact` vérifie leurs sources puis prépare la tâche
Sol. Le même worker réserve au plus une tentative Sol et sauvegarde d'abord la
réponse brute. Un réveil distinct valide et sauvegarde le rapport. Ce découpage
évite de retokeniser le dossier après un appel facturé. Codex assure ces étapes
sur une future exécution autorisée ; aucune manipulation iPhone n'est nécessaire.

La lecture authentifiée existante accepte `jls-restaurant?view=direct4` avec
`establishment_id`. Elle restitue le run, ses tâches, artefacts, réponse brute et
rapport validé. Aucun nouvel écran. Les formats historiques gardent leur chemin.

## Autorisation et limites

`direct4Consent` réutilise le constructeur de consentement existant et rattache
explicitement le GO à la préparation et à son empreinte. Le RPC de délégation
vérifie l'identité serveur, l'appartenance owner/admin/manager, le périmètre, la
date d'enregistrement et l'expiration opérationnelle. Un seul run par protocole.
Une qualification réussie du worker **déployé** est exigée avant autorisation.
Maximum : 32 requêtes Luna et une Sol, aucune JEV/Apify. Aucune répétition après
dispatch, timeout ou issue incertaine ; aucun client SDK avec retry fournisseur.

La préparation et la qualification ne créent aucun consentement, run ou tâche
payante. Le GO antérieur dans la conversation n'a pas été consommé par le
diagnostic : aucune tentative fournisseur n'avait été réservée. Il concerne
toujours la même préparation et les mêmes plafonds. Un consentement opérationnel
ne pourra être enregistré que lors d'une reprise d'exécution explicitement
demandée, avec la directive originale et sa provenance ; aucune confirmation
iPhone fictive n'est créée.

## Qualification gratuite

`scripts/prepare-jls-direct4-worker.ts` exécute hors réseau le parcours réel avec
le dossier figé et les transports simulés : Luna, contrôle de suffisance,
compilation Sol, réception, validation, sauvegarde et consultation. Les fixtures
techniques sont archivées séparément et portent `explicit_technical_mock`.

Le mode serveur authentifié `direct4_probe` vérifie les véritables sources puis
rejoue quatre étapes en mémoire avec les mêmes workers : `luna`, `prepared`,
`sol`, `validate_sol`. Cette branche termine avant lecture d'une clé fournisseur.
Les mesures CPU/durée/mémoire et identifiants d'exécution Edge sont archivés.
Ces mocks prouvent le raccordement technique, pas le comportement réel de Luna
ou Sol ni la justesse sémantique du futur rapport.

Qualification effective du 19 octobre 2026 : worker `process-jls-restaurant` v18,
lecture `jls-restaurant` v17, code exécuté `3933122`. Les quatre invocations Edge
ont répondu HTTP 200 et enregistré leur identifiant d'exécution. Les archives
de chaque étape sont reliées dans la qualification immuable
`df1a79e4-004e-41c5-9c44-6bcbb1f96334` (`analysis_jls_snapshot_preparations`).
Le protocole préparé est `16340d77-7743-4b6b-95a2-c897cb74ba1b`, empreinte
`c497c7afb2e5f126b5ded6b93839b029a7185d91005575a512f50e61b7d856e7`.
Aucun consentement, run ou appel fournisseur ne lui est associé.

Les durées internes des quatre sondes vont de 726 à 1 179 ms. Le runtime expose
`process.cpuUsage` à zéro : ce compteur n'est pas une mesure CPU exploitable et
ne démontre pas une consommation nulle. Les sondes effectivement déployées ont
terminé sans dépassement ; leurs durées totales incluent aussi les lectures et
ne doivent pas être présentées comme du temps CPU.

## Correction du certificat après le premier lancement réel

Version du vérificateur : `jls-direct4-token-wire-v1`.
Run source : `1a7b3920-e624-40d0-a829-b276f739dbdc` ; artefact Sol conservé :
`059a42bc-f92b-4e8f-8076-0afb706ec3fb`.

La mesure existait : 16 365 tokens locaux, 18 585 avec marge, budget 32 768.
Le certificat contenait bien le texte exact de la requête figée. La relecture
JSONB a changé l'ordre des clés de `statistics`. Le vérificateur reconstruisait
ensuite un nouveau texte JSON dans `input[1].content` et cherchait sa mesure
exacte dans le certificat scellé. Les données étaient identiques, la chaîne ne
l'était plus : `JLS_TOKEN_MEASUREMENT_MISSING`, avant réservation de Sol.

Le correctif reconstruit toujours le dossier accepté avec les 32 réponses Luna
réelles, contrôle son égalité canonique avec le contenu figé, ainsi que le prompt,
le modèle, le schéma, la sortie réservée et tous les autres champs de requête.
Il mesure et transmet ensuite **la requête figée exacte**. Les doubles clés,
changements de contenu et entrées de certificat absentes restent refusés.
Il n'y a aucun fallback de tokenisation, aucune hausse du budget, aucune
normalisation des probabilités et aucun changement des critères de preuve.

La vérification avant envoi et la validation après réponse utilisent la même
liaison au texte figé. Le certificat, les empreintes de requête, les verdicts et
l'artefact historiques restent inchangés. Les nouveaux dossiers compilés sans
liaison explicite gardent leur construction précédente.

Le probe initial transportait toute sa fixture dans une chaîne JSON, conservant
l'ordre des clés local. Il ne couvrait donc pas la relecture normale de l'artefact
Sol JSONB. Le nouveau mode de qualification `direct4_probe`, phase `saved_sol`,
charge cet artefact et les résultats Luna par le même adaptateur de stockage que
le worker. Il conserve les contrôles de compte, d'organisation et de sources,
puis simule uniquement la réservation et le transport Sol en mémoire. Il ne
réouvre pas le run bloqué et ne crée aucun consentement, tâche ou run payant.

Rejeu local : `scripts/replay-jls-direct4-sol-wire.ts`, avec `--deny-net` et un
export privé contenant `state_json` produit par PostgreSQL (`jsonb::text`). Ce
format préserve précisément l'ordre rencontré sur le serveur. La sortie porte
explicitement `explicit_technical_mock`, réutilise les 32 résultats réels et
vérifie également réception, validation, sauvegarde simulées et absence de retry.
## Continuation Sol après le blocage du premier run

Version : `jls-direct4-sol-continuation-v1`.

Une continuation stockée dans `analysis_jls_direct4_continuations` réutilise
`processReadySol`, `solReadyPort` et `direct4ReadyContract`. Elle référence le
run et l'opération bloqués, l'archive des 32 réponses Luna, le même artefact
Sol certifié et le consentement existant, sans renouveler sa date d'expiration.
Le run, ses tâches et son opération historiques ne sont jamais réouverts.

La création déléguée est explicite, réservée au serveur et idempotente. Un index
unique par protocole et par opération source limite les continuations payantes
à une seule. Le claim verrouille la continuation puis la source, vérifie le
consentement, les sources et les hashes et réserve durablement `request_count=1`
avant l'envoi. Les wakes concurrents n'envoient rien de plus. Une tentative sans
réponse sauvegardée devient `billing_uncertain`, sans retour à la file. La
réception brute et la validation sont deux étapes persistantes distinctes. Après
réception, l'expiration du consentement n'empêche pas la validation gratuite.

RLS : lecture owner/admin/manager dans l'organisation, aucune écriture client.
L'identité active est vérifiée par Auth Admin avant le claim. Le fournisseur
reste appelé par fetch une fois, sans SDK ni retry. Le cron existant de workers
est complété par un wake dédié aux continuations déjà explicitement créées ;
aucune continuation payante n'est créée par migration ou déploiement.

La finalisation archive atomiquement le résultat et le reçu dans
`analysis_jls_snapshot_preparations`, kind `direct4_sol_continuation_<id>`.
Le GET authentifié `jls-restaurant?view=direct4` conserve le résultat historique
et expose séparément `sol_continuation`. Aucun nouveau moteur ni écran.

Qualification : `jls_direct4_continuation.sql` utilise des mocks dans une
transaction annulée (idempotence, double réservation, perte de réponse,
immutabilité, accès propriétaire et refus inter-organisations). Les probes
serveur `direct4_continuation_inspect` et `direct4_continuation_probe` sortent
avant la lecture d'une clé fournisseur. Le probe exige `mode=mock`, utilise
le stockage et les RPC réels, puis injecte une réponse explicitement simulée.
Les mêmes mesures de tokens, règles et 26 preuves acceptées sont conservées.
