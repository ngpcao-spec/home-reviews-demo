# Résultat réel Luna V2 — 13 octobre 2026

Run Supabase : `8ffeb433-de20-4a64-bb91-0f99a385f5c1`. Statut confirmé : **completed**.
Délégation administrative unique reçue directement de l'utilisateur ; aucun clic iPhone ni session humaine simulés.
Commit technique : `b16fe961001000b2b7b4c9af656a19622afe348d`.

## Exécution et intégrité

28 requêtes réelles, toutes terminées, une tentative par avis. 32 réponses de questions, probabilités et confiances persistées. Aucune erreur, facturation incertaine ou relance. Modèle retourné : `gpt-6-luna`. 15 320 tokens d'entrée, 0 sortie. Coût calculé standard : **0,001532 USD** ; coût par décision : **0,000047875 USD**. Ce calcul n'est pas une facture vérifiée et ne garantit pas les suppléments éventuels.

Estimation initiale : 19 038 tokens, 0,0019038 USD. Latence cumulée : 17,889 secondes ; durée de bout en bout : 141,625 secondes, y compris les attentes du worker durable.

Empreintes des 28 requêtes, 28 réponses et 28 textes anglais vérifiées. Les 32 couples question/thème/polarité correspondent au snapshot. Recalcul local sans réseau identique au résultat serveur.

- Snapshot : `6e464e2f0fa13ae1f83168b65a04e3de3e396fc0c1150d08ba71e8e30b008189`.
- Références : `048df28c19e95a25e426ebb08fbb58665634027f85906712072b94e788818592`.
- Autorisation : `e4379d63243e05c4bf6fe83ad493ff770cfe2b339e1f4dc8e243834aa3bd63fe`.
- Résultat : `f0d099e84e69cd44e9e77bb5aaf9062bfddbe04bc7fcfb03ca8339441f7f4fa2`.

## Mesures par rapport à GPT-6

Références IA, pas Gold humain indépendant. Un label incertain exclu : 31 associations évaluables.

| Mesure après filtre de confiance existant | Résultat |
|---|---:|
| TP / FP / TN / FN | 23 / 0 / 5 / 1 |
| Précision sélective | 100 % — 23/23 |
| Rappel des preuves justifiées | 95,8 % — 23/24 |
| Rappel des critiques proposées | 100 % — 14/14 |
| Couverture décisionnelle | 93,5 % — 29/31 |
| Abstentions évaluables | 2 |
| Réponses manquantes | 0 |

Les 32 décisions après filtrage sont 23 supported, 6 unsupported et 3 uncertain, dont le cas à référence incertaine exclu. Les choix **natifs** sont 24 supported et 8 unsupported : une acceptation native incorrecte devient une abstention grâce à la confiance minimale existante de 0,60. Sans ce filtre, les choix natifs donnent TP 23, FP 1, TN 6, FN 1 ; précision et rappel 95,8 %. Aucun seuil n'a été modifié après lecture des résultats.

## Principaux cas à examiner

- r21 : `food_quality positive`, review `cd1ecb81-462b-4749-a3a4-4d175179efeb`. Appréciation explicitement positive de la nourriture rejetée ; confiance 0,80, p(unsupported)=0,87. Faux négatif positif face à la référence.
- r20 : `communication negative`, review `aba9dde8-2d95-49a3-a3f0-c72294177ac7`. Une explication utile est évaluée positive par GPT-6 ; Luna natif accepte la polarité négative (p=0,51, confiance 0,27). Abstention finale, aucun faux positif retenu.
- r12 : `price_level negative`, review `868eb1ec-3081-4ad3-a0b1-5225e51a8d32`. Négation avec faute de frappe ; rejet natif cohérent avec la référence positive, mais confiance 0,55 : abstention conservatrice.
- r13 : comfort, référence GPT-6 incertaine, exclue des métriques ; réponse filtrée uncertain.

Les textes complets restent dans le rapport local privé et le snapshot Supabase, pas dans ce document public. Aucune annotation n'a été changée pour améliorer les scores.

## Les 32 résultats

L'ordre des questions suit le snapshot, y compris les quatre requêtes à deux questions. `tp/tn/fp/fn` indiquent l'accord avec une appréciation IA.

