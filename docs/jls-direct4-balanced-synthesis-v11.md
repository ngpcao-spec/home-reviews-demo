# Synthèse expérimentale à quatre catégories — V1.1

Version explicite : `jls-direct4-balanced-synthesis-v1.1`.
Opt-in de `prepareDirectReport` (quatrième argument), également disponible dans
le script existant `prepare-jev-direct-report.ts`. Aucun appelant de production
ni protocole figé ne choisit cette version par défaut. Les anciennes préparations,
requêtes, rapports, autorisations et validations restent compatibles et immuables.

## Changements

- Même JEV direct à quatre catégories, choix natifs, probabilités et compteurs.
  Aucune nouvelle classification, traduction ou correction manuelle.
- Même vérification Luna, questions, seuil de confiance et contrôle de suffisance.
  Le sélecteur équilibré existant peut conserver deux associations distinctes d'un
  même avis (catégorie ou polarité), avec son plafond habituel de deux. Une citation
  identique dans deux avis reste dédupliquée. L'option est désactivée par défaut.
- Sol reçoit les distributions d'étoiles du corpus entier et du sous-ensemble
  analysé, les compteurs serveur par catégorie et les limites de couverture.
  Ses consignes demandent une synthèse proportionnée, y compris quand le corpus
  est très positif, sans forcer un point négatif ou une action pour chaque catégorie.
- Un signal concret isolé peut justifier une vérification proposée. Ni le nombre
  de citations ni les critiques d'une catégorie n'établissent la récurrence d'un
  incident précis. Aucun nouveau compteur sémantique d'incidents n'est inventé.
- Les originaux figés accompagnent les citations analysées, avec SHA256 et
  provenance, uniquement pour les avis des preuves admises dans le dossier Sol.
  Ils apportent du contexte et ne créent pas un verdict Luna supplémentaire.
  Une ambiguïté de traduction appelle une formulation prudente ou une omission.
- Les listes répétées de review_id sont retirées du seul paquet Sol : tous les
  nombres et dénominateurs restent exacts ; listes, textes et empreintes restent
  dans les archives. Le SHA256 des statistiques complètes reste la référence.
- Prompt, configuration de synthèse, sélection, originaux et requête sont versionnés
  et hachés. Le schéma JSON de sortie et les validations de preuves restent inchangés.
  Les limites de 32 requêtes Luna, un Sol et zéro retry restent inchangées.

## Diagnostic gratuit sur les résultats sauvegardés

Archives utilisées : Chill Thái `58b602b2-c2d4-4338-aae3-cd65a3ba8103` (avec sa
préparation `bace8577-e302-42fe-8625-ff9951c1c788` et son dataset de 80 avis) ;
80s Bistro `16f110ba-78ad-4eab-8568-33d476dd4641` (68 contenus).

Associations négatives : candidates / sélectionnées / acceptées Luna / référencées
dans le rapport sauvegardé, toutes rubriques confondues :

| Corpus | Catégorie | Candidates | Sélectionnées | Acceptées | Référencées |
|---|---|---:|---:|---:|---:|
| Chill Thái | Service | 5 | 3 | 3 | 2 |
| Chill Thái | Prix | 1 | 1 | 1 | 1 |
| Chill Thái | Qualité | 9 | 6 | 4 | 2 |
| Chill Thái | Ambiance | 2 | 2 | 2 | 2 |
| 80s Bistro | Service | 4 | 2 | 2 | 2 |
| 80s Bistro | Prix | 2 | 2 | 2 | 2 |
| 80s Bistro | Qualité | 6 | 4 | 3 | 1 |
| 80s Bistro | Ambiance | 2 | 0 | 0 | 0 |

Les deux autres preuves Qualité Chill étaient incertaines ; une preuve Qualité
Bistro était rejetée. Ces verdicts ne sont pas modifiés. Le sélecteur historique
écartait une citation déjà retenue même pour une autre catégorie : les pertes
existent donc avant Luna, mais aussi lors de la vérification et de la rédaction.
Référencer un avis ne prouve pas que chaque plainte de cet avis a été restituée.
Ce diagnostic ne décide pas quelles plaintes sont sémantiquement importantes.

Sur les mêmes données, la nouvelle préparation propose 32 questions regroupées
en 20 requêtes pour Chill et 21 pour Bistro. Les sélections négatives par catégorie
deviennent respectivement 4/1/6/2 et 4/2/5/1 (Service/Prix/Qualité/Ambiance).
Ce sont des candidats non vérifiés, pas de nouveaux verdicts Luna.

## Vérification reproductible sans fournisseur

`scripts/check-direct4-synthesis-offline.ts` lit un export privé avec pour chaque
corpus `input`, `binding` éventuel, préparation historique, résultats Luna natifs
et rapport sauvegardé. Exécuter avec Deno `--deny-net --allow-read --allow-write`.
Le script conserve les empreintes d'entrée, rejoue les verdicts historiques
uniquement contre leurs anciennes questions, trace les pertes par association,
prépare la V1.1, puis teste l'enveloppe Sol et la validation/sauvegarde avec des
mocks explicitement identifiés. Les réponses réelles ne sont jamais réaffectées
à une nouvelle question. Aucun avis client complet n'est committé dans le dépôt.

Sous hypothèse technique de toutes les preuves acceptées, les enveloppes complètes
avec originaux sont mesurées à 21 781 tokens avec marge pour Chill et 18 028 pour
Bistro, sous le budget inchangé de 32 768 ; aucune estimation monétaire.
Ces valeurs ne sont pas des tokens facturés ni une mesure de qualité de Sol.

Les tests vérifient les consignes, compteurs, sources, regroupement, déduplication,
exclusions, certificats de tokens et validation. Ils ne prouvent pas une amélioration
sémantique réelle du fournisseur. L'audit qualitatif reste réservé au chat d'analyse.

## Livraison et activation

Le code est livré dans le worker expérimental existant `process-jls-restaurant`.
Déployer le bundle n'active pas l'option : aucun protocole courant n'est changé,
aucune autorisation ni tâche n'est créée. Une future préparation explicite doit
figer ses nouvelles empreintes et faire l'objet d'un GO distinct avant dépense.
Ni l'interface ni le pipeline commercial ne sont modifiés.

Références de conception : [contexte et consignes OpenAI](https://developers.openai.com/api/docs/guides/prompt-engineering),
[déploiement des Edge Functions](https://supabase.com/docs/guides/functions/deploy).
