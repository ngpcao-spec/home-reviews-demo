# Prix Google Maps pour les fiches internes

Conservation des prix et collecte de fiche séparée de l'import des avis.
Le moteur reste une interface interne non raccordée à HOME AI. Aucun changement
des scores V2, des notes, du corpus, des langues ou du contenu des rapports.

## Audit des sources, sans run fournisseur

L'acteur appelé par `apify.ts` est `compass~google-maps-reviews-scraper`.
L'entrée conserve URL exacte, langue du compte, `reviewsOrigin=google`,
`reviewsSort=newest`, `maxReviews=150`, `personalData=true` ; aucune nouvelle
option ou seconde collecte n'est ajoutée. Aucun build n'est épinglé et le numéro
exact des builds historiques n'est pas enregistré : non vérifiable depuis nos
seules données. Ne pas assimiler son schéma actuel à celui d'un ancien build.

Le [schéma officiel actuel](https://apify.com/compass/google-maps-reviews-scraper/input-schema)
ne propose pas d'option de prix. La
[sortie documentée](https://apify.com/compass/google-maps-reviews-scraper)
contient `price`, nullable, et `reviewContext` pour le contexte client.

Les réponses déjà stockées ont été inventoriées par clés, types, valeurs et
établissement. Aucun nom, identifiant privé ou texte réel n'entre dans ce dépôt.
Le bilan nominatif et les observations datées restent dans le dossier privé de
la tâche. Un `price=null` dans les bruts prouve l'absence dans la réponse reçue,
pas l'absence de prix sur l'interface Google. Les dépenses structurées de clients
ne démontrent pas un tarif de l'établissement.

## Conservation et alimentation des fiches

Deux pertes futures ont été repérées : le `rawPlacePayload` normalisé omettait
les prix, puis `retention_sanitize_snapshot` remplaçait tout ce payload par `{}`.
Les bruts individuels conservaient déjà les champs : ils ne sont pas réécrits.

- Le normaliseur conserve maintenant `price`, `priceLevel`, `priceRange`.
- Sous la politique active, le snapshot conserve seulement ces trois champs,
  `cid`, `placeId`, `scrapedAt`. Aucun auteur, avis, traduction, réponse ou blob
  arbitraire n'est réintroduit dans les snapshots.
- Le résolveur vérifie organisation et identité Google ; un identifiant qui
  contredit l'autre invalide l'observation. Il lit les snapshots ou bruts stockés,
  jamais un fournisseur. Il privilégie le dernier prix réellement renseigné,
  avec **sa propre date** ; un null ultérieur ne rajeunit pas l'ancien prix.
- Les chemins de champs, table/ID source, date d'observation et date fournisseur
  sont conservés. Les causes d'absence distinguent absence d'observation appariée,
  champ absent et champ nul/vide. Pas d'alias fournisseur inventé.
- Les dépenses clients sont agrégées uniquement depuis les `source_bindings` de
  la publication durable propre à la fiche. Un ID d'avis ne compte qu'une fois ;
  des alias contradictoires sont signalés et exclus. Les libellés restent intacts,
  avec effectifs, chemins et période des témoignages. La date `observed_at` est
  explicitement le `as_of` du corpus figé, pas une date fournisseur prétendue.
- Les futures publications conservent également le nom du champ Google original
  dans leur contexte de dépense. Les publications anciennes ne sont pas modifiées
  pour fabriquer cette provenance manquante.
- La migration remplace **uniquement `metadata.budget`** des fiches existantes,
  sans recalcul des scores, changement de référence, statut ou autre métadonnée.
  Une discordance fiche/publication annule la transaction. Les sources historiques
  et les états « À actualiser » sont conservés.
- Le writer V2 prépare le même budget aux futures publications. Un trigger privé
  après snapshot rafraîchit le seul budget d'une fiche déjà existante en utilisant
  sa propre publication. Il n'y a pas de trigger coûteux pour chaque avis, ni de
  génération automatique. Un rechargement manuel conserve ses protections et ses
  bruts, sans appel supplémentaire ni publication implicite.

La migration `20261028133850_google_maps_price_provenance.sql` utilise une
transaction et des verrous NOWAIT dans l'ordre publication → fiche. Les fonctions
restent privées et non exécutables par les rôles client/service. Aucun grant,
politique RLS ou endpoint n'est ajouté. La conservation des transitions et les
protections de tentatives inconnues ne changent pas.

## Normalisation et moteur

Le module pur `google-maps-prices.ts` traite les champs structurés, jamais la
prose, les sentiments, les notes, le nom ou la cuisine.

- Niveaux Google : entier explicite 0–4, énumération reconnue, symbole répété.
  Un champ `price` numérique sans unité ne devient pas un niveau de prix.
- Fourchettes : devise explicite, unités réellement présentes, bornes conservées.
  Le symbole `$` seul ne devient pas USD ; aucun taux de change.
- Formats VI reçus : `100-200 N ₫`, `900 N ₫ - 1 Tr ₫`, `1-100.000 ₫`,
  `Trên 1.000.000 ₫`, avec espaces insécables. `N` vaut mille et `Tr` un million
  uniquement dans ce contexte monétaire VND. Les labels sont gardés en parallèle.
- Une borne ouverte reste ouverte. Un montant/devises ambigus reste non normalisé.
- Les fourchettes clients normalisées sont retournées avec
  `guaranteed_tariff=false` et ne passent jamais le filtre de budget établissement.
- Le moteur utilise seulement niveaux et fourchettes d'établissement Google
  fermées/comparables. Sans prix vérifiable, il conserve l'état inconnu et refuse
  de prétendre satisfaire un budget explicite. Pas d'activation du moteur.

## Vérification et livraison

```powershell
npm test -- --run tests/unit/google-maps-prices.test.ts tests/unit/google-maps-price-storage.test.ts supabase/functions/_shared/apify.test.ts tests/unit/restaurant-recommendation-engine.test.ts
node --experimental-strip-types scripts/audit-google-maps-prices.ts <snapshot-prive.json> <calculs-exacts.json> <dossier-prive-hors-repo>
npm run lint
npm run build
```

Le rejeu exécute la vraie migration en PostgreSQL local et compare les empreintes
des scores, références, statuts, métadonnées hors budget et publications avant/après.
Tous les formats reçus sont confrontés au parseur. Les tests couvrent import,
snapshot minimal, ancienne observation connue, contradiction d'identité, données
manquantes, doublons/alias, dépenses figées, nouvelles publications, refresh après
snapshot et filtres du moteur. Aucun réseau n'est autorisé par le rejeu.

Installation à préparer séparément : cette seule migration et les deux workers
du parcours courant, `process-initial-import-jobs` et `process-review-sync-jobs`.
Les autres consommateurs existants du module partagé sont `add-establishment`,
`resolve-establishment`, `fetch-google-reviews`, `backfill-historical-reviews` et
`sync-establishment-reviews` ; leur inclusion dans le paquet dépend du maintien
de ces anciens parcours. Ne pas appliquer d'autres migrations locales ni appeler
les workers pour vérifier un déploiement. Les données existantes ne peuvent pas être
inventées : le bilan peut rester à zéro prix établissement après correction.

## Collecte de fiche — livraison V1

L'acteur de fiches
[`compass/crawler-google-places`](https://apify.com/compass/crawler-google-places)
documente `price` ; son
[schéma](https://apify.com/compass/crawler-google-places/input-schema) permet
`maxReviews=0` et `scrapePlaceDetailPage`. Le worker séparé
`process-google-place-price-jobs` utilise le build testé `0.14.777`, une URL Google
déjà identifiée, une fiche au maximum, la langue persistée, zéro avis/image et
aucun enrichissement contacts/leads/IA. L'acteur de collecte des 150 avis, son
entrée, les traductions et leur disponibilité ne changent pas.

La migration `20261028151639_google_place_price_jobs.sql` crée une file privée,
initialement désactivée. Un trigger de fin d'import initial peut y inscrire
l'établissement ; une erreur est isolée et ne remet pas l'import en échec. Le
rechargement manuel et les synchronisations ne créent pas de tentative de prix.
Les recherches et publications de rapport lisent seulement les prix sauvegardés.

Une contrainte unique par établissement empêche tout double envoi. Une réservation
durable précède l'unique POST ; une interruption sans identifiant de run devient
`unknown`, jamais un nouveau POST. Un run connu peut être relu avec GET. Un prix
absent termine en `not_provided`, distinct de `failed` et `identity_mismatch`.
Il n'existe aucun retry de collecte, même lorsque le fournisseur renvoie une
erreur HTTP. Une réponse ambiguë exige une décision humaine. La concurrence est
bornée à une collecte de prix et partage les slots fournisseur existants.

Avant la réservation, un GET des métadonnées de l'acteur vérifie son identité et
le minimum publié de `maxTotalChargeUsd`. Le plafond est fixé à 0,50 USD,
minimum annoncé par cet acteur ; il ne représente ni un tarif ni le coût prévu
d'une fiche. Un minimum absent ou supérieur bloque avant tout POST. Le reçu
conserve cette vérification et les consommations réellement retournées. Un
échec après réservation garde son résultat inconnu et son diagnostic interne,
sans nouveau départ. Une ancienne tentative inconnue n'est pas réarmée lors
d'une correction de configuration.

Le réveil serveur immédiat et les continuations bornées traitent la file,
application fermée. Le cron est un secours de **livraison de cette file** : il
ne peut créer aucune demande ni recommencer une collecte terminée. Aucun
rafraîchissement périodique de prix n'est programmé.

Chaque réponse doit correspondre au CID, au Place ID lorsqu'il est connu et à
la langue figée. Une fiche unique et `reviews: []` sont exigés. Les dates viennent
de `scrapedAt`, jamais de la date de rattachement. Seuls prix, normalisation,
identifiants et reçus techniques sont conservés, pas les publications clients,
photos ou autres contenus de la fiche. Le libellé demeure disponible même s'il
est ambigu. Devise et bornes ne sont normalisées que par le parseur strict.
L'unité par personne exige un libellé explicite ou une observation Google Maps
déjà vérifiée, réutilisée avec sa preuve ; elle n'est pas supposée à partir d'une
simple fourchette. Ni un null ni un échec ne remplacent un ancien prix connu ni
sa date réelle. La fourchette reste indicative, jamais un tarif garanti.

Le budget des fiches est actualisé seul, sans recalcul, modification de statut
ou référence de rapport. Les futures publications utilisent le même résolveur,
avec les dépenses individuelles figées de leur propre corpus. Le moteur peut
filtrer et diversifier sur les prix Google comparables sauvegardés, sans réseau.
Les libellés inconnus sont `Prix non renseigné` / `Chưa có thông tin giá`.

### Installation et retour arrière

Après contrôles et fusion, appliquer **seulement** les deux migrations de prix
de cette PR, dans l'ordre. Déployer les workers `process-initial-import-jobs`,
`process-review-sync-jobs` (conservation des champs) et
`process-google-place-price-jobs` (nouveau worker à authentification scheduler).
L'installation n'inscrit ni ne réveille les établissements existants.

```sql
-- Activation après contrôle du déploiement, futures fins d'import seulement :
update private.google_place_price_config set enabled=true where singleton;
-- Reprise initiale autorisée : un appel service-only par établissement sans prix,
-- en réutilisant d'abord toute observation payée validée par reuse_google_place_price.
-- Ne jamais remettre attempts à zéro, ni vider les reçus pour réessayer.
-- Arrêt des prochains envois (conserver le code et les données des tentatives) :
update private.google_place_price_config set enabled=false where singleton;
```

Les données et le bilan par établissement demeurent privés, hors dépôt. Les
tests réseau simulé, PostgreSQL embarqué et le rejeu du moteur ne sont pas une
preuve de la couverture du fournisseur. Les résultats réels sont consignés
séparément lors de la reprise autorisée.
