# Moteur interne de recommandation V1

Préparation de code uniquement. Aucun endpoint, catalogue public, déploiement,
HOME AI, nouvelle collecte, traduction, appel IA ou génération. Aucun changement
des fiches, scores, rapports, JEV, sélecteur, Sol, langues ou corpus des 150 avis.

## Interface interne

`readRestaurantRecommendations(context, organizationId, request)` est destiné à
un futur appelant serveur ayant obtenu `context` via `requireUser`. Il utilise
uniquement `context.client`, jamais `admin` ni une clé service. L’appartenance
owner/admin/manager est vérifiée, puis les politiques RLS existantes restreignent
les deux tables. La langue est celle du profil ; aucune modification ni repli
silencieux vers une autre langue. Aucun droit ou politique n’est ajouté.

La fiche et sa publication durable sont jointes dans un SELECT ; version,
références, organisation, langue, date, empreinte et sections doivent concorder.
Les pages sont lues par 200, dans un ordre stable. Un échec de lecture échoue
explicitement. Le JSON des calculs est lu avec `calculation::text` pour préserver
les numérateurs/dénominateurs PostgreSQL, sans conversion en flottants JS.
Les établissements actifs autorisés sans fiche dans la langue du compte sont
également signalés comme exclus, sans fabriquer de score.

`recommendRestaurants(rows, organization, language, request)` est la fonction
pure testable. Son catalogue doit provenir du lecteur autorisé. La fonction pure
n’est pas une frontière d’authentification et ne doit pas être exposée directement
à des données ou identifiants de tenant fournis par un client public.

```ts
const request = {
  origin: {latitude: 12, longitude: 109}, // HOME AI le fournira ultérieurement
  area: {kind: 'radius', metres: 3000},
  // Tous les champs suivants sont facultatifs :
  cuisines: ['italian'],
  budget: {kind: 'price_level', allowed: [1, 2]},
  preferences: {categories: ['quality'], features: ['quiet']},
};
```

Un rectangle `{kind:'bounds',south,north,west,east}` accepte aussi le passage de
l’antiméridien. Le moteur n’a pas de géocodeur : une zone textuelle doit être
résolue en coordonnées par le futur appelant. Position/zone absentes sont
signalées ; aucun formulaire de critères facultatifs n’est exigé. La distance
Haversine (rayon moyen terrestre 6 371 008,8 m) est à vol d’oiseau, sans temps de
trajet ou promesse d’accessibilité.

## Admissibilité et classement

Par défaut et sans repli, seules les fiches non marquées obsolètes, de version
`internal-recommendation-v2`, complètes, avec trois scores et global cohérents,
coordonnées et publication durable valide sont admissibles. Un âge en jours
n’est pas une nouvelle date d’expiration arbitraire : date et statut de corpus
accompagnent le résultat. Une fiche ancienne/partielle est exclue avec son motif,
jamais régénérée ou remise à jour. Les autres tenants/langues ne sont ni exposés
ni comptés dans les exclusions. Une fiche dupliquée est refusée.

1. Appliquer strictement zone, cuisine et budget s’ils sont explicités.
   Les cuisines viennent des champs Google explicites et de catégories exactes
   FR/VI/EN reconnues (italien, vietnamien, fruits de mer, pizza, européen,
   grillades, steak). « Restaurant », le nom commercial et les avis ne permettent
   pas d’inventer une cuisine. Les libellés non reconnus restent non confirmés.
2. Classer par le global V2 exact, jamais par les étoiles Google.
3. **Seuil proposé : 0,10 point sur 6.** Trier par score exact, puis construire
   des groupes dont chaque membre est à au plus 0,10 du meilleur membre. Les
   groupes sont ancrés, sans comparateur de quasi-égalité non transitif : 5,10 /
   5,04 / 4,98 ne forment pas un unique groupe. Ce seuil est un choix de politique
   simple, pas une incertitude statistique mesurée ; il est versionné dans le code.
4. Dans un groupe : couverture des caractéristiques souhaitées explicitement
   documentées, puis moyenne des rubriques préférées ayant une illustration
   positive dans le rapport (aucune si aucune préférence), puis proximité.
   Cette moyenne utilise les scores V2 existants, sans les modifier ; ses groupes
   de comparabilité suivent également le seuil 0,10. Toutes les réserves restent
   jointes, y compris les avis mixtes déjà résumés dans le rapport.
