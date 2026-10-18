# Frontières de classification après l’audit Chill Thái

Version expérimentale : `jev-audit-boundaries-v2.2`.
Configuration JEV : `v12_economy_audit_boundaries_v2_1pass_v1`.
Questions : `themes_v12_audit_boundaries_v2`.
Contrat futur : `jls-recommendation-contract-v2.2-audit-boundaries`.

Cette livraison ne lance aucune analyse et ne revalide pas rétroactivement le rapport.
La configuration V12 historique, V11/V13, les caches, les verdicts Luna,
les statistiques et les rapports enregistrés restent immuables.
Les protocoles historiques continuent d’utiliser leurs versions figées.

## Changements ciblés

- Portions : quantité de nourriture servie, distincte de l’ouverture d’une marmite
  et du choix des clients de commander trop de plats. Un jugement explicite et
  séparé sur la portion reste admissible.
- Respect de la commande : une demande de réduction du piment et un résultat
  explicitement rapporté comme inchangé peuvent former un signal négatif.
  L’hypothèse de préparation anticipée n’est pas un fait établi.
- Communication : critique explicite d’une information commerciale présentée
  aux clients, notamment une promotion du déjeuner pendant le dîner. Une simple
  mention neutre ou hypothétique ne suffit pas.
- Facturation : demande de clarification des frais de stationnement après une
  expérience décrite, sans établir le montant, une surfacturation, une illégalité
  ou la responsabilité du restaurant. Les questions sans expérience explicite
  restent à examiner.
- Coordination : remplacer la consigne héritée autorisant « good service » seul.
  Exiger un contenu relatif à l’organisation. Les questions JEV attentiveness et
  professionalism sont conservées exactement, sans leur appliquer les critères
  plus restrictifs de certains filtres de preuves.
- Boissons : conserver la distinction entre qualité et délai de service.

## Étapes et versionnement

`jev-audit-boundaries-v22.ts` fournit les 25 questions complètes, les quatre choix,
un passage, les mêmes seuils numériques et une nouvelle identité de cache.
Un cache de `v12_economy_1pass_v1` ne devient pas un résultat de cette variante.
La nouvelle configuration est enregistrée séparément dans le registre existant,
avec paid_enabled=false et production_enabled=false.

`jls-audit-boundaries-v22.ts` fournit des diagnostics prudents et des candidats
exactement rattachés au texte et à son SHA256. Les propositions déterministes
supplémentaires ne sont pas des prédictions JEV et ne changent aucun comptage.
Les preuves explicitement contestées restent exclues. Toute nouvelle citation,
question ou configuration exige une nouvelle vérification Luna autorisée.

`jls-recommendation-contract-v22.ts` ajoute trois focus limités :
order_customization, commercial_communication, parking_fee_clarification.
Il conserve les contrôles de citation/contexte, SHA256, décision ACCEPTED,
thème/polarité, observations, fréquences et comparaison globale, ainsi que les
frontières réservation/attente des boissons de V2.1. Prompt, schéma et
configuration ont de nouvelles empreintes. Aucun worker payant n’est activé.

La lecture authentifiée `jls-restaurant?establishment_id=…&view=classification_boundaries`
expose le manifeste et les consignes futures aux rôles owner/admin/manager.
Elle ne crée ni plan, ni consentement, ni tâche, ni appel fournisseur.
Une future exécution demandera une préparation et un GO nouveaux.

## Vérifications et limites

Les cinq textes historiques et leurs SHA256 sont conservés dans le fixture de
régression. Ce fixture ne contient aucune nouvelle annotation de référence.
Les tests « rule regression » testent exclusivement les règles ; les tests
« simulated response plumbing » utilisent des réponses artificielles pour
vérifier le contrat et ses protections. Ils ne démontrent pas la qualité future
de JEV ou Luna et ne constituent pas une nouvelle validation indépendante.

Les diagnostics déterministes ne comprennent pas toutes les paraphrases,
l’ironie ou les implications. Les cas ambigus restent candidats, jamais promus
en preuves acceptées pour remplir une sélection. Les frais de stationnement et
la cause supposée du piment restent notamment non établis.

Aucun nouvel appel JEV, Luna, Sol, OpenAI ou Apify ; aucun consentement ni run
payant ; aucun recalcul silencieux des fréquences ou nouvelle génération.
