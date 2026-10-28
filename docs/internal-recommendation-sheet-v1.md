# Fiche interne de recommandation V1

Historique de la formule −2. La version active suivante, −4, est documentée dans [internal-recommendation-sheet-v2.md](internal-recommendation-sheet-v2.md). Les fonctions V1 restent disponibles pour l'audit, sans être utilisées par le nouveau déclencheur de publication.

Cette PR prépare le calcul et la projection privée d'un rapport durable. Elle
ne déploie rien, ne crée aucune génération et ne raccorde pas HOME AI.

## Formule figée

Pour `quality` (plats), `service` et `ambiance`, séparément :

```text
B = somme des notes numériques valides de la rubrique / leur effectif
P = nombre de classements JEV exclusivement positive
N = nombre de classements JEV exclusivement negative
T = nombre total d'avis du corpus du rapport, avec ou sans texte, de 0 à 150
score = max(0, min(6, B + (P - 2*N)/T))
global = (qualité + service + ambiance)/3, uniquement si les trois sont connus
```

Les mixtes ne sont ni P ni N. Neutres, non-mentionnés et abstentions natives
n'ajoutent aucun positif ou négatif ; leurs effectifs restent visibles. Une
réponse manquante ou un décompte incohérent rend la rubrique inconnue. Aucune
pondération de longueur, gravité, intensité, étoile ou catégorie de prix.
Une note de rubrique absente ne reçoit jamais la note générale.

Exemples : `5+150/150=6`, `4,80+(60-2*15)/150=5` ; sans appréciation, B ne change
pas. Sans B ou avec T=0, la rubrique est inconnue. Aucune moyenne partielle des
rubriques n'est présentée comme un global comparable.

Le calcul PostgreSQL utilise `numeric`, sans `round`. Les sommes, effectifs et
fractions exactes (numérateur/dénominateur de chaque score et du global) sont
conservés. L'arrondi appartient uniquement à la présentation. Ce score 0–6
est distinct des étoiles Google et des notes du rapport ; il ne les modifie pas.

## Sources et cohérence

| Composante | Source durable | Vérification |
| --- | --- | --- |
| B | `current_report_publications.source_bindings[].review_detailed_rating` | Alias FR/VI/EN de `customer-ratings.ts`, valeurs 1–5, une valeur non conflictuelle par avis/rubrique |
| B, ancien format seulement | `document.source_report.customer_rating_statistics` | Total du même rapport ; moyenne/effectif explicitement présents ; aucune lecture des avis courants |
| P/N | `document.statistics.counts.categories.*.exclusive` | Tous les textes analysés, pas les 32 associations ; ensembles d'IDs positifs/négatifs contrôlés, intersection = mixtes |
| T, période | `scope`, `source_bindings`, `document.statistics.scope` | Même source/organisation/établissement, mêmes IDs uniques et même effectif |
| Rapport | `report_id`, `source_run_id`, `generated_at`, `document.derived_report` | Rapport terminé et contrôlé ; empreinte des statistiques vérifiée |
| Points forts/réserves | `positive_aspects` / `negative_aspects` du rapport | Copie de ces seules sections déjà disponibles avec leurs références ; aucun résumé nouveau |

Si les notes détaillées sont disponibles, leurs sommes sont recalculées. Leur
comparaison aux moyennes historiques accepte uniquement l'écart numérique de
validation de `1e-12` dû aux anciens flottants ; ce n'est ni un arrondi de score
ni un seuil de sentiment. Une incohérence est signalée, jamais corrigée en
remplaçant les données. Le JSON `issues` explique les rubriques inconnues.

Le calcul ne lit aucune table JEV temporaire, aucun résultat Sol choisi parmi
32 preuves, ni les avis courants. Il continue à fonctionner après leur retrait.
La source durable a déjà été validée lors de sa publication : cela ne transforme
pas les classifications automatiques en vérités humaines.

## Métadonnées existantes, sans collecte

L'identité vient de `establishments`. Les coordonnées, catégories et indications
de prix proviennent de la dernière observation Apify/Outscraper déjà conservée
dans `review_provider_payloads`, reliée au même établissement et à ses IDs
Google. Les IDs fournis ne doivent pas se contredire. Seuls les champs descriptifs
nécessaires sont copiés ; aucun texte d'avis, auteur ou réponse fournisseur.

La date d'observation et, si présente, la date fournisseur sont conservées.
Ces informations décrivent la fiche Google observée à cette date, distincte
de la date du rapport. Elles ne sont pas utilisées dans les scores.

Les catégories Google sont dédupliquées. Les champs cuisine explicites et les
catégories exactes FR/VI/EN reconnues (italien, vietnamien, fruits de mer, pizza,
européen) sont normalisés. Les autres libellés sont conservés ; « restaurant »
seul ne démontre aucune cuisine. Coordonnées invalides et cuisine absente
restent inconnues. Cette normalisation limitée ne cherche pas à classifier
toutes les cuisines possibles ni à lire les commentaires.

Le budget distingue deux objets :

