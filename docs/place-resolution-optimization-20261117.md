# Recherche de fiche sans collecte d'avis — 17 novembre 2026

## Diagnostic observé

Recherche Green Home, 15 novembre à 17:30 Vietnam :
diagnostic 0f546de4-4db6-416e-aa16-d9ad77eca20d,
run Apify existant qxtkUtgTv5dNXYhph.
Résolution du lien : 423 ms ; attente du run : 76 575 ms ;
handler : 79 576 ms ; requête Edge : 85 935 ms.
La recherche demandait un avis au reviews-scraper uniquement pour obtenir
les métadonnées du restaurant. L'import confirmé était un autre traitement.

## Changement limité à resolve-establishment

- compass/crawler-google-places : un startUrls, langue du compte,
  maxCrawledPlacesPerSearch=1, maxReviews=0, maxImages=0,
  scrapePlaceDetailPage=false.
- Plafond propre à la recherche : maxTotalChargeUsd=0.5 (corrigé le 18 novembre ;
  0.1 était inférieur au minimum admis par l'actor).
- Une seule tentative POST par recherche ; aucune relance ni repli payant
  automatique si le POST, le run ou le dataset échoue.
- Le dataset doit contenir une seule fiche avec nom et identifiant.
  Aucun avis n'est extrait, enregistré ou analysé par cette recherche.
- Expansion du lien court avant le cache existant. Identité exacte seulement :
  paramètres Place ID ou identifiant encodé dans le chemin Google.
  Le cache partagé reste soumis à l'interrupteur serveur et à la liste
  de Place ID autorisés. Pas de rapprochement sur un nom, pas de cache
  global nouveau, pas de nouvelle visibilité sur les données des organisations.
- Auth, organisation, limite de requêtes et contrôle des doublons conservés.
  Confirmation, import initial de 150 avis, synchronisations, menus et rapports
  inchangés. Les autres fonctions serveur ne doivent pas être redéployées.

## Contrat fournisseur consulté le 17 novembre

https://apify.com/compass/crawler-google-places/input-schema
documente explicitement les paramètres ci-dessus : zéro avis et zéro image
supplémentaire ; les détails supplémentaires sont facultatifs et ralentissent
la recherche.
https://apify.com/compass/crawler-google-places/pricing
annonce 0,0015 à 0,004 USD par fiche suivant le forfait, et 0,00005 USD
par démarrage, hors options. Ce n'est pas un coût mesuré pour cette modification.
Le reviews-scraper historique accepte au minimum un avis ; lui envoyer zéro
n'est pas une substitution valable.

## Validation

Tests hors réseau : contrat HTTP FR/VI, URL courte iOS/ftid avec CID entier
exact, établissement sans avis, dataset vide/invalide/multiple, erreurs
401/402/429/503, réponse de lancement perdue, suivi du même run,
cache autorisé après expansion, cache désactivé, restaurant hors pilote,
doublon dans l'organisation et appels serveur non autorisés.
Le handler et le service réels sont exécutés avec transports fournisseur,
Auth et base simulés. Les tests existants de l'assistant d'ajout et du worker
d'import sont réexécutés. Aucun appel fournisseur réel pour ces tests.

Résultats ciblés : 56 tests réussis dans 5 fichiers ; lint du projet,
build client et `deno check` de resolve-establishment réussis.
Les 17 fichiers du bundle de production v27 ont été comparés au commit
de départ : correspondance confirmée. Seuls les quatre fichiers de code
de cette correction changent dans le bundle déployé.

Le gain en secondes n'est pas encore mesuré : le démarrage d'un actor
Apify reste nécessaire pour une fiche absente du cache autorisé.
Comparer les diagnostics de la prochaine recherche normale aux mesures
ci-dessus ; ne pas déclencher une collecte supplémentaire pour le contrôle.

### Incident du 18 novembre à 19:02 Vietnam

Deux requêtes, diagnostics 9cdc5f50-45fb-4230-b897-e38fce44de46 et
5078cafb-7c0a-4bb8-9e7d-ca0b756e3dd5, échouent à run_start :
APIFY_HTTP_400, respectivement après 3 138 et 1 063 ms. Le lien court
a été résolu ; aucune identité de run n'a été reçue.

La lecture publique de la configuration Apify constate
minimalMaxTotalChargeUsd=0.5, tarification effective depuis le 30 juin 2026.
Le plafond 0.1 introduit dans v28 est donc invalide. Le corps des deux
réponses 400 n'ayant pas été conservé, ce constat s'appuie sur les
paramètres déployés et les contraintes fournisseur, sans prétendre
avoir récupéré le message détaillé de ces réponses.

Correction : plafond 0.5, toujours une seule fiche, zéro avis et zéro image
supplémentaire, sans repli ni relance automatique. Le plafond n'est pas
une facture minimale. Aucune nouvelle extraction pour diagnostiquer.
La fixture apify-place-contract-20261118.json provient des endpoints
publics actor/build (build 0.14.793) ; elle conserve le minimum financier
et le schéma des paramètres utilisés. Le test reproduit le rejet de 0.1
et vérifie la requête réelle corrigée contre ce contrat en FR et VI.

## Déploiement et retour arrière

Déployer uniquement resolve-establishment avec ses dépendances, en conservant
verify_jwt=true et l'authentification interne. Aucune migration ni changement
de secret ou de client nécessaire.

Retour arrière : redéployer uniquement cette fonction à partir du commit
13470ef9031b3e7f350e623e83b30e0f08f4fada (code de production v27 avant
ce changement), avec ses dépendances et verify_jwt=true.
Ne relancer aucun run dont l'issue est inconnue. Aucune donnée n'a besoin
d'être restaurée : ce changement n'ajoute aucune écriture de métier.
