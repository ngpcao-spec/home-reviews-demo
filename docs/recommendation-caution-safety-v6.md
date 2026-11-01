# Vigilances sourcées et secours explicite V6

Correction locale, sans déploiement ni nouvel appel fournisseur. Le modèle,
le prompt et les paramètres fournisseur restent inchangés. Les scores, la
présélection, les contraintes structurées et les données de test sont conservés.

## Cause

Les réponses réelles de la campagne du 1er novembre séparent correctement leurs
critères. Pourtant, `unknown` est recevable dans `criterion_evidence` mais la même
référence de récurrence est refusée dans `caution_refs`. Une caractéristique dont
la portée est partielle et son point source positif qualifié sont aussi refusés.
L'erreur `IRRELEVANT_CAUTION` déclenche alors le classement général. Son explication
était placée après les cartes ; les préférences du texte libre n'étaient pas
vérifiées par ce classement.

## Validation

La réponse native et ses références ne sont jamais réécrites pour passer :

- une inconnue ou limite partielle doit appartenir à un critère déjà validé ;
- une réserve supplémentaire d'une rubrique demandée doit appartenir à cette
  rubrique ; une simple présence dans le dossier ne suffit plus ;
- un point positif n'est recevable comme limite que s'il est la source exacte
  (rapport, section, index) d'une caractéristique partielle demandée ;
- une vraie fraîcheur `corpus_changed` reste une limite générale recevable ; une
  simple date d'un rapport courant n'est toujours pas une vigilance ;
- hors demande particulière, les réserves générales du rapport restent recevables ;
- les références absentes/étrangères échouent avec `INVALID_REFERENCE` ; les sources
  existantes non reliées échouent toujours avec `IRRELEVANT_CAUTION`.

Le rendu ajoute une indication serveur `uncertainty` ou `context_limit` et garde
le texte et les sources. L'inconnu ne devient pas une affirmation positive ou
négative. Une qualification temporelle n'est pas présentée comme défaut permanent.
Les autres réserves disponibles restent dans leur volet sourcé.

Un rattachement sémantique entièrement ouvert non vérifiable n'est pas déclaré
validé. Les textes libres restent transmis intégralement ; cette validation de
provenance ne prétend pas prouver toute leur interprétation. La pertinence des
choix et des compromis doit être jugée séparément.

## Secours

Le serveur ajoute `recommendation-fallback-disclosure-v1` aux réponses de secours
et d'attente, après les contrôles existants des droits et du corpus. Ce document
ne comporte pas le texte utilisateur. Il donne les contrôles appliqués : accès,
rapport et scores cohérents, cuisine, budget, caractéristiques obligatoires,
géographie et priorité structurée au service lorsqu'ils sont présents.

Le texte libre reste `not_verified`. Le choix personnalisé est indisponible, même
si quelques indices conservateurs sont documentés. Le moteur existant reste
l'unique source du classement général ; aucun restaurant n'est ajouté ou retiré
par le mécanisme de secours. Chaque carte peut montrer les éléments disponibles,
avec leurs inconnues et leur contexte, sans promettre une adéquation complète.

L'interface FR/VI affiche l'origine et les limites avant les cartes. Le classement
général est identifié séparément de la sélection IA. Aucune relance automatique.

## Contexte temporel

Le parseur existant conservait une ambiguïté après normalisation des accents :
`thứ sáu` (vendredi) pouvait être confondu avec `sau` (après). Le jour est désormais
séparé de l'opérateur horaire. Les notes ne changent pas : sans date le contexte
reste partiel ; à une date renseignée, les règles temporelles existantes
s'appliquent. Une critique du vendredi ne devient pas une exclusion permanente.

## Compatibilité et vérification

Configuration/cache : `recommendation-ai-caution-safety-v6`.
Client de comparaison : `criteria_coverage_v6`. Les anciens modes sont refusés
avant lecture/réservation, sans empêcher les recherches classiques. Aucun schéma
SQL nouveau : seules les références et positions déjà prévues sont persistées ;
les annotations de vigilance et du secours sont calculées pour la réponse.

Les tests FR/VI couvrent les inconnues, les sources temporelles exactes, les
réserves hors sujet, les références inventées/étrangères, les confirmations non
étayées, la confidentialité du secours, les contraintes conservées et la langue.
Le rejeu privé compare le code e484683 à la correction sur les quatre réponses
brutes sauvegardées, sans mutation. Il confirme une validation et un rendu, pas
une amélioration mesurée d'un nouvel appel IA. Aucun secret, reçu réel ou donnée
nominative de production n'est ajouté au dépôt.