- `establishment_price` : `price`, `priceLevel`, `priceRange` explicitement
  fournis par Google, avec source et date. Aucun calcul depuis les sentiments
  sur le rapport qualité/prix, aucune inférence depuis les étoiles.
- `customer_spend_per_person` : distributions des montants/libellés renseignés
  dans le contexte **figé** des avis, sans moyenne artificielle ni conversion
  de devise. Une paire de libellés localisés n'ajoute pas deux témoignages.

Les publications existantes ne stockaient pas ce contexte. Elles portent
`frozen_context_incomplete` plutôt qu'un budget reconstruit avec les avis actuels.
Pour les prochaines publications, le sérialiseur conserve uniquement le champ
de dépense par personne (alias FR/VI/EN) dans les liens sources. Il ne conserve
pas tout le contexte et ne change ni les statistiques ni le document publié.

## Stockage, actualisation et accès

`restaurant_recommendation_sheets` contient au maximum une projection par
établissement et langue de publication, comme la publication durable. Les
colonnes `quality_score`, `service_score`, `ambiance_score`, `global_score` sont
générées depuis le calcul `internal-recommendation-v1`, jamais écrites séparément.

Le trigger de publication construit la fiche dans la transaction de publication
réussie. Un remplacement réussi remplace la fiche ; un échec de génération
ne touche pas la dernière fiche. Si le corpus change, l'actualisation existante
de la publication propage `stale`/`stale_reason`, en conservant scores et date du
rapport. Une mise à jour d'horodatage de maintenance seule ne recalcule rien.
La suppression de la publication supprime sa projection, sans archive.

La migration prépare la reprise initiale depuis toutes les publications durables.
Une publication incomplète produit une fiche avec scores inconnus et motifs.
Sans rapport publié, aucun score n'est fabricable ; l'audit signale `no_report`
et la fiche sera créée à la première publication réussie.

RLS est activé. Seuls owner/admin/manager de l'organisation peuvent lire leurs
fiches, comme leurs rapports. Aucun droit anonyme, aucune écriture client, aucun
nouveau catalogue public. Les fonctions de calcul/écriture restent privées,
leurs droits EXECUTE sont révoqués aux rôles clients et service. Le seul trigger
avec privilèges élevés est dans `private`, non appelable par ces rôles.

## Rejeu initial et confidentialité

Audit SELECT du 27/10/2026 à 15:20:34 UTC. Huit établissements, sept publications
durables : sept calculs complets possibles, un établissement sans rapport.
Les notes ont été recomputées depuis les 150 liens sources de chaque publication
et rapprochées de ses agrégats. Six publications étaient déjà « À actualiser ».

Le dépôt étant public, aucune identité, référence privée ou score réel de
restaurant n'est ajouté à cette PR. Le tableau nominatif, la période exacte,
les bases/effectifs et scores sont dans le bilan local de la tâche
`output/internal-recommendation-sheet-20261027/bilan.html`.

| Fiche anonymisée | T | Trois bases et classements cohérents | Calcul possible | Actualisation de la source |
| --- | ---: | --- | --- | --- |
| A | 150 | Oui | Oui | À actualiser |
| B | 150 | Oui | Oui | À actualiser |
| C | 150 | Oui | Oui | À actualiser |
| D | 150 | Oui | Oui | À actualiser |
| E | 150 | Oui | Oui | À actualiser |
| F | 150 | Oui | Oui | À actualiser |
| G | 150 | Oui | Oui | Source non marquée obsolète |
| H | — | Rapport absent | Non | Aucune publication |

Le niveau de prix Google n'était renseigné pour aucun des huit établissements.
Des coordonnées étaient disponibles pour les huit ; les cuisines restent
inconnues lorsqu'aucun type culinaire explicite n'est disponible.

Pour reproduire hors réseau, fournir le SELECT sauvegardé au script local :

```powershell
node --experimental-strip-types scripts/audit-recommendation-sheets.ts <saved-input.json> <result.json>
npm test -- --maxWorkers=2
npm run lint
npm run build
```

Le script ne contient ni client serveur ni repli réseau, et interdit `fetch`.
Les tests exécutent le vrai SQL en PostgreSQL embarqué, les autorisations avec
les rôles réels et le sérialiseur de publication existant. Les données de test
sont synthétiques ; le rejeu local des publications mesure la calculabilité,
pas la qualité générale de futures recommandations.

## Livraison et limites

Migration unique préparée :
`20261027152036_restaurant_recommendation_sheets_v1.sql`.
Pas de fonction Edge à déployer pour cette projection SQL. Son installation
ultérieure ne doit appliquer aucune autre migration locale ni lancer de rapport.
La PR n'est pas une autorisation de déploiement de cette étape.

Ni JEV, ni sélecteur, ni Sol, ni leurs modèles/prompts, ni langues, ni statistiques
ou règle des 150 avis ne changent. Aucune génération automatique à l'import.
Une fiche calculable peut être ancienne ou fondée sur peu de notes : effectifs,
date, période et obsolescence doivent accompagner toute utilisation future.
