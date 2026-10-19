# Pilote de format JEV direct, un seul avis

Ce branchement expérimental réutilise `evaluateDirectCategoriesOnce`, le client
TypeSafe natif et les archives immuables existantes. Il ne modifie aucune question,
configuration, définition, classification historique ni fonctionnalité de production.

- Préparation : `8b0c78fd-0c18-4b1e-9062-ece47380b77f`.
- SHA256 : `f5b3869b10bf107bf9242b6b4b8febc91b753670c02918b9a70d8f8a3f3ad7c7`.
- Source des textes : `f858bb8f-395d-4aa9-bd10-d7f641934244`.
- Avis unique : `0095a08b-ff64-4b53-90e1-55434b92bcd2`.
- Configuration inchangée : `jev_categories4_direct_1pass_v1`.
- Quatre questions `choice`, six choix par question, une seule requête au maximum.

Le contrat officiel permet jusqu'à 255 choix et plusieurs questions dans une
requête : https://docs.typesafe.ai/primitives/choice et https://docs.typesafe.ai/api.
Cela ne constitue pas une vérification du fournisseur sur notre compte ou une
validation sémantique des six choix. `uncertain` est une option de notre rubrique,
sans seuil de confiance automatique.

## Exécution déléguée et archives

Le POST expérimental `process-jev-direct-pilot1` utilise le jeton serveur existant,
vérifié par `verify_review_scheduler_token`. Il n'existe aucun scan automatique,
cron ou appel depuis l'interface. Les GET et les POST non authentifiés ne lancent rien.

Un GO séparé est enregistré avec son texte exact, SHA256, autorité, provenance du
code, portée exacte (avis, préparation, configuration et requête) et expiration
limitée à 24 heures. Le worker vérifie les empreintes, l'utilisateur actif et son
rôle owner/admin/manager dans l'organisation, puis consomme une réservation par
INSERT atomique. La contrainte unique `(protocol_id, kind)` n'autorise qu'une
réservation pour ce pilote ; un conflit ne restitue jamais l'ancienne réservation.

Les kinds suivants, dans `public.analysis_jls_snapshot_preparations`, sont distincts
de tous les anciens runs et de la préparation des 80 avis :

- `jev_direct_categories4_chill1_execution_v1` : consentement délégué spécifique.
- `jev_direct_categories4_chill1_attempt_v1` : réservation consommée avant envoi.
- `jev_direct_categories4_chill1_receipt_v1` : réponse brute, hash, HTTP, durée et erreur.
- `jev_direct_categories4_chill1_result_v1` : parsing, classes, probabilités, modèle, usage.

La réponse brute est enregistrée avant parsing. Une réponse invalide, un refus,
un timeout, une perte réseau ou une sauvegarde incertaine n'autorisent aucun nouvel
appel. Les réveils répétés ou concurrents consomment au maximum une tentative.
Les données manquantes restent signalées comme manquantes. Aucun appel modèles,
Luna, Sol, Apify ou autre avis n'est permis par ce branchement.

Les écritures utilisent uniquement le rôle serveur et la RLS existante protège
les lectures par organisation. Les secrets restent dans l'environnement Edge.
Le parent historique sert uniquement de clé de stockage ; aucun ancien run ou
consentement n'est rouvert.

## Contrôles avant lancement

77 tests ciblés couvrent le contrat, les compteurs, le consentement, l'authentification,
le traitement serveur et le conflit de réservation. Contrôles Deno, lint et build.
Le parcours sur les sources réelles est rejoué sous `--deny-net`, avec mocks explicites
en mémoire : concurrence, réveils répétés, réponse invalide, perte réseau, perte de
sauvegarde, consentement expiré, source modifiée et autorité révoquée. Les réponses
simulées ne sont jamais enregistrées comme résultats du fournisseur.
