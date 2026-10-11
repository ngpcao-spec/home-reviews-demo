# Évaluation figée V3 — 40 cas réservés

**GO pour poursuivre les diagnostics expérimentaux ; NO GO pour utiliser V3 comme filtre autonome ou activer la production.** Les cinq acceptations sont compatibles avec la référence IA, mais le filtre s'abstient sur 80 % des cas et ne conserve que 5/27 associations justifiées. Ce faible nombre d'acceptations ne démontre pas une précision générale de 100 %.

## Sources et intégrité

- Moteur évalué : commit `91e76d8a4c130ce3b3565cbbc74771e286b0df48` ; empreinte des règles et du pipeline `4fd4dc9eb81e386c9e1c805a74e6494297ce5c640fdf61199e36a556f50d582a`.
- Référence IA : `pilot-evidence-v3-gpt6-reserved40-reference-20261011.json`, commit `b64f571d36ca389cdf459b1311c35938848ce1f7` ; SHA256 du blob Git `9ce8013b5857dfb168887304f1bab056a11fb23a75c6763b28ff99330edf4e05`.
- Contrôle : `3988aa10-0c5c-4a52-b1ff-1b576b488c52` ; SHA256 `418c0f1a2dccea8bd5f29ce046dcc57a35d645710231ed540cd38dcb1ccb4391`.
- Snapshot : `f9c8876b-1b5a-4d10-9538-758881b61b6b` ; SHA256 `19ea6e88f81a6243792b0a49ec1aa2a7b3d1915272c50790940a6c5c8259bf7e`.
- Résultat Supabase immuable : `dae5d565-6a72-4955-aa01-a4e79c218d12`, table `analysis_jev_pilot_evidence_v3_reserved_evaluations`.
- SHA256 canonique du résultat : `cb560e3c23087ba87993c3c71c6dd10fa90caf6041f9e199dca6223f2790049a`.

Les 40 `review_id`, thèmes, positions et empreintes concordent entre le contrôle, le snapshot, les références et les analyses JEV persistées. Les textes originaux sont aussi vérifiés par leur empreinte, sans nouvelle vérification linguistique de la traduction. Aucun des 40 avis ou bindings ne chevauche les 199 cas du premier audit. Les 32 fichiers de la fermeture des dépendances du vérificateur sont identiques au commit moteur, après normalisation LF/CRLF ; leurs SHA256 de blobs Git figurent dans le manifeste.

Les sorties du vérificateur ont été écrites dans un artefact séparé **avant de charger les annotations GPT-6 dans le script d'évaluation**. Les seuls arguments fournis au vérificateur sont le texte anglais, le thème et la polarité proposée. Le résultat est reproductible, sans appel réseau, dans l'environnement Deno enregistré dans le manifeste. Ni les règles, ni les seuils, ni les références n'ont été ajustés pour cette évaluation.

## Limites de la référence

Il s'agit d'appréciations GPT-6 dans ChatGPT, **pas d'un Gold humain ni d'une mesure des performances globales de JEV**. Les thèmes étaient visibles ; les polarités proposées des cas 1 et 2 avaient été vues lors du contrôle administratif, limite explicitement déclarée par la référence. Le jeu est issu d'un seul établissement et privilégié pour ses difficultés V2.1 : 39/40 cas étaient indécis en V2.1. La comparaison ne représente donc pas la fréquence réelle des états sur les 1 580 associations du pilote.

Les références contiennent 7 absences, 18 positifs, 9 négatifs, 2 `both` et 4 incertitudes. Pour l'association **thème + polarité proposée**, 27 sont justifiées et 9 non justifiées parmi les 36 comparables. Deux des neuf contestations concernent une polarité opposée, pas une absence du thème. `Both` justifie chacune des deux polarités ; `uncertain` est exclu de tous les dénominateurs binaires.

## Résultat réel V3

