# Fiche interne de recommandation V2 · négatif −4

Version de calcul : `internal-recommendation-v2`. Pour qualité des plats, service et ambiance :

```text
B = somme des notes de rubrique réellement fournies / leur effectif
P = avis exclusivement positifs pour la rubrique
N = avis exclusivement négatifs pour la rubrique
T = tous les avis du corpus figé du rapport, y compris sans texte
score = clamp(B + (P - 4*N)/T, 0, 6)
global = moyenne des trois scores, uniquement si les trois sont connus
```

Une contribution par avis et rubrique. Mixte, neutre, non mentionné : zéro.
Les ensembles d'identifiants et effectifs exclusifs sont vérifiés sur tous les
textes classés, sans dépendre des preuves sélectionnées pour Sol. Aucune
pondération de longueur, d'intensité, d'étoiles ou de budget. B absent ou T=0
reste inconnu ; aucune note globale Google ne remplace une note de rubrique.

Les `numeric` PostgreSQL restent non arrondis, avec les numérateurs et
dénominateurs exacts de chaque score et du global. Seul le bilan de présentation
arrondit à trois décimales. Exemple : B=4,8, P=60, N=15, T=150 donne 4,8 en V2
contre 5 en V1. Quatre positifs compensent exactement un négatif. Sans négatif,
les deux versions coïncident.

## Sources et versionnement

La V2 reprend le validateur, les normalisations et les contrôles de cohérence
V1 sans les modifier. `recommendation_score_v2` et
`recommendation_calculation_v2` portent le nouveau coefficient ; les fonctions
V1 restent intactes pour permettre la comparaison. Le JSON indique la version
et les poids +1/−4. Une contrainte lie sa version à `calculation_version`.

Les entrées restent `current_report_publications.scope`, `source_bindings` et
`document.statistics`. Les notes détaillées figées ou, pour l'ancien format,
l'agrégat de notes du même rapport fournissent B. Le calcul ne lit ni les avis
actuels, ni les tables temporaires JEV, ni les seules associations Sol.

La migration `20261028121845_recommendation_negative_weight_4.sql` verrouille
brièvement les publications puis les fiches, dans l'ordre des écritures de
publication. Elle refuse une fiche rattachée à un autre rapport/corpus.
Elle ne met à jour que version, calcul et horodatages de calcul : références,
corpus, métadonnées, budgets, sections et statuts « À actualiser » sont conservés.
Les publications et leurs notes visibles ne sont pas écrites. Aucun rapport ni
aucune fiche sans rapport n'est créé.

`capture_recommendation_sheet_v2` et `write_recommendation_sheet_v2` prennent
ensuite en charge les nouvelles publications. Leur mécanisme de métadonnées et
de dépense par personne reste identique. Les mises à jour d'obsolescence ne
recalculent pas les scores. Une publication réussie remplace la fiche ; un
échec de génération ne la remplace pas. Le défaut de version devient V2 et
les écritures futures renseignent également explicitement cette version.

## Vérifications et bilan privé

Les tests exécutent la migration en PostgreSQL embarqué : absence de négatifs,
compensation 4 pour 1, bornes, mixtes, textes absents, catégories manquantes,
global et fractions, doublons/corpus incohérents, recalcul sur la publication
propre malgré des avis actuels différents, préservation des statuts/références,
futures publications, échec et droits par organisation. La suite V1 est conservée.

```powershell
node --experimental-strip-types scripts/audit-recommendation-weight-v2.ts <snapshot-prive.json> <dossier-prive>
```

Ce script n'a aucun client serveur et interdit le réseau. Il rejoue la vraie
migration sur les publications sauvegardées, sans charger d'avis actuels.
Un deuxième calcul en fractions `BigInt` vérifie indépendamment les équations
V1 et V2, par rubrique et pour le global. Les résultats conservent les nombres
SQL sous forme de chaînes pour ne pas perdre leur précision dans JSON.

Le bilan HTML, CSV et JSON nominatif est conservé exclusivement hors du dépôt
public. Les fiches « À actualiser » restent fondées sur leur rapport daté ;
ce recalcul de pondération ne constitue pas une nouvelle analyse du corpus.

## Livraison

Appliquer uniquement cette migration après les contrôles du dépôt. Aucune
fonction Edge ni interface n'a besoin d'être déployée pour ce changement SQL.
Les accès et modèles, JEV, le sélecteur, Sol, les langues, les 150 avis et les
statistiques du rapport restent inchangés. Aucun appel fournisseur, collecte,
traduction, génération ou raccordement HOME AI.

Un éventuel retour V1 doit rétablir dans une transaction le défaut V1 et son
déclencheur, puis recalculer les seules fiches depuis leurs propres publications
avec `recommendation_calculation_v1`. Conserver les deux familles de fonctions
et les protections de version ; ne modifier aucun rapport pour revenir en arrière.
