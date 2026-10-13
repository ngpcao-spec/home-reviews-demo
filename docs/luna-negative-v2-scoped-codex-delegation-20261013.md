# Délégation unique Luna V2 à Codex

Autorisation explicite reçue directement dans la conversation : exécuter Luna V2 à la place de l'utilisateur, sans manipulation GitHub/Cloud/iPhone. Elle concerne uniquement le dataset `c8b3eee7-2554-43d9-a16b-5e12413af793`, le scellement `c4031dc6-e0a3-4992-bb35-f790ecccd034`, la configuration `luna-negative-focused-v2-choice-v1`, `gpt-6-luna`, au maximum 28 requêtes pour 32 questions, un passage sans retry. Coût indicatif : 0,0019038 USD, sans plafond monétaire supplémentaire.

L'adaptateur reprend la délégation administrative de native48, avec le périmètre V2. Le compte MCP authentifié enregistre `operator_identity = {kind: codex_admin, channel: supabase_mcp}` et `consent_source = user_directive_codex_delegation`. Aucune session humaine ni confirmation iPhone n'est simulée : `created_by` du plan et `confirmed_by` du run sont nuls pour cette voie administrative. La référence d'autorité organisationnelle est enregistrée séparément et sa validité est vérifiée avant les tentatives.

Les RPC restent `SECURITY INVOKER`, privées au rôle service serveur, avec contrôle explicite de rôle, appartenance, périmètre, SHA256 de la directive et date d'expiration de 24 heures. Empreinte de l'extrait d'autorisation et de son périmètre : `52e4a73b9aef57569e9db17e8c6bb232cf9a668ce5e428c929f793fbe8bdd1a2`. Le document d'autorisation exact est conservé dans le run, avec son empreinte canonique, le rôle d'enregistrement, l'horodatage et le périmètre. Aucun consentement permanent.

La réservation transactionnelle, les 28 tâches uniques, les 32 résultats par question, les limites et le worker existants sont réutilisés. La même clé d'idempotence et le même verrou que la voie manuelle empêchent deux runs. Un run existant est seulement suivi. Les annotations, snapshots, instructions V12 et anciennes expériences ne sont pas modifiés.

Les migrations et tests n'enregistrent aucune dépense : confirmations et réponses simulées sont annulées par rollback. L'autorisation réelle et la mise en route du worker sont des opérations administratives explicites, séparées après validation et déploiement.