| Catégorie, selon la référence IA | Nombre |
|---|---:|
| Justifiée et acceptée | 5 |
| Non justifiée mais acceptée | 0 |
| Justifiée mais laissée indécise | 21 |
| Non justifiée et rejetée | 2 |
| Justifiée mais rejetée | 1 |
| Non justifiée mais indécise | 7 |
| Référence réellement ambiguë, hors scores binaires | 4 |

- Couverture des décisions : **8/40 = 20 %** ; sur les seuls comparables : 8/36 = 22,2 %.
- Abstention : **32/40 = 80 %** ; sur les seuls comparables : 28/36 = 77,8 %.
- Accord parmi les décisions comparables : **7/8 = 87,5 %**. Les abstentions sont exclues de ce dénominateur.
- Accord strict sur les 36 comparables, abstentions non comptées comme accord : **7/36 = 19,4 %**. Ce chiffre n'assimile pas une abstention à un jugement de rejet.
- Appui IA parmi les seules acceptations : **5/5**. Taux d'acceptation injustifiée observé : **0/5**. L'effectif de cinq reste trop faible pour conclure à une forte précision généralisable.
- Associations justifiées conservées : **5/27 = 18,5 %**. Les 22 restantes sont 21 abstentions et un rejet en désaccord avec GPT-6.
- Les cas incertains **8, 10, 34 et 40** sont tous indécis en V3 ; aucun ne participe à la précision binaire ou à l'accord binaire.

## Par axe

| Axe | Cas / comparables | Justifiées acceptées / justifiées IA | Rejets corrects | Rejet en désaccord | Abstentions / tous les cas | Couverture des décisions |
|---|---:|---:|---:|---:|---:|---:|
| Service | 9 / 9 | 1 / 5 | 1 | 0 | 7 / 9 | 22,2 % |
| Qualité | 13 / 12 | 1 / 11 | 0 | 0 | 12 / 13 | 7,7 % |
| Prix | 10 / 8 | 1 / 5 | 1 | 1 | 7 / 10 | 30 % |
| Ambiance | 8 / 7 | 2 / 6 | 0 | 0 | 6 / 8 | 25 % |

Les 40 cas n'évaluent pas uniformément les 25 thèmes. La faiblesse de couverture est particulièrement forte sur Qualité.

## Comparaison V2.1 et prédictions JEV

| Méthode sur les associations sélectionnées | Acceptations justifiées | Acceptations contestées | Rejets corrects | Rejets en désaccord | Abstentions sur 40 |
|---|---:|---:|---:|---:|---:|
| V2.1 | 1 | 0 | 0 | 0 | 39 |
| V3 | 5 | 0 | 2 | 1 | 32 |
| JEV persisté, avant filtre | 27 | 9 | 0 | 0 | 0 |

La V3 gagne quatre acceptations justifiées et deux rejets corrects sur V2.1, mais introduit un rejet en désaccord avec la référence. JEV proposait, par construction de l'échantillon, chacune des 40 associations. Son appui IA sur ce lot est **27/36 = 75 %**, et son accord de choix exact est également 27/36. Ces proportions ne sont pas une précision globale des 25 thèmes, ni une validation humaine. Aucun nouvel appel JEV n'a eu lieu.

## Erreurs et abstentions à diagnostiquer

