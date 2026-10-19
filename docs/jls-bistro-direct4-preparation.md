# 80s Bistro — préparation sur le rapport historique exact

Extension de portée : `jls-direct4-historical-v1`. Les moteurs existants
`processRestaurant`, `processReadySol`, le sélecteur équilibré et le contrat
direct à quatre catégories sont réutilisés, avec les mêmes réservations,
RLS et reçus durables. Aucune nouvelle file, table d'exécution ou interface.

## Sources

Établissement : `6a53577a-c816-4548-845e-870995fbaed9`.
Run historique : `fa55c8a5-f6e3-43df-a792-e9beed974457`.
Rapport publié : `1b3d0cc8-f276-4d1d-af34-4814aba924af`.
Génération : `e87c742c-8702-4972-b86c-881f967daf5a`.
Terminé le 19 octobre 2026 à 20:16:25, heure du Vietnam ; analyse 7, vietnamien.
Empreinte historique : `929b2c3d97b83317c391e4b0a418771ea1b8d4c2eb4566375a52e7baac2077e7`.

Les 100 avis et la publication complète sont copiés dans le protocole immuable,
avec provenance, données structurées, texte original, texte analytique exact et
SHA256. La normalisation ajoute les empreintes ; elle ne réécrit aucun texte.
Le rapport de référence et les données vivantes ne sont pas mis à jour.

68 contenus sont non vides ; 32 avis sont réservés aux statistiques générales.
67 textes analytiques sont anglais (5 originaux et 62 traductions historiques).
Le dernier contenu est uniquement `🥰🥰` ; il conserve `fallback_original`, sa
langue déclarée historique et ses deux emojis, sans traduction ni reclassement
préalable. Il reste inclus dans les 68 requêtes et peut produire une abstention
native. Rien n'est présenté comme une traduction anglaise de cet avis.

## Configuration et parcours

Configuration inchangée : `jev_categories4_direct_1pass_v1`, SHA256
`e5995c6e4b3a8f5949cbcde2531180ad3af503e50ee38b1b7674fceed561fe69`.
Quatre questions : Service, Prix, Qualité des plats, Ambiance.
Six choix : positive, negative, mixed, neutral, not_mentioned, uncertain.
Le parseur à tolérance d'arrondi existant conserve les valeurs natives.
Aucun passage par les 25 thèmes ; leurs anciens résultats restent uniquement
dans la copie du rapport historique de comparaison, hors des payloads IA.

Étapes : JEV → préparation gratuite des preuves → Luna groupée par avis →
préparation gratuite de Sol → reçu Sol persistant → validation et sauvegarde.
Les compilations gratuites passent par `compileHistoricalDirect4Evidence` et
`compileHistoricalDirect4Sol`, puis les RPC existants/versionnés de liaison.
Elles ne se déroulent pas dans le chemin critique de l'envoi Sol.

La nouvelle portée conserve les mêmes règles et le même schéma de rédaction.
Seules les consignes de dénominateur et la note méthodologique utilisent 68/100
et 32 sans texte ; les valeurs 80/100 et 20 de Chill restent identiques par défaut.
La requête finale figée et son certificat de tokens utilisent le raccordement
`jls-direct4-token-wire-v1`, avant et après la réponse fournisseur.

Plafonds : 68 nouvelles requêtes JEV (4 questions chacune), au plus 32 requêtes
Luna regroupées par avis, un appel Sol sous condition de suffisance, zéro Apify.
Aucun cache direct4 compatible disponible à la préparation. Les anciens caches
à 25 thèmes ne sont ni recyclés ni convertis. Aucun retry ni appel modèle sonde.
Un résultat ou une facturation incertains arrêtent le parcours sans renvoi.
Les réponses complètes, probabilités, modèles, tokens, durées, preuves et motifs
restent dans les artefacts de la file existante.

## Qualification gratuite

`prepare-historical-direct4.ts` s'exécute avec `--deny-net` sur l'export privé
réel et injecte uniquement des réponses synthétiques explicites. Il vérifie
68 requêtes JEV, jusqu'à 32 Luna, l'acceptation conditionnelle, la taille complète
de Sol, l'envoi simulé, le reçu, la validation et la sauvegarde.
Les quatre probes Edge authentifiées vérifient la même version déployée ; elles
quittent la route avant toute lecture d'une clé fournisseur. Les fixtures et
résultats portent `explicit_technical_mock`, jamais des prédictions réelles.
Les tests SQL s'exécutent dans une transaction annulée : plafonds, zéro cache
25 thèmes muté, refus d'absence de GO, finalisation reçue idempotente et RLS.

Aucun consentement, run, tâche payante ou lancement n'est enregistré à cette
étape. Aucun réglage de qualité n'est ajusté sur les réponses futures. Les
limites de sens des IA et l'audit comparatif restent dans le chat d'analyse.
