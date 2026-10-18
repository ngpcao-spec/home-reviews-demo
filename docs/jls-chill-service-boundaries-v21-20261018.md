# Chill Thái — réservation et attente des boissons, V2.1

Contrat expérimental : `jls-recommendation-contract-v2.1`.
Validateur : `jls-reservation-beverage-validation-v2.1`.
Sélection/questions : `jls-reservation-beverage-boundaries-v2.1`.
Archive : `jls-reservation-beverage-review-v2.1`.

Le format JSON reste `jls-prioritized-recommendations-v2` : ses champs sont suffisants. Le prompt et la configuration ont de nouvelles empreintes ; le schéma reste identique. Aucun protocole, consentement ou run payant n'est créé. Les futures préparations peuvent utiliser les nouveaux constructeurs ; les anciens protocoles gardent leurs configurations figées. Aucun changement automatique du pipeline commercial ou du worker payant.

## Deux corrections distinctes

### Confirmation de réservation

Le focus `communication` peut maintenant appuyer une proposition précise de clarification ou de réexamen des confirmations, si la citation et son contexte décrivent des messages du personnel contradictoires ou ambigus. La règle historique de compréhension/langue n'est pas élargie globalement. Une question du client, une confirmation sans conflit, une hypothèse, une négation ou un malentendu reconnu du client ne suffisent pas.

Une réservation de salle et une option buffet peuvent rester ambiguës : cela ne prouve pas une double réservation ou une faute. Les formulations affirmant ces fautes sont mises à réexaminer. Une résolution ultérieure doit rester dans le résumé localisé. Les contrôles demeurent déterministes et limités ; ils ne garantissent pas la compréhension sémantique de toute formulation.

### Attente des boissons

Une plainte sur leur délai relève de `wait_time`, axe Service, topic `service_flow`, focus `service_delay`. Ses fréquences directes correspondent à `wait_time:negative`. `drinks` concerne la qualité des boissons ; son verdict ne peut pas servir de verdict sur l'attente.

Le nouveau sélecteur recherche un extrait autonome dans une association JEV `wait_time` déjà présente. Il ne recode pas une association `drinks`. La nouvelle citation reçoit son identité, ses empreintes, son contexte et `luna_verdict=null`. Un extrait ne parlant que du délai n'est plus admissible comme preuve de qualité négative des boissons. Les nouvelles questions Luna explicitent ces frontières, restent regroupées par avis et ont leurs propres empreintes ; les résultats historiques ne leur sont jamais transférés.

Les configurations JEV V11/V12/V13, V12 économique, les seuils, les statistiques historiques et les règles V2 sont inchangés. La clarification de classification est appliquée aux nouvelles questions de vérification et au routage des preuves, sans recalculer JEV.

## Vérification réelle hors réseau

Sources : run `3294262e-8946-41c0-b9c4-463a4fe27e74`, revalidation `7c02370c-990c-41ce-a2c5-41262dd98383`, reçu Sol et dossier figés. Le replay Deno n'a aucune permission réseau et interdit `fetch`.

| Recommandation | Validation V2 conservée | Validation V2.1, contenu inchangé |
| --- | --- | --- |
| Qualité du Tom Yum | affichable | affichable |
| Quantité du petit hot pot | affichable | affichable |
| Clarification de réservation | masquée | contrôles techniques passés |
| Délai Coca-Cola / thé glacé | masquée | toujours masquée |

La réservation conserve exactement son texte, sa question, son contexte et le verdict Luna `communication:negative`. Il s'agit d'un changement de validation, pas d'une nouvelle réponse Sol ni d'une modification de la revalidation V2.

Pour les boissons, les trois preuves `wait_time` du dossier sélectionné sont positives. Aucune preuve négative ACCEPTED compatible ne justifie cette action. Le cache contient pourtant déjà `wait_time:negative` pour l'avis `4b5dae79-7eea-479a-b616-51904c71d939`. Une candidate exacte est préparée à partir de cette association ; son verdict reste absent.

La recommandation historique conserve `drinks`, ses fréquences et son focus. Elle reste masquée pour `PRECISE_ACTION_REQUIRES_REVIEW` et, sous V2.1, `BEVERAGE_DELAY_REQUIRES_WAIT_TIME_EVIDENCE`. Il faudrait une vérification future de la citation sous `wait_time`, puis un nouveau dossier accepté et une nouvelle génération autorisée. Rien de cela n'est exécuté ici.

## Persistance et affichage

La table immuable existante `public.analysis_jls_snapshot_preparations` est réutilisée, avec kind distinct `recommendation_limits_v21`. La RPC serveur existante vérifie l'empreinte et l'idempotence ; les RLS owner/admin/manager par organisation et l'interdiction d'écriture navigateur restent inchangées.

L'archive lie le reçu, la source, la première revalidation, les décisions Luna, le code, les résultats du replay et les nouvelles empreintes de préparation. Le lecteur contrôle aussi que seuls les statuts de validation diffèrent : tous les textes, citations, thèmes, polarités et fréquences du rapport restent identiques.

Le nouvel encart FR/VI « Réexamen V2.1 — contenu Sol inchangé » est séparé du rapport et des validations historiques. Il affiche les changements, le motif du masquage restant, la candidate non vérifiée et la provenance. Aucun bouton payant n'est ajouté.

## Contrôles

- Contre-exemples synthétiques : confirmations sans conflit, question seule, négations, hypothèses, identité de l'émetteur, résolution ultérieure et omission de cette résolution.
- Attente versus goût, négation du délai, attente brève, commentaires mixtes et fréquence liée au bon thème.
- Liaisons citation/contexte/polarité/décision, refus du transfert d'un verdict à une nouvelle question et conservation des empreintes historiques.
- Tests unitaires JLS, tests Deno sans réseau, lint, build et contrôles TypeScript/Deno.
- Huit tests mobiles FR/VI, 360/390/430 et iPad 768 : provenance, masquage, rechargement, absence de débordement et zéro POST.
- Replay intégral sur les données sauvegardées et contrôle de lecture du nouvel objet ; comparaison des empreintes du run, des tâches, des artefacts et des deux anciennes revalidations.

Zéro appel JEV, Luna, Sol ou Apify ; zéro consentement ou run payant ; aucune régénération du rapport. Les compteurs historiques restent 80 JEV, 28 Luna et un Sol, chacun sans deuxième tentative.
