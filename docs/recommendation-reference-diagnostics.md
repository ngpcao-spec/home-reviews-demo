# Diagnostics privés des références refusées

Le code `INVALID_REFERENCE` couvre plusieurs contrôles : liste de raisons
malformée, vide, dupliquée ou trop longue, référence absente du candidat,
référence connue mais interdite comme raison, référence incompatible avec le
critère, ou référence de vigilance absente. Le reçu historique ne permet pas
de distinguer ces branches lorsqu'il ne conserve ni réponse ni diagnostic.
Une empreinte de requête ne permet pas de reconstruire son contenu.

La correction ajoute uniquement un diagnostic borné au journal et au reçu privé
existants, dans `metrics.validation_diagnostic` : version, champ, règle, positions
du choix/candidat/critère/référence, et type/état de la source connue si disponible.
Une référence connue n'est enregistrée que sous son code technique canonique.
Les chaînes inconnues du modèle, textes utilisateur, extraits de rapport,
réponses brutes et noms de restaurants ne sont jamais copiés dans ce diagnostic.
Les métriques retournées au client ne contiennent pas ce champ privé.

Les erreurs publiques, règles d'acceptation, réponses au client, scores,
présélection, modèle, prompt, schéma fournisseur et configuration/cache V6 sont
inchangés. Aucune migration n'est nécessaire. Une tentative refusée reste
consommée, sans retry. Aucun reçu existant n'est complété rétroactivement.

Cette amélioration de traçabilité ne corrige pas une réponse passée manquante.
Sans réponse brute et sans les faits transmis à cette tentative, un rejeu exact
reste impossible. Les contrôles simulés et les rejeux d'autres réponses
sauvegardées démontrent la conservation des protections, pas la justesse d'un
choix historique inconnu ni sa future acceptation.

Vérifications hors réseau : branches de rejet en FR/VI, absence de texte privé
dans le diagnostic, séparation reçu/client, maintien du secours et de la
réservation consommée, comparaison des mêmes réponses avant/après et contrôle
que les requêtes fournisseur n'ont pas changé.