| Question | Association proposée | GPT-6 | Luna natif | Après filtre | Comparaison |
|---|---|---|---|---|---|
| r1_q1 | value − | negative | supported | supported | tp |
| r1_q2 | billing − | negative | supported | supported | tp |
| r2_q1 | food_quality + | positive | supported | supported | tp |
| r2_q2 | atmosphere + | positive | supported | supported | tp |
| r3_q1 | cooking − | negative | supported | supported | tp |
| r3_q2 | billing − | negative | supported | supported | tp |
| r4_q1 | attentiveness − | negative | supported | supported | tp |
| r4_q2 | price_level − | negative | supported | supported | tp |
| r5_q1 | portions − | negative | supported | supported | tp |
| r6_q1 | cooking − | absent | unsupported | unsupported | tn |
| r7_q1 | comfort − | negative | supported | supported | tp |
| r8_q1 | attentiveness − | negative | supported | supported | tp |
| r9_q1 | food_quality − | both | supported | supported | tp |
| r10_q1 | cleanliness − | positive | unsupported | unsupported | tn |
| r11_q1 | portions − | negative | supported | supported | tp |
| r12_q1 | price_level − | positive | unsupported | uncertain | abstention |
| r13_q1 | comfort − | uncertain | unsupported | uncertain | reference_uncertain |
| r14_q1 | food_quality − | both | supported | supported | tp |
| r15_q1 | price_level − | negative | supported | supported | tp |
| r16_q1 | price_level − | negative | supported | supported | tp |
| r17_q1 | food_quality + | positive | supported | supported | tp |
| r18_q1 | professionalism + | positive | supported | supported | tp |
| r19_q1 | food_quality + | absent | unsupported | unsupported | tn |
| r20_q1 | communication − | positive | supported | uncertain | abstention |
| r21_q1 | food_quality + | positive | unsupported | unsupported | fn |
| r22_q1 | food_quality + | positive | supported | supported | tp |
| r23_q1 | food_quality + | positive | supported | supported | tp |
| r24_q1 | food_quality − | positive | unsupported | unsupported | tn |
| r25_q1 | food_quality + | positive | supported | supported | tp |
| r26_q1 | portions + | positive | supported | supported | tp |
| r27_q1 | food_quality + | positive | supported | supported | tp |
| r28_q1 | food_quality − | positive | unsupported | unsupported | tn |

## Comparaison descriptive

| Test | Appels / questions | Précision sélective | Rappel | Coût calculé USD |
|---|---:|---:|---:|---:|
| Artisan anglais | 40 / 40 | 83,3 % | 74,1 % | 0,0018382 |
| Multi-restaurants anglais | 39 / 39 | 100 % | 74,1 % | 0,0017329 |
| Native48 multilingue | 48 / 48 | 85,7 % | 85,7 % | 0,0024975 |
| V2 critiques anglais | 28 / 32 | 100 % | 95,8 % | 0,001532 |

Valeurs relues depuis les anciens résultats. Jeux, langues, difficultés et références différents : aucune amélioration appariée ni généralisation démontrée. Aucun ancien test relancé.

## Limites et recommandation

28 avis, 13 restaurants, seulement 4 avis 1–4 étoiles. 12 thèmes possèdent des cas ; les 13 autres n'ont aucun support. Le rappel des critiques concerne uniquement les associations négatives proposées et validées par GPT-6, pas l'extraction exhaustive des thèmes.

Bootstrap déterministe par avis, 2 000 resamples. Couverture : IC 95 % [83,3 %, 100 %]. Les intervalles [100 %, 100 %] de précision et rappel négatif sont dégénérés en l'absence d'erreurs observées : ils ne garantissent pas ces taux sur la population. Brier 0,0425, ECE 9,23 %, 31 cas ; lecture exploratoire.

**GO expérimental pour une couche complémentaire de contrôle des preuves.** Conserver JEV V12 comme moteur principal et le filtre de confiance actuel. Examiner le faux négatif positif explicite et le choix natif erroné de communication. Évaluer sur un nouveau jeu plus riche en critiques avant toute production ; ne pas calibrer puis revendiquer une évaluation indépendante sur ces mêmes avis. Aucune activation automatique.

## Données protégées

Les versions, analyses JEV, anciens runs Luna, références et rapports sont inchangés. Sur 134 tables contrôlées, seules les cinq tables d'exécution V2 ont été modifiées par ce run. Un avis live hors cohorte et sa traduction ont évolué après sa fin ; aucun avis sélectionné ni snapshot figé n'a changé.

Aucun appel JEV, Sol, Responses ou Apify lancé par cette mission. Seuls les 28 appels Decisions expressément autorisés ont été réalisés.
