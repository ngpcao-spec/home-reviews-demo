# Chill Thái — finalisation technique V2, 17 octobre 2026

Run source : `3294262e-8946-41c0-b9c4-463a4fe27e74`.
Opération source : `6e9bd72c-108d-4275-bea6-c5ee3c45ea19`.
Première revalidation conservée : `fd8da97a-4cb8-4146-aab3-1b2cc9127a72`, table `public.analysis_jls_snapshot_preparations`.

## Cause et correction

`receive_jls_sol_ready` avait sauvegardé le reçu. La garde des tâches n'autorisait la transition `received` vers un statut terminal que pour `jls-restaurant-sol-ready-vi-v1`. Le protocole `jls-historical-snapshot-v2-vi-v1` utilisait pourtant le même chemin. La garde levait `JLS_NO_RETRY` dans `finish_jls_sol_ready`, provoquant le rollback de sa transaction, puis le blocage historique annoncé.

La garde reconnaît maintenant ces deux versions pour une tâche Sol consommée (`request_count=1`), sans autoriser un retour à `pending` ou `running`. La finalisation verrouille opération, run et tâche, vérifie phase, identité du worker, bail et empreintes. Elle refuse un run déjà terminal et les paramètres manquants. L'accusé d'une finalisation déjà enregistrée est idempotent seulement pour le même statut, corps et hash.

Version technique : `jls-received-finalization-v2`. Aucune règle d'admissibilité des preuves, décision Luna, statistique JEV ou rédaction Sol n'est modifiée.

## Revalidation gratuite séparée

Le module `jls-saved-response-replay.ts` partage exactement le validateur de reçu du worker. Son interface n'accepte ni transport, clé API, port de dispatch, consentement ni création de run. Il vérifie le protocole figé, les décisions, les citations, le dossier et les empreintes, puis rejoue le contrat V2 existant.

La RPC serveur `save_jls_saved_response_validation_v2` relie le nouveau résultat au reçu, à l'artefact, au protocole et à la première revalidation. Elle utilise la table immuable existante `analysis_jls_snapshot_preparations`, kind `saved_sol_response_validation_v2`, version `jls-saved-response-validation-v2`. L'unicité `(protocol_id,kind)` protège les sauvegardes concurrentes et les accusés perdus. Les lectures restent protégées par les RLS owner/admin/manager ; les écritures restent serveur uniquement.

Le reçu brut garde son SHA exact. Pour le JSON natif, on vérifie l'égalité des valeurs avec le reçu et le SHA de la représentation parsée enregistrée. Postgres conserve parfois l'échelle `1.0` tandis que JavaScript normalise `1` : cela ne doit pas être confondu avec une modification de réponse. Le SHA du texte brut n'est jamais normalisé.

## Reproduction et contrôles

- Avant correction : les corps des RPC et triggers réellement déployés sont copiés dans `pg_temp`, avec des copies des lignes sauvegardées. La réception réussit, puis la finalisation reproduit exactement `JLS_NO_RETRY`. Aucun run ou consentement public n'est créé.
- Après correction : le même test Postgres passe réception, interruption entre réveils, validation, sauvegarde atomique tâche/artefact/run/opération et répétition d'accusé. Une interruption après les écritures est simulée par rollback de sous-transaction ; aucun résultat partiel ne subsiste. Mauvais worker, worker absent, mauvais hash, retour à running et résultat différent sont refusés.
- Le replay du vrai dossier est exécuté par Deno sans permission réseau, avec `fetch` interdit. Il conserve le résultat SHA `a0c4504190b1f75f06c6a82e9ca77a950958d7546125518b321b6d381bd11469`, identique à la première revalidation.
- SQL/RLS : sauvegarde gratuite idempotente, refus de source/réponse falsifiée, immutabilité, lecture propriétaire, écriture navigateur refusée, autre organisation et accès anonyme refusés. Transaction de test annulée.
- Tests unitaires JLS, Deno (5 tests, réseau interdit), vérifications Deno des fonctions, lint et build.
- Huit tests Playwright FR/VI aux largeurs 360, 390, 430 et 768 px : provenance, consultation du texte masqué et des motifs, absence de débordement horizontal, rechargement et zéro POST.

Les tests SQL isolent les écritures historiques dans des copies temporaires. Ils ne prétendent pas relancer le worker payant sur le run bloqué. Les tests fournisseurs utilisent exclusivement des mocks.

## Résultat et accès

Le résultat reste `needs_review` : quatre recommandations proposées, deux affichables, deux masquées pour `PRECISE_ACTION_REQUIRES_REVIEW`. Ce maintien est volontaire ; la correction technique n'affirme pas une amélioration sémantique des recommandations.

HOME Reviews → Plus / Thêm → Test Jev → Rapport hybride JEV + Luna + Sol → Chill Thái.
La revalidation récente est affichée séparément du run bloqué. L'ancienne revalidation reste consultable via l'historique et via GET `jls-restaurant?...&validation_version=v1`. GET ne lance ni traitement ni écriture.

Les contrôles d'intégrité comparent les SHA complets du run, de l'opération, des tâches, des artefacts et de la première revalidation avant/après intervention. Les 80 appels JEV, 28 Luna et un Sol déjà enregistrés ne sont pas répétés. Aucun nouveau consentement, run payant ou appel fournisseur n'est autorisé par cette correction.
