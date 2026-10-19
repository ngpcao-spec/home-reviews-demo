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
