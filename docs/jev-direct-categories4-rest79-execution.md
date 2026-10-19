# Continuation expérimentale JEV direct : 79 avis et pilote réutilisé

Le GO autorise les 79 avis restants du protocole source
`bc00633a-30d8-4a90-8e22-dcc6a0efaeb9`. La préparation exacte reste
`f858bb8f-395d-4aa9-bd10-d7f641934244`, SHA256
`1edf645ff5bcbb5faf731a3f21b9a95e431a4094f4c746057b126ee127650f9d`.

La configuration `jev_categories4_direct_1pass_v1`, ses définitions, ses six choix,
son parseur et ses compteurs ne sont pas modifiés. Le modèle demandé reste
`jev-latest`. Chaque modèle réellement servi est conservé ; aucun appel de sonde.

Le résultat pilote `60df0905-c3f1-4c40-885f-31d2da216147` et sa réponse brute
`27cae165-2c81-47e1-a221-93a16284e9c5` sont vérifiés par SHA256, texte, requête,
configuration et cohérence du parsing. L'avis pilote
`0095a08b-ff64-4b53-90e1-55434b92bcd2` est exclu des 79 nouveaux envois.
La réutilisation d'un résultat terminé ne réutilise pas son ancien consentement.

## Architecture et limites

`process-jev-direct-rest79` est une nouvelle fonction expérimentale isolée.
Elle utilise le jeton serveur existant, l'Auth Admin pour vérifier l'utilisateur
actif, son appartenance owner/admin/manager et les archives immuables avec RLS.
Les anciens workers, rapports, résultats et fonctions de production sont inchangés.

La délégation spécifique enregistre le GO exact et son empreinte, sa durée de
validité, la provenance du code et le manifeste des 79 identifiants/requêtes.
Chaque réveil serveur ne traite qu'un avis. Une réservation INSERT atomique et
unique est consommée avant l'envoi. Un conflit ne restitue jamais une ancienne
réservation. Réveil concurrent, répétition, timeout, HTTP 429/500 ou réponse invalide
ne permettent aucun renvoi du même avis. Aucun fallback, appel Luna, Sol ou Apify.

La réponse brute est sauvegardée avant parsing. Une erreur terminale enregistrée
n'empêche pas de traiter l'avis suivant, mais reste indisponible dans les compteurs.
Une réservation sans résultat confirmé bloque la progression et ne provoque pas
de nouvel envoi. `wake_jev_direct_rest79` utilise pg_net après commit, sans cron ni
déclencheur. Les réservations et résultats sont durables ; une perte de notification
nécessite un suivi explicite de l'état, sans réinitialisation des tentatives.

Dans `public.analysis_jls_snapshot_preparations`, préfixe
`jev_direct_categories4_rest79_` :

- `execution_v1` : délégation traçable, portée de 79 appels maximum.
- `attempt_01` à `attempt_79` : réservations consommées.
- `receipt_01` à `receipt_79` : brut, SHA256, HTTP, durée et erreurs.
- `result_01` à `result_79` : classifications, probabilités, modèle et usage.
- `dataset_v1` : ensemble des 80 avis, provenance par résultat, compteurs et erreurs.

Le parent SQL historique est une clé de stockage uniquement ; aucun ancien run
n'est rouvert. L'ensemble conserve les 100 sources comme dénominateur général,
80 textes analytiques et les 20 avis sans texte uniquement pour les statistiques.

## Comptages et usage

Les compteurs existants dédupliquent chaque avis par catégorie. `mixed` contribue
au positif et au négatif mais ne compte qu'une fois dans l'union distincte.
Neutre, non mentionné, incertain, refus et résultat indisponible restent séparés.
Le total vient des 80 identifiants uniques, jamais de la somme des catégories.

L'usage du pilote et celui des 79 nouveaux avis sont séparés. L'usage manquant
reste explicitement inconnu. Les erreurs, les incertitudes natives et les modèles
servis sont consultables par avis. Aucun audit qualitatif ni référence de vérité.

## Vérifications avant l'exécution réelle

94 tests ciblés ; contrôles Deno, lint et build ; tests SQL annulés par rollback.
Le rejeu complet des sources réelles est effectué sous `--deny-net`, avec transport
simulé et stockage en mémoire : 79 appels mockés et 80 lignes uniques, sans rappeler
le pilote. Les scénarios couvrent concurrence, réveils répétés, perte réseau,
réponse invalide, incertitude native et perte de sauvegarde. Ces mocks ne mesurent
pas la qualité du fournisseur et ne sont pas enregistrés comme prédictions réelles.
