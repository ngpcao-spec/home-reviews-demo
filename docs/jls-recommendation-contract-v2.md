# Xóm Mới Garden — contrat de recommandations V2

## Portée

Correction gratuite sur le run `4ba0bf81-0ee0-496f-806f-7259fa19e496`,
opération `df4780f7-3e7d-48a6-84eb-231cd627171b`, protocole
`6be7ae90-93f2-4a3a-abdd-8766f5a02ada`.
Aucun appel fournisseur, consentement, run payant ou régénération.
Le run historique reste `needs_review`, avec sa seule tentative Sol.
Les textes originaux, citations, verdicts Luna et statistiques restent immuables.

## Versions et contrats

- Format futur : `jls-prioritized-recommendations-v2`.
- Configuration : `jls-recommendation-contract-v2`.
- Validateur : `jls-observation-action-statistics-validation-v2`.
- Sélecteur autonome : `jls-autonomous-order-evidence-v2`.
- Archive : `jls-recommendation-review-v2`.

Les instructions et le schéma V1 restent inchangés. La logique commune de
rattachement est extraite sans changer leur résultat : le replay V1 doit avoir
exactement l'empreinte du résultat historique enregistré.

V2 ajoute un focus `food_temperature`, lié uniquement à `temperature`.
`food_preparation` reste lié à `cooking`.
Une preuve explicite de température de service, négative et ACCEPTED, est
nécessaire. Les négations, boissons, température ambiante, formulations
hypothétiques et plats volontairement servis froids restent prudemment exclus.
Les règles sont déterministes et limitées, sans garantie sémantique générale.

Les clés de `priority.frequency_keys` doivent toujours correspondre à un
thème/polarité d'observation associée. Le nouveau `comparison_context` contient
des clés globales et l'empreinte exacte des statistiques figées. Le serveur
rattache leurs comptages à `statistics.themes` ; ils ne sont ni des citations
acceptées ni la fréquence d'un incident précis. Ils ne remplacent jamais une
preuve d'action ou une fréquence de soutien manquante.

## Sélection de preuves

Le sélecteur V1.1 n'est pas modifié. Le nouveau sélecteur privilégie un extrait
autonome décrivant l'élément manquant ou erroné, plutôt qu'une phrase générale.
Le nouvel extrait est exact, conserve son contexte et reçoit une nouvelle
identité, ses SHA256 et sa provenance. Son ancien statut V3 n'est pas transféré.
Aucun verdict Luna n'est créé ou emprunté.

Sur le dossier courant, aucune autre citation de commande ACCEPTED et exactement
compatible ne suffit. Nouvelle candidate :

> they only brought out one drink instead of the two ordered

Cette candidate reste `requires_luna`, avec `luna_verdict=null`. La formulation
« didn’t bring ice on the second » est écartée au profit de l'extrait autonome,
car « the second » dépend du contexte.

## Trois résultats distincts

1. **Correction du logiciel** : nouveau prompt, schéma, focus température,
   contrat statistique et sélection future.
2. **Revalidation du contenu original inchangé** : les trois motifs restent
   identiques, sans changement de statut ou réécriture de la réponse Sol.
3. **Version structurée dérivée explicite** : tous les textes, citations,
   contextes, thèmes/polarités et identifiants de preuves sont conservés.
   Un manifeste JSON documente uniquement :
   - le passage au format V2 ;
   - le changement du focus température ;
   - la séparation des fréquences directes et comparatives.
   Ce document n'est pas une nouvelle réponse Sol.

Replay réel, sans permission réseau fournisseur :

| Recommandation | Original inchangé | Version structurée dérivée |
| --- | --- | --- |
| Température des plats | PRECISE_ACTION_REQUIRES_REVIEW | Contrôles techniques passés |
| Exactitude des commandes | PRECISE_ACTION_REQUIRES_REVIEW | Toujours bloquée |
| Prix et comparaisons | UNRELIABLE_OR_UNRELATED_FREQUENCY | Contrôles techniques passés |

Deux propositions passent les contrôles techniques dans la version dérivée ;
aucune n'est présentée comme validée humainement ou sémantiquement garantie.

## Persistance et affichage

`analysis_jls_recommendation_reviews` conserve une archive indépendante,
immuable, idempotente par run/version. La fonction serveur
`save_jls_recommendation_review` contrôle l'organisation, les sources et leurs
empreintes, l'identité du run/opération, l'intégrité de l'original et le maintien
des textes de la version dérivée. Une nouvelle candidate ne peut pas porter
un faux statut ACCEPTED ou un verdict Luna.

RLS owner/admin/manager de la même organisation ; écritures serveur uniquement.
Aucune tâche, autorisation ou fonction de lancement n'est ajoutée.

