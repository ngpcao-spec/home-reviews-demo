# Pilote délégué JEV → Luna → Sol — préparation technique

Cette livraison applique `jev-luna-sol-delegated-pilot-preparation-20261014.md` (référence `4f36091`). Elle ne constitue pas une autorisation de lancement. Aucun run, tâche, verdict, résultat ni consentement réel n'est créé pendant cette préparation.

## Source et protocole figés

Plan VI : `5295245f-b2c1-4f5d-80ad-ca9f821ae3da`.
SHA256 plan : `c096931805dbc7d4e655df7d1aaddd6bc92e96a6de784835e07c0220673b485a`.
Dossier initial : `d32edd725e7b31adbdad5903a7c62aa09a4dc0ab14272abaae60a4148533fa35`.
Protocole : `jls-codex-delegated-pilot-v1`, SHA256 `0c0568714ca971d277f86356ba5a9c30dae1749441e037a3cb8cb7fcf5a1e29b`.

Le plan FR est exclu. Le snapshot, les 422 analyses JEV, les 25 citations et leurs empreintes restent inchangés. La préparation gratuite ajoute seulement un protocole immuable, distinct du plan.

## Composants

- `jev-luna-sol-delegation.ts` : protocole, suffisance des preuves, dossier Sol accepté uniquement, coûts séparés.
- `jev-luna-sol-executor.ts` : orchestrateur avec transport HTTP injectable ; aucune API appelée dans les tests.
- `jev-luna-sol-execution-store.ts` : adapteur des RPC transactionnelles, contrôle de l'autorité via Auth Admin avant chaque réservation.
- `process-jev-luna-sol-hybrid` : worker authentifié par le mécanisme scheduler existant. Aucun run valide = aucune requête provider.
- `jev-luna-sol-hybrid` : lecture authentifiée par organisation ; GET et visibilité ne créent jamais un run. POST reste refusé.
- `analysis_jev_luna_sol_protocols` et `analysis_jev_luna_sol_dossiers` : nouvelles tables immuables et RLS owner/admin/manager. Runs/tâches/verdicts/résultats/événements expérimentaux existants sont réutilisés, sans modifier les plans.
- Le contrôleur Cron réveille seulement les runs futurs autorisés ; il n'en crée aucun et n'appelle aucun fournisseur lorsqu'il n'existe aucun run.

## Délégation future, non exécutée dans cette livraison

Après une nouvelle directive humaine explicite de **LANCER** le plan VI unique, l'administrateur Codex authentifié devra :

1. Vérifier les hashes, l'intégrité des 422 caches, le protocole, l'autorité organisationnelle active, les tarifs et l'absence de run existant. Un run existant est uniquement suivi ; aucune deuxième exécution.
2. Enregistrer la directive exacte, son SHA256, le périmètre 24 Luna + 1 Sol, les estimations reconnues, `action=execute_luna_and_sol_once`, l'autorisation explicite des deux phases, l'horodatage et l'expiration de 24 heures.
3. Appeler `jls_authorize_delegated` avec le rôle service autorisé. L'enregistrement reçoit une attestation HMAC serveur vérifiable via le secret Vault existant. L'acteur `codex_admin/supabase_mcp` est séparé de l'autorité d'organisation. Aucune fausse session humaine, aucun `auth.uid()` forcé, aucune confirmation iPhone simulée.
4. Réveiller le worker avec `jls_wake_delegated`, puis suivre le run durable. Ces deux opérations ne sont **pas** exécutées pendant la préparation.
5. Ne jamais renvoyer une tentative dispatchée : timeout, erreur réseau, 429/500, réponse perdue, modèle invalide ou parsing invalide sont conservés sans retry. Le budget est réservé transactionnellement avant HTTP. Huit tentatives simultanées maximum, 24 groupes Luna puis un seul Sol.

Les autorisations sont privées au rôle service, `SECURITY INVOKER`, avec RLS de lecture par organisation et état historique immuable. Le consentement est une attestation administrative de la directive reçue, pas une signature humaine indépendante. Une clé absente, une identité inactive, une signature manquante ou une autorisation expirée bloque l'exécution.

## Barrière avant Sol

Les 24 réponses Luna doivent être complètes, avec 25 décisions identifiables et des empreintes conformes. Aucun échec ni usage incertain ne permet Sol.

Minimum après filtre de confiance Luna 0,60 :
- 12 preuves ACCEPTED ;
- Qualité 2, Service 2, Prix 2, Ambiance 1 ;
- 6 critiques ;
- 4 citations issues d'avis 1–3 étoiles.

La faisabilité gratuite sur le plan donne 25 preuves disponibles, axes 12/6/5/2, 15 critiques et 11 citations 1–3 étoiles. Ce n'est **pas** une prédiction du nombre de preuves que Luna acceptera.

Seules les preuves ACCEPTED sont transmises à Sol. Les statistiques des 422 avis ne sont pas recalculées sur ce sous-ensemble. Le dossier Sol et ses hashes/coûts sont figés après Luna. Estimation haute recalculée incompatible avec le scénario reconnu, input supérieur au budget prévu ou autorisation expirée : arrêt, sans dépense Sol ni plafond monétaire nouveau.

Le réveil qui termine Luna fige le dossier puis laisse Sol au réveil suivant. Une réponse Sol invalide ne déclenche aucune nouvelle tentative. La validation finale conserve les preuves, chiffres, axes et actions déterministes ; une recommandation insuffisamment justifiée reste À réexaminer.

## Coûts et affichage

Luna : 22 835 tokens estimés, 0,0022835 USD. Sol conditionnel : 18 679 input / 3 800 output, 0,075358 USD. Total : 0,0776415 USD ; scénario haut : 0,1346415 USD. Usage mesuré et coût calculé sont séparés par phase. Télémétrie manquante = coût inconnu, jamais zéro. Suppléments éventuels non garantis ; coût calculé n'est pas une facture vérifiée.

FR/VI : Plus / Thêm → Test Jev → Rapport hybride JEV + Luna + Sol. L'écran affiche la préparation, le consentement futur, les budgets, progression/erreurs, dossiers avant/après Luna et le rapport futur. Le bouton payant reste désactivé. Le futur lancement délégué ne requiert ni GitHub ni clic iPhone.

## Vérification

1 619 tests unitaires, 4 tests Deno hors réseau et 8 contrôles mobiles FR/VI (360/390/430/iPad), lint, build et contrôle Deno des deux fonctions. Tests SQL sur le schéma réel exclusivement avec mocks et rollback : signature, scope, expiration, idempotence, 24 groupes/25 décisions, concurrence, tentative unique, gel Sol, maximum un appel Sol, immutabilité et refus cross-tenant. Aucun wake provider dans ces tests.

Les décisions Luna et le rapport Sol sont des analyses IA expérimentales, jamais une validation humaine indépendante. Aucun pipeline commercial n'est activé.
