# Couverture des critères de recommandation V5 — correction locale

État : code et tests locaux uniquement. Aucun appel fournisseur, migration, push,
déploiement ou activation. Le relais expérimental précédemment supprimé n'est pas
recréé. Les réponses, reçus et requêtes des quatre essais restent inchangés dans
le dossier privé de campagne, hors de ce dépôt.

## Cause suivie de bout en bout

1. Le dossier contenait bien les points précis du rapport, leurs nuances et les
   déclarations pratiques connues. Il omettait les caractéristiques non renseignées.
   Une préférence familiale pouvait donc rester implicite quand seul l'extérieur
   était documenté.
2. Le JSON natif ne proposait que deux `reason_refs` et un `caution_ref`. Il ne
   demandait pas de preuve ou d'inconnue pour chaque critère et n'obligeait pas à
   comparer les compromis. La validation vérifiait surtout l'appartenance des
   références. Une date de rapport courant ou une installation refusée sans
   rapport avec la demande pouvaient servir de vigilance.
3. L'interface rendait fidèlement les références retenues ; elle ne supprimait
   pas une justification personnalisée plus riche. Mais elle n'avait aucun état
   de couverture ni espace permettant de montrer les critères non confirmés.

La correction porte donc sur les données, le contrat, la validation, les
instructions et le rendu. Changer uniquement le prompt aurait laissé ces pertes.

## Contrat et sources

Configuration/cache : `recommendation-ai-criteria-coverage-v5`.
Couverture : `recommendation-criteria-coverage-v1`.
Contenu des points de rapport conservé : `recommendation-report-points-v1`.
Modèle `gpt-6.1-sol`, effort faible, sortie maximale 1 800 tokens, une tentative,
HTTP borné et `store:false` inchangés.

La demande complète reste transmise dans son champ de données. Les indices
conservateurs déjà utilisés pour la présélection créent des obligations de
couverture, **pas des filtres nouveaux**. Famille, extérieur, service et récurrence
restent distincts. Ces indices ne constituent ni un vocabulaire d'entrée fermé ni
une interprétation exhaustive : le modèle peut ajouter d'autres critères en citant
verbatim un passage de la demande avec `key:null`.

Pour les caractéristiques demandées, le dossier contient aussi les états inconnus,
avec une provenance `not_documented`, sans fabriquer de déclaration Google négative.
Chaque candidat possède une matrice `criterion_observations` liée à ses propres
faits. Les états sont : documenté, partiel/limité au contexte, contraire,
contradictoire et inconnu. Une moyenne d'ambiance ne démontre pas le calme ; un
score de service seul n'est pas une preuve de rapidité ou d'attention.

Chaque choix doit couvrir tous les critères déclarés, et tous les indices connus
doivent être déclarés. Les états et références des critères connus sont revérifiés
côté serveur. Les besoins ouverts restent liés aux sources exactes ; la validation
ne force pas les premiers points d'une rubrique : le modèle choisit les preuves
pertinentes parmi ses références disponibles. Une rubrique mixte doit conserver
un appui positif et une réserve, sans réécrire leurs textes. La validation
de provenance/polarité ne prétend pas prouver leur adéquation sémantique exhaustive.
Une décomposition ou une association sémantique incorrecte reste possible et doit
être examinée lors d'un futur essai réel.

Le diagnostic de cuisson réutilise `repeatedCookingConcern`, sans nouvelle analyse
des avis, exception par identifiant, comptage de longueur ou modification JEV :

- `reported_repetition` : répétition explicitement attribuée au rapport, jamais
  présentée comme vérification indépendante ;
- `not_established` : le texte qualifié ne démontre pas la répétition du même défaut ;
- `unknown` : récurrence indéterminée, y compris sans plainte disponible.

Les deux derniers états ne deviennent jamais une garantie d'absence de défaut.
Le diagnostic dérivé est identifié comme tel, distinct d'un extrait littéral ; les
textes sources complets restent consultables avec leurs nuances et références.

Le JSON strict autorise jusqu'à huit critères, deux preuves par critère, six
références complémentaires, quatre vigilances et deux alternatives distinctes
non sélectionnées. Cela ne change ni les trois choix maximum ni les vingt candidats.
Plus de huit indices préparés : repli avant réservation, sans troncature ni appel.
Les preuves sont indépendantes du plafond des références complémentaires.

Une réponse qui laisse tous les choix non documentés sur une préférence connue
alors qu'une alternative fournie la documente doit citer une alternative pertinente.
Le serveur restitue sa matrice complète, y compris ses propres inconnues. Il ne
remplace pas les choix IA et n'introduit pas un second classement. Cette comparaison
est bornée : elle ne prétend pas épuiser tous les compromis possibles.

Les réserves choisies peuvent être multiples. Une simple date de rapport courant
et une installation refusée sans lien avec les critères ne sont plus des vigilances
recevables. Les autres réserves enregistrées et installations refusées/contradictoires
restent visibles dans un volet identifié et sourcé, sans remplacer le choix natif.
Une correspondance partielle apparaît dans la carte principale, pas seulement dans
les détails. Un contexte temporel non confirmé n'est pas rendu comme contradiction.

## Cache, confidentialité et compatibilité

Le modèle copie des fragments exacts de la demande ; la validation les convertit
en positions avant sauvegarde. La sélection JSON en base reste un tableau : aucune
migration n'est nécessaire. Seuls identifiants, références, états et positions sont
conservés, sans texte utilisateur, requête ou réponse complète. La réponse serveur
ne recopie pas non plus la préférence : le navigateur reconstruit les passages
depuis son champ déjà saisi. Les journaux techniques restent sans texte utilisateur.

La V5 invalide les anciens caches. Les réponses antérieures restent décodables
hors réseau pour audit avec le décodeur historique, mais `compareAi` utilise
exclusivement la nouvelle validation. Aucune entrée ancienne ou incohérente n'est
réparée silencieusement. Réservations, droits, résultat inconnu, réponse tardive,
source modifiée et reçu non sauvegardé conservent leurs protections sans retry.

Le client envoie `preference_mode:criteria_coverage_v5`. Les anciens modes sont
refusés avec 409 avant lecture du catalogue/réservation pour éviter qu'une page
ancienne masque les nouveaux critères. La recherche classique reste inchangée.

## Vérifications et limites

Les tests FR/VI couvrent deux critères distincts, inconnues, contexte temporel,
contradictions, phrases ouvertes et négations, critiques différentes, répétition
explicite et indéterminée, réserves multiples, références étrangères, cache sans
texte, état inconnu sans retry et contraintes strictes conservées. Les essais
mobile utilisent des réponses simulées et bloquent le réseau externe.

Le rejeu privé des quatre essais vérifie les mêmes vingt identifiants ordonnés et
les mêmes scores. Les sorties historiques ne satisfont pas le nouveau schéma ;
elles ne sont pas présentées comme de nouvelles réponses. Une projection simulée
avec les mêmes choix montre les inconnues et les alternatives, sans prouver que
le modèle fera de meilleurs choix lors d'un prochain appel.

Le classement de présélection n'est pas modifié ici. Une alternative située hors
des vingt demeure indisponible au choix final. Aucun oracle n'est transmis.
Les durées, tokens et qualité réels du nouveau contrat restent non mesurés.

Référence de format vérifiée : [Structured Outputs, documentation officielle
OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
La conformité du JSON ne constitue pas une validation métier des recommandations.