Le GET existant lit l'archive et vérifie ses empreintes. Il ne reconstruit pas le
dossier et ne tokenise pas. Les étapes durables, la réception brute avant
validation, la réservation atomique et le compteur de tentative restent inchangés.

Dans Plus / Thêm → Test Jev → Rapport hybride JEV + Luna + Sol → Xóm Mới Garden :
l'original reste affiché, puis un bloc V2 distingue le replay et la version
structurée dérivée. Les changements, preuves et nouvelles candidates sont
consultables. Les comparaisons globales sont séparées des fréquences de soutien.

## Contrôles

- Suite complète locale : 1 810 tests passés ; trois régressions supplémentaires
  ont ensuite porté les tests ciblés V2 à 27, tous passés.
- CI sur le commit `e81e35ef3bb7fbcf195a78665f2863502052c6d7` :
  **1 813 tests passés dans 170 fichiers**, lint, build et publication Pages
  réussis ([exécution 38835059959](https://github.com/ngpcao-spec/home-reviews-demo/actions/runs/38835059959)).
- SQL/RLS dans une transaction annulée : immutabilité, idempotence, refus des
  textes dérivés modifiés, refus du verdict Luna hérité, isolement des tenants,
  source et nombre de tentatives inchangés.
- Deno : 7 tests sans permission réseau et vérification des modules serveur.
- Mobile : 24 cas FR/VI sur 360/390/430 et iPad 768, rechargement, source originale
  et dérivée séparées, aucun POST ni débordement.
- Lint et build.
- Un premier lancement concurrent des suites a saturé le poste : la suite
  complète a été relancée avec deux workers et le test de démarrage navigateur
  a été rejoué seul. Aucun délai ni assertion n'a été assoupli.

## Livraison et contrôle sur le serveur déployé

- Code : `e81e35ef3bb7fbcf195a78665f2863502052c6d7`.
- Migration serveur : `20261016012621_jls_recommendation_reviews_v2`.
- Fonction `jls-restaurant` : version 5, active.
- Fonction `process-jls-restaurant` : version 8, active.
- GitHub Pages : publication réussie, sans déclenchement fournisseur.
- Archive immuable : `cf693741-5e08-4e4f-b3e1-2a8cc4dcbd9b`.
- SHA256 de l'archive :
  `0f67396ed6155e6aa95016fdd314f8cb9467eda0c58a0b3176d4885766ec96c5`.

Le code de provenance de l'archive reste celui du commit ci-dessus, même si la
documentation ou le nom local de la migration sont alignés après livraison.
La requête future V2 est préparée gratuitement et archivée ; elle ne constitue
ni un protocole d'exécution autorisé, ni une nouvelle génération. Les modules
V2 ne déverrouillent pas le worker payant historique.

Une sonde technique explicite du worker Edge déployé a parcouru réservation,
envoi simulé, réception, validation et sauvegarde. Elle n'est pas un run de
rapport : `e4f59990-f54b-4c3b-829c-78546822c544`. Elle a terminé avec
**zéro appel fournisseur**, un seul envoi simulé et aucune tokenisation nouvelle.

| Étape Edge | CPU natif | Durée totale | Mémoire au signal Shutdown |
| --- | ---: | ---: | ---: |
| Envoi/réception simulés | 226 ms | 9 757 ms | 27 946 263 octets |
| Validation/sauvegarde | 338 ms | 2 514 ms | 28 320 527 octets |

Mesures natives `Shutdown`, raison `EarlyDrop`, Edge Runtime 1.77.0 / Deno 2.1.4,
région Singapour. Marge CPU minimale observée : 1 662 ms sur 2 000 ms.
Ce sont des mesures sur cette sonde et ce dossier, pas une garantie universelle
pour toute réponse future. Les mémoires heap + external échantillonnées dans
les phases étaient respectivement 37 145 821 et 48 420 335 octets.

Contrôle final en base : run historique inchangé, statut `needs_review`, une
seule tentative Sol historique ; empreintes de résultat et de réception
inchangées. Les 78 analyses JEV et 28 réponses Luna sources restent exactement
compatibles. Aucun run actif pour ce protocole. Les cinq empreintes de contrôle
des données et rapports Artisan sont inchangées.

## Étapes futures non lancées

Pour ajouter une recommandation précise sur les commandes, il faut vérifier la
nouvelle citation par Luna dans un protocole distinct, sans réutiliser son ancien
verdict. Ensuite seulement : figer le dossier accepté, la requête V2, ses mesures
et ses empreintes, préparer un nouveau protocole borné et obtenir un GO distinct
pour un éventuel appel Sol. Aucun résultat JEV compatible ne doit être recalculé.

Une version dérivée structurée n'est pas une nouvelle génération Sol et ne
remplace jamais le rapport historique. Aucun lancement commercial ni estimation
monétaire dans cette livraison.

