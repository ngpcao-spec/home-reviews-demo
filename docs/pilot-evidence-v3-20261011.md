# Contrôle expérimental des preuves V3 — Artisan

Version : `pilot-evidence-semantic-v3`. Aucun fournisseur appelé, aucun nouveau rapport généré, aucune activation du moteur de production.

## Architecture et portée

Le module indépendant `supabase/functions/_shared/pilot-evidence-v3.ts` construit des propositions à partir de clauses anglaises, de leurs entités et de prédicats bornés. Il rattache la polarité au thème et à l'entité, traite les négations, les contrastes, certaines anaphores non ambiguës et les changements temporels. Un problème explicitement résolu ne devient pas une critique actuelle. Il s'agit d'une grammaire déterministe limitée utilisant des lexiques et des motifs, pas d'une compréhension sémantique générale ni d'une validation humaine ou IA indépendante.

La sélection et les recommandations sont séparées dans `pilot-evidence-v3-audit.ts`. Les citations sont des sous-chaînes exactes du texte figé, avec positions UTF-16 et SHA256. Les recommandations utilisent un catalogue fermé de constats/action : un délai n'autorise pas une conclusion sur la formation, une distance n'autorise pas une action sur les indications d'accès. Une preuve manquante invalide l'action. Les citations presque identiques sont limitées par similarité de mots ; ce mécanisme ne remplace pas une détection sémantique des doublons.

Le port optionnel de vérification sémantique reste bloqué dans le code ; aucune clé ou variable d'environnement ne permet d'activer ses appels payants. GET lit uniquement les données ; POST accepte exclusivement `audit_free`.

## Sources immuables

- Snapshot : `f9c8876b-1b5a-4d10-9538-758881b61b6b`.
- Audit V2.1 : `854ae975-7a7e-4a73-ae9e-d2f4807d046a`.
- Audit GPT-6 original : `jev-economic-pilot-gpt6-posthoc-audit-20261011.json`, SHA256 du fichier `100fb2ec6e57b5cf6e779a15e21801a077c4ce72776f31fc54c62c0b0d578276`.
- Résultat V3 corrigé : `36a2e813-e315-4354-ae67-ace1b4456367`.
- Empreinte des règles et du catalogue d'actions : `4fd4dc9eb81e386c9e1c805a74e6494297ce5c640fdf61199e36a556f50d582a`.
- Empreinte du résultat : `479d715980753ecc6ea06875467afa53a9a43f85da4166a58719e0da28cfb459`.

La révision technique initiale `a1ee93fc-f1ae-42e3-8c99-93981882c879` reste immuable. Une vérification avant déploiement a révélé une citation décrivant l'enlèvement de moisissures encore retenue comme problème actuel. La règle générale de résolution explicite a été ajoutée, puis un second résultat a été inséré avec une nouvelle empreinte. L'API expose exclusivement la révision correspondant aux règles déployées. Le même contrôle figé est partagé sans modification.

## Résultats calculés

Les 422 analyses JEV et les 1 580 associations sont conservées. V3 examine 1 423 associations. Les 157 autres appartiennent aux 40 avis réservés au nouveau contrôle et restent `review_needed`, sans exécution du filtre V3 sur leurs textes.

| État | V2.1, périmètre complet | V3, périmètre complet |
|---|---:|---:|
| Soutenu par les règles | 438 | 467 |
| Non soutenu par les règles | 65 | 59 |
| À réexaminer | 1 077 | 1 054 |

Le dernier chiffre V3 comprend 157 associations réservées ; les 897 restantes sont indécises après examen. Les nombres ne constituent pas une mesure de précision de JEV. Sur le périmètre effectivement examiné, 136 associations non soutenues ou indécises en V2.1 disposent maintenant d'un appui par les règles ; 71 anciens appuis ne sont pas retenus. 58 citations exactes sont sélectionnées pour les thèmes et polarités disposant de preuves actuelles, dont huit pour les recommandations.

## Diagnostic des 199 appréciations GPT-6

Ces appréciations IA ont été produites après observation de V2.1. Leurs proportions ne sont pas représentatives, ni indépendantes. Elles ne sont pas importées par le moteur de règles : seul le module de comparaison lit ces jugements. Aucune justification GPT-6 n'est inventée quand le fichier source n'en contient pas.

| Appréciation GPT-6 | V3 soutient | V3 ne soutient pas | V3 indécise |
|---|---:|---:|---:|
| Justifiée (92) | 35 | 0 | 57 |
| Non justifiée (77) | 2 | 32 | 43 |
| Ambiguë (30) | 2 | 6 | 22 |

| Groupe V2.1 | V3 soutient | V3 ne soutient pas | V3 indécise |
|---|---:|---:|---:|
| 65 exclusions | 9 | 32 | 24 |
| 80 indécisions équilibrées | 10 | 3 | 67 |
| 32 indécisions ciblées | 3 | 3 | 26 |
| 22 contrôles acceptés | 17 | 0 | 5 |

