# Prix Google Maps pour les fiches internes

Correction préparée dans le code, sans collecte, appel IA ni régénération.
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

## Collecte éventuelle, non exécutée

Si les prix d'établissement sont indispensables, préparer une collecte distincte
des seules fiches déjà identifiées, sans avis supplémentaires. L'acteur de fiches
[`compass/crawler-google-places`](https://apify.com/compass/crawler-google-places)
documente `price` ; son
[schéma](https://apify.com/compass/crawler-google-places/input-schema) permet
`maxReviews=0` et `scrapePlaceDetailPage`. Une proposition exacte doit utiliser les
URLs/IDs existants, une fiche par URL, la langue choisie, aucun enrichissement de
contacts/photos/IA. Cette possibilité ne garantit pas que Google retourne les prix.
Présenter le périmètre et obtenir l'autorisation avant tout nouveau run. Aucun
raccordement ou changement d'acteur n'est effectué par cette correction.