- **Cas 12 — valeur positive rejetée** : avis `50e0a434-b71b-410f-9149-122cec9a23d0`. Le texte dit « Perfect breakfast for the whole family that includes everything. And not expensive. » GPT-6 y voit une appréciation favorable de valeur ; V3 applique `PRICE_LEVEL_NOT_VALUE`. C'est un désaccord avec la référence, dont l'interprétation est implicite, pas une preuve de vérité humaine.
- **Cas 3 et 5 — attente négative indécise** : une promesse de cinq minutes suivie de quinze minutes sans retour, et des boissons arrivées avant un repas attendu, ne sont pas reconnues par les motifs bornés. Le cas 6, contenant explicitement « service is a little slow », est accepté.
- **Cas 7 et 11 — facturation indécise** : comparaison de montants 450 000/400 000 et discussion de la taxe dans le prix de base, sans motif lexical reconnu.
- **Cas 20 et 21 — portions indécises** : « burgers aren't big » et « very little feta ... the portion is good » demandent une lecture de quantité, d'entité et de polarités mixtes.
- **Cas 23 — personnel poli indécis** : « the guys working there are so polite » utilise une désignation du personnel non reconnue.
- **Cas 33 — adjectif partagé dans une énumération** : « Amazing atmosphere, food and service!!!! » n'est pas distribué au thème nourriture.
- **Cas 35 — appréciation explicitement positive indécise** : « And the food is incredibly delicious » est sur une ligne sans ponctuation terminale avant le retour à la ligne. La segmentation V3 peut perdre ce type de segment, ce qui est un défaut technique à diagnostiquer avant toute extension sémantique.
- **Cas 32, 37, 38 et 39** : appréciations brèves ou naturelles (« very delicious », « Very tasty », « Gustatory ecstasy », smoothies « magical ») hors des relations reconnues.
- **Cas 25 correctement rejeté** : le service général « impeccable » et la sympathie ne prouvent pas une attention concrète. Le cas 15, prix abordables sans comparaison explicite de valeur, est aussi correctement rejeté.

## Corrections possibles, non appliquées

Pour une **nouvelle version indépendante**, envisager une segmentation qui conserve toutes les lignes, une meilleure portée des adjectifs sur les énumérations, les synonymes courants d'entités/qualificatifs, les délais et montants explicitement décrits, les négations de quantité et les polarités au niveau de l'entité. Revoir aussi la différence entre « appui non trouvé » et « preuve non justifiée » : un manque de motif ne doit pas devenir un rejet ferme d'une formulation potentiellement implicite.

Ces pistes ne sont ni des règles V3 nouvelles ni des réponses réécrites. Toute utilisation de ces 40 cas pour les développer transforme ce jeu en données de développement ; une future validation doit figer d'autres avis et une référence avant les prédictions. Ne pas élargir automatiquement valeur à toute cooccurrence de nourriture et de prix ; préserver les frontières de thèmes.

## Reproduction et publication

Le script `scripts/evaluate-v3-reserved40.ts` vérifie la fermeture des dépendances Git, la référence Git, les textes et le cache, puis écrit le résultat. Exemple :

```powershell
npx deno run --deny-net --allow-run=git --allow-read --allow-write scripts/evaluate-v3-reserved40.ts <export-source-autorisé.json> <résultat.json>
```

Le fichier source est un export organisationnel en lecture seule du contrôle, des 40 textes du snapshot, des bindings V2.1 et de leurs lignes de cache JEV. Il n'est pas livré dans le frontend. Le résultat JSON publié accompagne ce document ; toutes les 40 décisions, citations éventuelles, justifications IA, probabilités persistées et empreintes y sont conservées.

Accès mobile : **Plus / Thêm → Test Jev → Rapport pilote → Audit des preuves → V3 → Résultat V3 sur les 40 cas réservés**. L'écran et la nouvelle Edge Function sont uniquement en lecture. Aucun bouton de lancement, recalcul serveur, retry payant ou activation de production.

Coût fournisseur supplémentaire : **zéro**. Aucun appel JEV, Sol, OpenAI ou Apify. Les 422 analyses, le rapport historique, les configurations V12/V13, les audits V2/V2.1/V3 et les références d'origine restent inchangés.

Vérifications réussies : **1 344 tests Vitest sur 142 fichiers**, dont dix nouveaux tests de compte rendu et de comparaison ; deux tests Deno avec réseau interdit ; contrôles Deno de types et de lint ; lint et build frontend ; tests SQL/RLS avec rollback (immutabilité, idempotence, SHA256, privilèges et cross-tenant). Quatre tests Playwright couvrent FR/VI, rechargement, filtrage et absence de trafic fournisseur sur 360/390/430 px et iPad 768 px. Les empreintes des **82 tables historiques** contrôlées sont identiques avant/après ; seule la nouvelle table d'évaluation est ajoutée.
