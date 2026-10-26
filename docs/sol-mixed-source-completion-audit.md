# Proposition hors production : compléter aussi une catégorie mixte

Cette livraison est une proposition isolée. Aucun changement dans le registre
des sélecteurs, les fonctions serveur, les migrations ou le réglage actif.
Aucun appel fournisseur et aucun rapport régénéré.

## Cause reproduite

Le dossier Bottega publié le 26 octobre 2026 à 21:42:35 (Vietnam), rapport
`a2a8327e-4d4c-4042-b059-40350261d7d8`, est reproduit à l'identique, y compris
la requête Sol sérialisée et ses 32 associations. L'avis 2 étoiles
`d2838f11-9ae8-4db8-978a-6ea95bde9c1f` conserve service/prix négatifs,
mais perd qualité positive/négative. Les textes original et analysé sont
identiques à ceux de l'expérience précédente.

JEV avait renvoyé « négative » (.51 contre .49 mixte), puis « mixte »
(.51 contre .49 négative), confiance native .41 dans les deux passages.
Les deux réponses sont conservées telles quelles. Le texte oppose notamment
du thon desséché à des ingrédients frais et des pâtes jugées correctes :
le classement mixte ne suffit pas à conclure à une erreur JEV.

Le départage `started` de l'implémentation active favorise seulement un
candidat natif négatif dont une autre catégorie négative du même avis est
déjà sélectionnée. La paire mixte coûte deux places et arrive trop tard.
Au terme de la priorité : 28 associations, 4 places libres dont 3 réservées
aux illustrations positives ; une seule place utilisable. Le diagnostic
intermédiaire est `association_budget_with_positive_illustration_reserve`,
puis `association_budget_32` après complément. Il ne s'agit ni d'une paire
incomplète, ni d'un rejet de langue, ni d'une correction des probabilités.

## Seul changement de comportement proposé

`experiments/evidence-priority/mixed-source-completion-proposal.ts` reprend
l'implémentation active et retire la condition
`e.jev_native.classification === 'negative'` du départage `started`.
Le vivier prioritaire reste constitué des associations négatives des avis
1–4 étoiles. Un candidat mixte y apporte sa paire positive/négative atomique.
Une autre catégorie négative doit déjà être retenue pour bénéficier du
complément de source. L'appartenance au classement de couverture antérieur
reste prioritaire ; les autres départages restent identiques.

Plafond 32, réserve positive, dédoublonnage, contrôles de validité, traitement
des 5 étoiles et choix JEV sont inchangés. La longueur et la confiance ne
reçoivent aucun nouveau poids. Les préférences héritées du classement de
couverture ne constituent pas une mesure d'importance sémantique.

La copie expérimentale évite toute modification de l'implémentation active,
dont le test d'empreinte reste réussi. Sa version n'est pas enregistrée :
elle est explicitement refusée par le registre serveur actuel.

## Comparaison des six dossiers

« Historique » compare la sélection active testée dans les trois expériences
Sol précédentes, et non l'ancien sélecteur antérieur à ces expériences.
Le rejeu retrouve exactement leurs dossiers figés. « Nouveau » compare
les trois générations publiées après activation de la PR 80.

| Dossier | Avis distincts avant → après | Positives / négatives avant → après | Ajoutées / retirées |
| --- | --- | --- | --- |
| K.HOUSE historique | 18 → 18 | 15/17 → 15/17 | 0/0 |
| K.HOUSE nouveau | 18 → 18 | 16/16 → 16/16 | 0/0 |
| Bottega historique | 19 → 16 | 9/23 → 10/22 | 4/4 |
| Bottega nouveau | 21 → 18 | 10/22 → 10/22 | 4/4 |
| OPTIMIST historique | 18 → 18 | 17/15 → 17/15 | 0/0 |
| OPTIMIST nouveau | 18 → 18 | 17/15 → 17/15 | 0/0 |

Chaque dossier conserve 32 associations, les paires complètes et une
illustration positive pour chacune des quatre catégories disponibles.
Les requêtes K.HOUSE/OPTIMIST sont inchangées octet par octet.
Toutes les différences de sélection concernent la qualité chez Bottega.

Les corpus entre générations ne sont pas tous identiques : Bottega partage
149/150 avis ; K.HOUSE et OPTIMIST partagent 150/150 originaux, mais chacun
possède deux textes d'analyse modifiés. Les comparaisons avant/après se font
donc séparément, avec exactement les mêmes entrées dans chaque paire.

