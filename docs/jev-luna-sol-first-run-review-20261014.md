# Premier essai Artisan : résultat et correction ciblée des recommandations

## Exécution enregistrée

Plan VI : `5295245f-b2c1-4f5d-80ad-ca9f821ae3da`.
Run unique : `489d42ae-c44c-40c1-8435-16f304c71a9e`, terminé le 14 octobre 2026 à 02:28:44 UTC.
Résultat historique : `needs_review`, SHA256 `6cb5318be280aac397f4771be8ff5d05980fe82a28a13cb60be3cef1f99a4612`.

- 422 analyses JEV réutilisées ; aucun nouvel appel JEV.
- 24 appels Luna terminés, 25 décisions : 24 ACCEPTED et 1 REJECTED.
- 1 appel Sol terminé ; aucune tentative répétée ni usage inconnu.
- Coûts calculés selon les tarifs enregistrés : Luna 0,0017906 USD, Sol 0,064176 USD, total 0,0659666 USD. Ce calcul n'est pas une facture vérifiée.
- Dix recommandations, dont deux masquées par `PRECISE_ACTION_REQUIRES_REVIEW` : `wait` et `food`.

## Cause reproduite hors réseau

`verifyGraphV3` classe les énoncés de tout le contexte et en renvoie un seul. Le validateur JLS demandait ensuite que cet énoncé soit inclus dans la citation sélectionnée. Lorsque V3 choisissait une phrase plus courte ailleurs dans le même avis, une preuve pertinente présente dans la citation était ignorée.

Pour `wait`, la règle classait en premier la phrase signalant une longue attente, alors que la citation retenue décrivait une attente de plus d'une heure pour une omelette. Les deux phrases sont reconnues comme `service_delays`.

Pour `food`, la règle classait en premier une critique générale du goût, alors que la citation retenue contenait notamment une salade jugée fade. Les deux phrases contiennent un énoncé négatif `food_quality` reconnu.

Les textes proposés par Sol étaient exactement ceux du catalogue autorisé. Le blocage venait du choix de la phrase justificative, pas d'une nouvelle action inventée par Sol.

## Correction

Le validateur conserve le graphe du contexte complet et son refus en cas de contradiction ou de renversement temporel. Il cherche ensuite un énoncé admissible parmi ceux situés **entièrement dans les offsets exacts de la citation** : même thème, même polarité, caractère actionnable, et claim autorisé lorsque l'action en impose un.

Les autres contrôles restent en place : Luna ACCEPTED, confiance, hashes, citation exacte, catalogue des actions, thème/axe/polarité et chiffres JEV. La citation seule n'est pas reparsée, afin de conserver négation, antécédents et contexte.

## Vérification et limites

Les régressions synthétiques reproduisent les deux faux blocages. Elles couvrent aussi le contexte commençant au milieu d'un avis, la preuve extérieure à la citation, la mauvaise action/polarité, la négation, l'historique, les contradictions, les hypothèses et les offsets incohérents.

Un replay local de la réponse Sol originale, du plan, du snapshot et des décisions Luna enregistrés, avec `fetch` bloqué, donne dix recommandations passant les contrôles au lieu de huit. Les axes, aspects positifs/négatifs et conclusion restent identiques. Les données réelles de replay sont temporaires et ne sont pas ajoutées au dépôt.

Ce replay est une nouvelle vérification technique hors réseau. Il ne remplace pas le résultat historique, ne change pas les verdicts Luna, ne constitue pas une validation humaine et n'autorise aucun nouvel appel payant.

L'unique rejet Luna mérite une revue qualitative séparée : la citation contient une appréciation positive d'un plat et une critique de sa portion, dans un avis globalement mixte. Le taux d'acceptation de 24/25 ne mesure donc pas l'exactitude de Luna. Aucun verdict n'a été modifié pendant cette correction.

## Revalidation versionnée

La révision `jls-quote-bound-actions-v1` est enregistrée séparément dans le journal append-only `analysis_jev_luna_sol_events`, action `report_revalidated_quote_bound_v1`. Elle contient le run, le hash du résultat original, le commit du validateur, `new_paid_calls: 0`, la sortie revalidée et le hash canonique de son corps. Les politiques RLS et le déclencheur d'immuabilité existants protègent ce journal ; aucune nouvelle table ni permission n'est nécessaire.

L'API GET vérifie l'empreinte de la révision, son rattachement au résultat historique et l'identité des statistiques, décisions Luna, source Sol et sections hors recommandations. L'interface utilise ensuite cette révision en indiquant la revalidation et le statut historique conservé. Sans révision, elle continue d'afficher le résultat original. Aucune route d'écriture ou d'exécution payante n'est ajoutée.

L'enregistrement administratif est transactionnel, conditionné aux empreintes enregistrées et idempotent par run et version. Les requêtes fournisseur, réponses brutes, verdicts, résultat original et statut du run restent inchangés.
