# Foursea : classification directe Luna / JEV

Expérience `luna-direct4-classification-comparison-v1`, distincte des rapports.
Source immuable : `analysis_jls_snapshot_preparations`,
`f5027435-6278-4e85-8972-143be6965fcd`, SHA
`451f01183c4e5bde02d0061b4af79903648039649d8e2a20ce0bb10215909d3c`.

Les 87 avis disposent de résultats JEV effectivement sauvegardés (36
réutilisés et 51 nouveaux). Les quatre anciennes issues inconnues et les
neuf avis sans texte ne sont pas dans ce test. Aucun nouvel appel JEV.

Le protocole `f7eb5b73-ba21-46ac-bd84-be6e0aa4231e`, SHA
`d418d616a202c8373d38344552c8c218bdd9032d4c22b1c0a12090428ee64116`,
fige les textes, SHA, références JEV et requêtes avant les réponses Luna.
Configuration : `luna_categories4_direct_1pass_v1`.

## Requête aveugle

Une requête `POST /v1/decisions`, modèle `gpt-6-luna`, par avis. Les quatre
questions indépendantes ont les noms service, price, quality, ambiance et
les six choix positive, negative, mixed, neutral, not_mentioned, uncertain.
Instructions et descriptions sont copiées exactement depuis
`jev_categories4_direct_1pass_v1` (SHA
`e5995c6e4b3a8f5949cbcde2531180ad3af503e50ee38b1b7674fceed561fe69`).
Seul le format de transport change : `criteria` devient une liste de
`choices`. Le texte anglais analysé est conservé octet pour octet.

Le champ input contient seulement analysis_text et review_alias. Notes,
résultats JEV, preuves Luna précédentes, texte original et identifiants
d'établissement ne sont pas envoyés. Les originaux restent dans l'archive
du comparatif. Les avis sont des données non fiables, pas des instructions.

## Exécution existante réutilisée

Le worker `process-jls-restaurant`, son port, les tables de protocoles,
runs, tâches, reçus et intentions d'envoi servent aussi cette expérience.
L'adaptateur limité à ce contrat ne peut envoyer que des requêtes Luna.
Les étapes JEV et Sol sont interdites par le protocole et la réservation.
Plafonds : 87 appels, un par avis, zéro JEV/Sol/Apify, zéro retry fournisseur.
Les protections de bail, concurrence, consentement, organisation, hashes
et conservation d'une réponse reçue restent celles du worker existant.

L'admission du protocole compare les 87 sources et les quatre définitions
avec l'archive. Un certificat immuable évite ces reconstructions dans la
transaction de chaque réservation. Un index n'autorise qu'un comparatif
de cette version pour l'archive source. La contrainte des anciens corpus
est conservée intégralement ; la nouvelle branche contrôle cette version.
La migration ne revalide pas les anciennes lignes sous le rôle DDL, qui
ne peut appeler leurs contrôleurs réservés au serveur. Les contrôles de
la contrainte continuent de s'appliquer aux nouvelles écritures.

## Résultats et comparaison

Le parseur conserve choix natifs, confiance, distributions et refus sans
seuil ni renormalisation. Une incertitude reste uncertain. Un refus ou une
réponse manquante n'est pas not_mentioned. Les réponses brutes, usage,
modèle servi, durée et erreurs restent dans les reçus immuables.

La comparaison produit 348 lignes, quatre par avis, et tous les désaccords
avec les textes sources et SHA. Les compteurs exclusifs présentent les
six choix ; mixed contribue aussi une fois à chaque polarité et une seule
fois aux avis distincts de la catégorie. Les catégories ne sont pas
additionnées pour compter les avis. Les absences/refus restent séparés.

L'accord n'est pas une mesure d'exactitude. JEV n'est pas un Gold humain.
Un désaccord ne désigne pas automatiquement une erreur de l'un des modèles.
L'audit qualitatif appartient au chat d'analyse. Aucun seuil, instruction
ou définition n'est modifié après lecture des résultats.

## Vérifications avant dépense

24 tests ciblés, lint, build et Deno sans réseau : 87 réponses simulées,
348 comparaisons, réveil répété sans nouvel appel, perte de réponse sans
retry. SQL réel : 87 réservations et reçus idempotents, bail exclusif,
plafond, interdiction de Sol, absence de GO refusée et finalisation ;
transaction de test entièrement annulée. Qualification gratuite du
raccordement actif avant toute création du run payant. Les mocks ne sont
pas une évaluation réelle de la qualité des fournisseurs.

La demande utilisateur autorise une seule exécution de ce périmètre. Son
texte exact et la résolution vers ce protocole sont enregistrés séparément,
sans falsifier une confirmation iPhone. Aucun écran ni rapport commercial
n'est modifié ou activé.