## Gains et arbitrages réellement observés

**Bottega nouveau :** récupération de la paire du thon trop cuit/desséché,
et d'une paire exprimant déception alimentaire générale / bonnes boissons.
Service et prix de ces sources restent sélectionnés. Retrait de la paire
« focaccia bonne, petite portion mais qui vaut son prix », de la plainte
« panini meilleur sur la photo que dans l'assiette », et d'un témoignage
positif familial recommandant l'omelette jambon-fromage. Ce dernier n'est
pas exclu parce qu'il a 5 étoiles : il perd sa place dans le complément.

**Bottega historique :** le thon négatif était et reste présent. Ajout des
paires « panini avec beaucoup de pain/peu de garniture » et « déception
alimentaire/bonnes boissons ». Retrait d'un avis 1 étoile qualifiant la pizza
de pire mangée en 68 ans, de la même focaccia, et de la préférence pour
moins de levure dans la pâte.

Le panini historique reste natif mixte, même si son « impression partagée »
n'est pas un éloge explicite de sa qualité : sélectionner la paire ne
valide pas sa moitié positive. Le sélecteur ne corrige pas JEV.

Ces pertes ne sont pas nulles. L'avis pizza exprime un rejet très fort,
mais ne précise pas de défaut de préparation. Les plaintes concrètes
« pizza grasse » et « moins de sauce que sur la photo » restent étayées.
La petite portion reste documentée ailleurs, mais la nuance « petite et
pourtant avantageuse » de cette focaccia disparaît. La préférence sur la
levure est distincte et perdue ; elle reste une réserve personnelle isolée,
sans preuve d'un défaut technique objectif. Le nouveau panini visuellement
décevant perd son témoignage spécifique ; la faiblesse des paninis et le
décalage photo/sauce de la pizza restent représentés, sans être des preuves
interchangeables du même incident.

L'omelette et le détail familial/climatisation perdent leur source positive.
Les éloges explicites de focaccia, cuisson al dente, ingrédients, boissons,
service, prix et ambiance disponibles dans les autres références restent
transmis. Une illustration par rubrique n'est pas une garantie d'équilibre
de la future prose. La concentration sur moins d'avis est le coût mesuré
du complément de sources, et la nouvelle paire de déception générale
apporte moins de précision que celle du thon.

Le bilan consultable contient tous les textes complets originaux/VI des
sources ajoutées ou retirées, leurs probabilités natives, leurs références
avant/après et les références précises de couverture restantes. Les notes
d'audit par identifiant ne sont jamais des entrées du sélecteur.

## Vérification reproductible, exclusivement hors réseau

```powershell
npx vitest run tests/unit/sol-evidence-mixed-completion-proposal.test.ts tests/unit/sol-evidence-source-completion-proposal.test.ts tests/unit/sol-evidence-priority-selector.test.ts tests/unit/report-evidence-selector.test.ts --maxWorkers=2
$env:HOME_REVIEWS_MIXED_REPLAY_ROOT='D:/Codex/GoogleMaps Avis/output/sol-mixed-priority-audit-20261026'
npx vitest run --config vitest.mixed-selector-replay.config.ts --maxWorkers=1
npm run lint
npm run build
```

Le rejeu privé est volontairement séparé des tests CI ordinaires. Il échoue
sans les fichiers sauvegardés ; aucun téléchargement ou fournisseur de
secours. Il valide les reçus avec les parseurs de production, les projections,
empreintes, associations ordonnées et requêtes avant/après figées dans
`tests/fixtures/sol-mixed-replay-manifest.json`. Les tests ciblés utilisent
des données synthétiques ; ils vérifient l'algorithme, pas la qualité JEV/Sol.

## Recommandation et limite de preuve

Retenir cette correction comme proposition minimale à valider : elle corrige
l'asymétrie négatif/mixte sans inventer un score de gravité ou une exception.
Sur les six dossiers, aucune autre plainte précise de gravité comparable à
la cuisson desséchée n'a été identifiée parmi les retraits ; la préférence
sur la levure et plusieurs nuances sont néanmoins réellement perdues.
Ce jugement de lecture ne constitue ni une couverture totale ni une règle
automatique applicable à tous les restaurants.

Le rejeu prouve ce qui serait transmis à Sol, avec les bonnes références et
les paires intactes. Il ne prouve pas que Sol reprendra le thon, conservera
les nuances ou formulera des recommandations proportionnées. Aucune
intégration, activation ou validation par un nouveau rapport n'est incluse.
