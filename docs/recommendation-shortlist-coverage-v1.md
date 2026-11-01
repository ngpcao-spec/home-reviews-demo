# Présélection déterministe avec alternatives documentées

État : correction locale, sans activation, push, déploiement ni appel fournisseur.
Le moteur partagé passe à `restaurant-recommendation-engine-v6` ; sa politique
de présélection est `recommendation-shortlist-coverage-v1`. La préparation/cache
IA passe à `recommendation-ai-shortlist-coverage-v4`. Le contenu des fiches V3,
le modèle, les instructions, les paramètres et le schéma de réponse restent
identiques (seuls l'ordre et l'énumération des candidats peuvent changer).

## Un seul moteur et un seul filtre d'admissibilité

`shortlistRestaurants` réutilise le même `selectRestaurants` que la recherche
classique. Les contrôles d'organisation, langue, publication durable, cohérence
des scores, fermeture, horaires demandés, géographie, cuisine, budget et exigences
structurées précèdent tout arbitrage. Une préférence ne peut réadmettre un rejet.
Le budget par personne conserve ses contrôles de devise, bornes et unité confirmée.
Les scores et fractions ne sont pas recalculés ou pondérés autrement.

`recommendRestaurants` conserve son classement à trois résultats et son départage
par service. La nouvelle politique concerne uniquement la liste offerte au choix
final IA ; elle n'est pas un second moteur de recherche.

## Politique bornée

- Sans préférence structurée ni texte libre, conserver la présélection actuelle.
- Avec au plus vingt admissibles, les conserver tous dans l'ordre actuel.
- Au-delà, conserver les dix premiers de la présélection actuelle comme noyau.
- Pour les autres places, examiner les admissibles dont le score global exact
  est au moins égal au **minimum des scores des vingt candidats initiaux moins
  0,10**. Utiliser la marge de comparabilité existante, sans nouveau seuil de note.
  Le minimum n'est pas nécessairement le score du dernier candidat ordonné.
- Dans ce vivier, comparer d'abord le nombre d'incompatibilités documentées avec
  les préférences interprétables, puis le nombre de caractéristiques demandées
  confirmées. L'inconnu n'est ni une confirmation ni une incompatibilité.
- Départager ensuite par les scores des rubriques demandées ayant un point fort
  effectivement documenté dans le rapport (bandes exactes de 0,10), puis par les
  bandes de score global. Ce départage ne change aucun score interne.
- Entre candidats ainsi comparables et proches (250 mètres, règle existante),
  préserver la diversité des prix comparables puis les caractéristiques, cuisines,
  spécialités et usages documentés encore non représentés. Les répétitions et
  la longueur des textes ne procurent aucun avantage. Finir par distance et ID.

La moitié réservée aux alternatives est un compromis simple : préserver les
leaders du moteur tout en permettant une personnalisation effective. Il ne s'agit
pas d'un optimum mesuré. Vingt reste un plafond : aucune fiche inexistante,
hors contrainte ou hors droits n'est ajoutée pour compléter un petit résultat.

## Texte libre et incertitude

`shortlist-preferences.ts` produit des **indices facultatifs et incomplets**, pas
une interprétation générale du langage. Les critères structurés restent la seule
source des contraintes obligatoires. Quelques formulations FR/VI/EN non ambiguës
peuvent suggérer une caractéristique, une rubrique ou l'évitement de critiques
de cuisson explicitement répétées dans le rapport. Les négations complexes,
préférences contradictoires et conditions temporelles sont conservées comme
incertitudes ; aucune date, devise, cuisine ou exigence n'est inventée.

Une formulation non interprétée déclenche uniquement une diversification bornée
des alternatives. Elle ne déclenche pas de filtre lexical. Le texte complet,
y compris ses négations, demeure transmis à l'IA pour le choix final. Les indices
locaux ne remplacent pas cette demande dans la requête IA.

Le rapprochement Google/rapport réutilise le traitement des négations et scopes
temporels existant. Un week-end inconnu ne contredit pas le calme en semaine ;
l'absence de plainte ne prouve pas le calme. Une vraie contradiction reste
documentée. Les restrictions de temps non résolues ne deviennent pas des garanties.

La récurrence de cuisson n'est signalée que comme **affirmation attribuée au
rapport**, dans une même clause explicitement qualifiée. Ni nombre de références,
ni étoiles, ni longueur ne permettent de l'inférer. Deux défauts différents,
plusieurs textes décrivant le même incident ou une répétition non établie ne
sont pas des preuves de défaut récurrent. L'absence de signal reconnu reste inconnue,
jamais une garantie d'absence de problème. Ce petit analyseur ne comprend pas
toutes les formulations ; les réserves précises restent dans les fiches IA V3.

## Traçabilité et cache

Le diagnostic interne `Result.shortlist` indique version, effectif admissible,
marge et borne rationnelle, noyau conservé, confirmations, inconnus, alertes,
références de rapport et motif de sélection. Il ne copie pas la demande libre.
Il n'est pas ajouté à l'entrée IA ; seuls les vingt candidats au plus y figurent.
La version de préparation/cache change pour ne pas réutiliser une ancienne
sélection comme résultat de cette politique. Réservations, droits, validation
des références, absence de retry et protections contre doubles appels restent
dans le circuit existant, sans changement.

## Vérification et limites

Tests ciblés : alternative juste sous la frontière et hors marge exacte, noyau,
plafond, absence de remplissage, négations FR/VI, conditions, inconnu, contradictions,
répétition rapportée versus incident unique, contraintes et ordre déterministe.
Les fixtures V1.1 de cent restaurants sont relues sans modifier leurs assertions
ni leurs données. Le rejeu compare les mêmes entrées au commit local précédent,
contrôle l'admissibilité et les scores à l'identique, et prépare les requêtes sans
réseau. Les listes détaillées et textes de comparaison restent dans le bilan local.

La marge peut encore écarter une alternative pertinente mais moins bien notée.
Le noyau peut contenir un leader ayant une réserve pertinente ; elle reste fournie
à l'IA. Une liste limitée ne garantit pas la couverture de chaque préférence.
Ces contrôles prouvent la disponibilité des alternatives, pas la qualité d'un
nouveau choix IA. Aucun gain de coût, de latence ou de qualité finale n'a été mesuré.