5. À score/préférences comparables et dans les **250 m** du plus proche candidat
   restant de ce groupe, diversifier les budgets Google connus après le premier
   choix, sans préférer par principe un prix connu à un prix inconnu. C’est une
   marge de localisation documentée, pas une estimation de trajet. Les égalités
   finales utilisent l’identifiant stable ; aucun arrondi de score.
   Deux fourchettes qui se recouvrent ou deux devises différentes ne démontrent
   pas une diversité de budget ; aucune comparaison monétaire n’est inventée.
6. Retourner au plus trois restaurants. Si moins de candidats conviennent,
   retourner moins de trois, éventuellement zéro, avec les exclusions pertinentes.

Le classement conserve les fractions exactes `BigInt` et leurs chaînes SQL en
sortie. Seul l’affichage privé arrondit. Le moteur ne refait pas la formule de la
fiche et ne lit pas les avis actuels ou seulement les 32 associations Sol.

## Informations du rapport et préférences

Les raisons et réserves recopient les seuls passages existants, avec `report_id`,
section, index, catégorie et `evidence_ids`. Elles ne sont pas une synthèse IA
supplémentaire. Une préférence de rubrique ne devient pas une exigence imposée.

V1 reconnaît un petit lexique littéral FR/VI/EN pour `quiet`, `fast_service`,
`sea_view`, `air_conditioning`, `private_room`. Un signal exige une phrase dans
les points positifs ; une négation ou une réserve contraire le rend non confirmé.
Le statut est `reported`, `conflicted` ou `not_documented`. Les phrases exactes
sont toujours fournies : « mentionné dans le rapport », jamais « garanti ».
Ambiance ≠ calme ; service ≠ rapidité. Les termes non pris en charge sont
signalés et ne favorisent personne. Le lexique est conservateur et incomplet :
pas de compréhension libre des formulations, sarcasmes ou autres langues.

`preferences.features` est facultatif et ne filtre pas les absences ; un critère
explicitement impératif utilise `required_features` et échoue s’il est inconnu
ou contradictoire. Aucun horaire, disponibilité ou régime alimentaire n’est
inféré. Les résultats ne prétendent pas valider les témoignages à l’origine du
rapport. Les sections déjà publiées restent elles-mêmes des analyses automatiques.

## Prix et affinements

Deux objets séparés en sortie : prix de l’établissement Google (`price`,
`price_level`, `price_range`, source/date) et distributions de dépenses clients
du corpus figé. Ni les critiques de rapport qualité/prix, ni les notes n’entrent
dans le budget. Les dépenses clients ne sont pas un tarif garanti.

Un budget de niveau filtre seulement des niveaux Google explicites (0–4,
symboles ou énumérations reconnus). Un budget monétaire filtre seulement une
fourchette d’établissement fermée, avec devise explicite et entièrement comprise
dans la demande. Pas de change, d’estimation, de dollar à devise supposée,
de borne supérieure inventée ou d’interprétation de libellés ambigus. Sans donnée
comparable, exclusion budgétaire ; sans contrainte, le prix inconnu est signalé.
Les prix descriptifs bruts restent disponibles même si non normalisables.

Un affinement est proposé uniquement vers un candidat encore disponible, ayant
passé tous les critères et restant comparable aux scores/préférences : `closer`
si sa distance est réellement plus courte, `lower_price_level` si le niveau est
plus bas, `lower_price_range` si sa fourchette est strictement inférieure dans la
même devise. Les prix exigent aussi une localisation comparable. Pas d’affinement
« plus calme » faute de mesure comparative ; pas de « moins cher » à prix inconnu.

## Vérification et confidentialité

```powershell
npm test -- --run tests/unit/restaurant-recommendation-engine.test.ts tests/unit/restaurant-recommendation-read.test.ts
node --experimental-strip-types scripts/audit-restaurant-recommendation-engine.ts <snapshot-prive.json> <dossier-hors-repo>
npm run lint
npm test
npm run build
```

Les tests synthétiques couvrent proximité/zone, droits, langue, fidélité au rapport,
V2 complète, précision, scores proches, critères, budget inconnu, prix séparés,
diversité, préférences non documentées, négations/contradictions, moins de trois
résultats, pagination et absence de mutation/réseau. Les mocks HTTP testent le
lecteur, pas un parcours connecté réellement déployé. Les tests SQL existants
sur les fiches vérifient toujours leurs politiques RLS et sources figées.

Le rejeu nominatif est conservé exclusivement dans le dossier privé de la tâche,
hors dépôt. Ni identité, ni référence, ni texte réel, ni coordonnées privées ne
sont ajoutés aux fixtures publiques. Ce rejeu prouve les sélections sur ce
snapshot ; il ne prouve pas une meilleure satisfaction ou un seuil optimal.
