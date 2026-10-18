# Réanalyse Chill Thái — 80 textes, configuration corrigée figée

Protocole : `bc00633a-30d8-4a90-8e22-dcc6a0efaeb9`.
Table : `public.analysis_jls_snapshot_preparations`.
Kind : `jev_chill_reanalysis80_protocol_v1`.
Version : `jev-chill-reanalysis80-boundaries-v1`.
SHA256 : `2570b86b982ee2aed4d074d02777a2204543a89c75f056cb2601110abf5cfe1f`.

## Sources et compatibilité

Même snapshot historique `39556285-21ee-4962-9892-da3b4f0e8ca3` :
100 avis distincts, 80 textes anglais figés, 20 avis sans texte réservés aux
statistiques générales. Aucun nouveau prélèvement, import, texte ou traduction.

Configuration : `v12_economy_audit_boundaries_v2_1pass_v1`.
Code des classifications : `13cff76ef38fedaf964ca96515710e72a8b874d2`.
Configuration SHA256 : `292384806354e610ab60588f803516e99ae5a0db6b7a47fd2cd1f7832a9305da`.
Instructions SHA256 : `d1bf606df9a53c0b8ad2afcec223e68b081310f1305e552ed9656f40ff7646d1`.
Seuils SHA256 : `e0c177cb371f523caeaad6add147b94cb318c7ec08df8961f864cb487a549de6`.
Aucun ajustement après lecture des réponses.

Les neuf résultats de `b9d96984-fe68-42ad-b1fe-d552473d2f16` sont réutilisables.
Vérifications : organisation, établissement, textes anglais/originaux, langue,
provenance de traduction, questions, alias d'origine, SHA256 des requêtes et des
réponses brutes, configuration, instructions, seuils, 25 distributions natives,
décisions après seuils, usage et modèle servi `jev-1.13.0`.

Le modèle demandé reste `jev-latest`, conformément à la configuration.
Le futur modèle servi doit rester `jev-1.13.0` pour permettre l'assemblage strict.
Un changement sera constaté depuis la réponse ordinaire : sauvegarde et arrêt,
sans vérification préalable facturable, nouvelle tentative ni mélange silencieux.

Les 80 anciens caches `v12_economy_1pass_v1` sont une comparaison historique
uniquement. Aucun n'est réutilisé comme résultat de la configuration corrigée.
Si l'un des neuf résultats devient incompatible, le lancement est bloqué ;
le plafond de 71 ne devient jamais automatiquement 72 ou 80.

## Exécution future séparée

71 requêtes JEV au maximum, une par avis restant, chacune avec les 25 thèmes.
Client `maxAttempts=1`, traitement séquentiel, aucune API de secours, aucune
sonde du modèle, aucun retry. Les réservations atomiques, écritures serveur,
contrôles d'organisation et workers existants sont réutilisés. Chaque réservation
consommée reste consommée en cas de timeout, interruption ou réponse perdue.

Un GO spécifique ultérieur sera requis avant `authorize_jev_chill80` et la création
d'une unique ligne `jev_chill80_execution_v1`. `wake_jev_chill80` ne peut pas
lancer un protocole de préparation. Le mode serveur explicite `jev_chill80`
ne figure dans aucun scan automatique ni chemin GET.

Cette préparation ne crée **aucun consentement, run, tâche ou appel fournisseur**.
Luna 0, Sol 0, Apify 0, rapport HOME Reviews 0. Aucune estimation de coût.

## Archive pour le chat d'analyse

L'archive future `jev_chill80_dataset_v1`, dans la même table immuable avec RLS,
contiendra les 80 analyses et la provenance exacte (réemploi du benchmark ou
nouvelle tentative), les choix natifs/probabilités et les décisions après seuils
séparément. Les réponses complètes, modèles, tokens, durées et erreurs des
nouvelles tentatives seront dans `jev_chill80_receipt_01` … `_71` et
`jev_chill80_result_01` … `_71`.

Comptages distincts pour les choix natifs et les décisions après seuils : avis
positifs, négatifs, mixtes, absents, listes d'identifiants, avis mentionnant le
thème et nombre de mentions de polarité. Un avis mixte peut produire deux
mentions mais reste un seul avis. Les 20 avis sans texte ne reçoivent aucun thème.
Le dénominateur global 100 reste distinct du dénominateur textuel 80.

Les 2 000 cellules de comparaison avec les anciennes analyses seront conservées,
sans écraser leurs fréquences. Les consommations antérieures des neuf résultats
réutilisés restent séparées des nouvelles consommations. Une exécution incomplète
reste lisible comme telle ; elle ne produit pas un ensemble complet fictif.
L'audit qualitatif appartient au chat d'analyse, sans score automatique de justesse.

## Contrôles gratuits

Tests synthétiques de compatibilité, refus du modèle modifié, séparation des
choix natifs et seuils, comptages distincts, avis sans texte, consentement absent,
expiré ou hors périmètre, concurrence, interruption, erreurs et absence de retry.
Parcours intégral sur les sources réelles avec transport explicitement simulé,
réseau Deno interdit, assemblage et sauvegarde simulée des 80 résultats et des
2 000 différences. Aucune sortie simulée n'est enregistrée comme analyse réelle.
Les durées locales observées ne garantissent pas les limites CPU du worker Edge.

## Texte GO pour une seule exécution future

```text
GO — J’autorise Codex à exécuter une seule fois la réanalyse complète de Chill Thái selon le protocole bc00633a-30d8-4a90-8e22-dcc6a0efaeb9.

Conserver le snapshot historique de 100 avis : 80 avec texte et 20 sans texte.
Réutiliser les 9 résultats JEV strictement compatibles du benchmark b9d96984-fe68-42ad-b1fe-d552473d2f16.

Maximum 71 nouveaux appels JEV, un passage par avis avec les 25 thèmes, configuration v12_economy_audit_boundaries_v2_1pass_v1.
Aucun retry, fallback ou appel supplémentaire de vérification du modèle. Ne jamais renvoyer une requête dont l’issue est incertaine. Bloquer en cas d’incompatibilité ou de changement du modèle servi.

Aucun appel Luna, Sol ou Apify. Aucune génération de rapport.
Conserver tous les résultats et rapports historiques inchangés.
Archiver les 80 résultats, leur provenance, les comptages, les différences historiques et l’usage pour notre audit dans le chat d’analyse.
```
