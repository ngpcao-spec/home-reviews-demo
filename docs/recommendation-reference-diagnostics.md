# Diagnostics privés des références refusées

Le code `INVALID_REFERENCE` couvre plusieurs contrôles : liste de raisons
malformée, vide, dupliquée ou trop longue, référence absente du candidat,
référence connue mais interdite comme raison, référence incompatible avec le
critère, ou référence de vigilance absente. Le reçu historique ne permet pas
de distinguer ces branches lorsqu'il ne conserve ni réponse ni diagnostic.
Une empreinte de requête ne permet pas de reconstruire son contenu.

La version `recommendation-diagnostic-v2` utilise le journal privé séparé
`private.recommendation_ai_diagnostics`, sans modifier les reçus historiques.
Elle conserve les versions serveur/contrat/validateur/cache, l'étape, le code,
le champ, la règle, les positions et identifiants des candidats concernés.
Pour une référence : existence dans les faits transmis et dans le candidat,
propriétaires possibles, type/état et usages autorisés par le validateur.
Pour une liste : taille, limite, doublons et positions invalides. L'origine finale
renvoyée au client distingue IA validée, cache, secours, attente ou indisponibilité.
Une référence n'est enregistrée que sous un code technique canonique reconnu.
Les chaînes inconnues du modèle, textes utilisateur, extraits de rapport,
réponses brutes et noms de restaurants ne sont jamais copiés dans ce diagnostic.
Les métriques retournées au client ne contiennent pas ce diagnostic privé.

Les erreurs publiques, règles d'acceptation, réponses au client, scores,
présélection, modèle, prompt, schéma fournisseur et configuration/cache V6 sont
inchangés. Une tentative refusée reste
consommée, sans retry. Aucun reçu existant n'est complété rétroactivement.

Le support SQL est limité à la nouvelle table et à deux RPC `SECURITY INVOKER`,
réservées à `service_role`, sous RLS. Chaque écriture vérifie les droits et
l'appartenance de la tentative à l'utilisateur et l'organisation. Les traces
sont bornées à 16 Kio, 100 lignes par organisation et une expiration de 7 jours.
La purge physique s'effectue au prochain accès autorisé à la page ou à la prochaine
écriture. Sans aucun accès, des lignes expirées peuvent subsister physiquement
jusqu'au prochain accès ; aucun nouveau cron n'est ajouté. Les journaux plateforme
ne dupliquent pas les détails : seulement identifiants techniques et origine.

Déployer seulement `test-restaurant-recommendations`, avec JWT obligatoire,
après application de la seule migration
`20261101051021_recommendation_private_diagnostics_v2.sql`. Aucun client à publier.
Configuration/cache V6 inchangée : une requête identique à une tentative échouée
reste consommée et ne devient pas un nouvel appel grâce à cette instrumentation.

Cette amélioration de traçabilité ne corrige pas une réponse passée manquante.
Sans réponse brute et sans les faits transmis à cette tentative, un rejeu exact
reste impossible. Les contrôles simulés et les rejeux d'autres réponses
sauvegardées démontrent la conservation des protections, pas la justesse d'un
choix historique inconnu ni sa future acceptation.

Vérifications hors réseau : branches de rejet en FR/VI, absence de texte privé
dans le diagnostic, séparation reçu/client, maintien du secours et de la
réservation consommée, comparaison des mêmes réponses avant/après et contrôle
que les requêtes fournisseur n'ont pas changé.