22 associations de ces 199 cas sont récupérées depuis un état non soutenu ou indécis : 18 jugées justifiées par GPT-6, deux jugées non justifiées et deux ambiguës. Les deux désaccords avec les rejets GPT-6 et les expressions implicites encore indécises doivent être examinés ; aucune conclusion de supériorité générale n'est produite.

## Quatre actions prévisualisées

1. Service : revoir les délais de service signalés. Avis `abd11d0a-bfe8-4b7e-a4b7-97cd9329fc4d` (« Slow service, inflated prices. ») et `ba68820e-c18f-4884-9116-b9d2bd2d88bd` (« I took off stars for the long wait. »).
2. Qualité : revoir les plats dont le goût ou la qualité sont explicitement critiqués. Avis `f5a5c1d3-57ba-4ea9-a05b-f0bfd340d7d6` (« Food was okay not great ») et `cfee6877-2b70-4d9b-a89a-74281de86b63` (« the food was completely tasteless. »). La première citation exprime une critique modérée ; elle n'est pas reformulée comme un défaut grave.
3. Prix : examiner le rapport entre prestation reçue et prix payé. Avis `ba15e553-cdf3-4bc3-ab83-229cd9a5f176` (« The prices and service were not in line. ») et `0d20403f-5d47-4884-a475-408867bf1aec` (« the food is absolutely not worth the money, and the quality of the preparation leaves much to be desired. »).
4. Ambiance / emplacement : examiner les retours sur distance et déplacement. Avis `7e728070-b75a-42ab-bb78-e8075b2d4922` (« The downside is that it's a long drive. ») et `aa345d54-d968-454b-8caf-cb1d51e0fe29` (« Accessibility isn't the best since you have to take a taxi from downtown Nha Trang, »). Aucune conclusion sur un manque de signalisation.

Chaque action est soutenue uniquement au sens du filtre déterministe. Les symptômes rapportés restent un signal de diagnostic distinct sans causalité médicale déduite et sans 26e thème.

## Nouveau contrôle réservé

Contrôle : `3988aa10-0c5c-4a52-b1ff-1b576b488c52`, SHA256 `418c0f1a2dccea8bd5f29ce046dcc57a35d645710231ed540cd38dcb1ccb4391`.

40 avis et associations uniques, sélectionnés parmi 743 associations sur 244 avis, après exclusion des 147 avis présents dans l'audit de 199 cas. Ordre déterministe SHA256, priorité aux strates rares et aux cas V2.1 difficiles. Les identifiants ont été figés avant toute annotation IA supplémentaire. Aucune réponse de référence n'existe.

| Axe | Positif | Négatif |
|---|---:|---:|
| Service | 5 | 4 |
| Qualité | 8 | 5 |
| Prix | 5 | 5 |
| Ambiance | 6 | 2 |

La disponibilité réelle et l'exigence de 40 avis distincts empêchent d'obtenir cinq cas par strate. Le pool Ambiance négatif contient trois associations mais seulement deux avis sélectionnables distincts. Ce contrôle est nouveau par rapport aux 199 cas ; il appartient toujours au corpus historique Artisan et ne prouve pas une généralisation à un corpus indépendant.

L'export destiné à ChatGPT masque les polarités proposées, les prédictions et les statuts V2.1/V3. Il contient le texte anglais, le thème à vérifier et leurs empreintes, avec `choice: null`. De futures réponses doivent être enregistrées séparément ; elles ne deviendront pas un Gold humain.

## Accès et stockage

Plus / Thêm → Test Jev → Rapport pilote → Audit des preuves → V3.

Tables `analysis_jev_pilot_evidence_v3` et `analysis_jev_pilot_evidence_v3_controls`, immuables, RLS pour owner/admin/manager de la même organisation. RPC d'écriture réservée au service serveur, verrou transactionnel et unicité par audit source/empreinte de règles. Aucun droit anonyme, aucune écriture directe authentifiée. Rechargement et retour PWA lisent l'audit déjà persisté.

## Vérifications

Tests synthétiques des 25 thèmes, régressions Artisan signalées, entités, polarités, négations, contradictions, temporalité, problème résolu, citations/empreintes, recommandations, contrôle réservé, export aveugle, autorisation, lecture sans écriture, idempotence et actions payantes bloquées. Tests SQL avec rollback : RLS, cross-tenant, privilèges, immutabilité, idempotence, hashes, référence vide, huit liens précis aux actions.

Résultats : 1 334 tests Vitest sur 140 fichiers réussis, dont 69 nouveaux tests V3 ; deux tests Deno sans accès réseau ; contrôles de types et lint Deno des cinq modules serveur ; lint et build frontend réussis. Quatre tests Playwright réussis couvrent FR/VI, rechargement, export et absence de trafic fournisseur sur 360/390/430 px et iPad 768 px. L'Edge Function déployée refuse une requête sans authentification avec HTTP 401.

Contrôle des 80 tables historiques avant/après : aucune empreinte changée. Seules les deux nouvelles tables V3 sont ajoutées. Le fichier GPT-6, les configurations V12/V13, les traductions et le rapport historique restent inchangés.

Coût supplémentaire fournisseur : **0 USD**. Aucun appel JEV, Sol, OpenAI ou Apify.
