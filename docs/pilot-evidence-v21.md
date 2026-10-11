# Contrôle des preuves V2.1 — expérimental

Source inchangée : audit V2 `43125297-4933-4621-bd19-b2b25837c3f4`, snapshot Artisan
`f9c8876b-1b5a-4d10-9538-758881b61b6b`, rapport Sol terminé
`cfaf1fb1-34d8-4797-9678-65ebce027b44`. Nouvel audit séparé :
`854ae975-7a7e-4a73-ae9e-d2f4807d046a`.

## Règles distinctes

Version **pilot-evidence-explicit-v2.1**, vérificateur **explicit-evidence-rules-v2.1**.
SHA256 : `83b69811fd43bc28050f17686530aa2fc4d21b36dbf6562f20ad61d7d23fac45`.
La V2 originale et son empreinte `8334b14f…` restent intactes.

Les règles sont copiées dans un nouveau module ; aucun fichier de configuration JEV
V12/V13 ni seuil n'est modifié. Le recalcul ne rappelle aucun fournisseur.

- Professionnalisme : plus d'appui à partir de excellent/great/top-notch service seuls.
  Une compétence, connaissance, sérieux ou conduite professionnelle explicite est requise.
  Les deux avis réels `00e5621d…` et `5a974b40…` deviennent des preuves exclues pour ce thème.
- Une action utile mais dont la compétence reste ambiguë demeure `review_needed`.
- Les qualités des boissons et des plats sont rattachées à leur entité dans la phrase,
  sans transférer le qualificatif de café à food_quality. Les formulations alimentaires
  réellement positives et les pluriels restent admissibles.
- Un prix élevé seul n'établit pas un mauvais rapport qualité/prix. La comparaison
  explicite de prestation/quantité/qualité au prix, ou une appréciation de valeur, reste admise.
- Communication et attention restent séparées ; emplacement, distance et accès ont des
  conclusions distinctes. Un emplacement jugé peu impressionnant peut être apprécié
  négativement sans justifier un conseil sur l'accès.
- Négations, hypothèses et cas incertains restent contrôlés. Le statut `unsupported_by_rule`
  exclut une association comme preuve, jamais le finding JEV historique.

## Résultats calculés sur les mêmes données

422 avis, **1 580 associations JEV inchangées**.

| État de la preuve | V2 | V2.1 |
|---|---:|---:|
| Soutenue par règle explicite | 445 | 438 |
| Exclue par une frontière explicite | Statut non présent | 65 |
| À réexaminer | 1 135 | 1 077 |

Sur les 445 appuis V2 : **396 conservés**, **30 exclus**, **19 désormais incertains**.
**42 nouveaux appuis explicites** sont reconnus parmi les cas V2 à revoir.
438 = 396 + 42 ; 445 = 396 + 30 + 19 ; 1 580 = 438 + 65 + 1 077.

Les **huit extraits V2 valides sont conservés à l'identique** : mêmes avis, thèmes,
polarités, textes, bornes et empreintes. Leur conservation exige une nouvelle vérification
V2.1, y compris sur la citation elle-même ; aucun maintien forcé d'une preuve invalide.

Ces compteurs mesurent des décisions du filtre de preuves. Ils ne constituent pas une
précision de JEV, une validation humaine ou une validation IA indépendante. Le filtre
lexical peut laisser des reformulations pertinentes à réexaminer.

## Prévisualisation déterministe

Les trois couches sont séparées : statistiques JEV inchangées, preuves contrôlées selon
les règles, puis interprétation et recommandations du catalogue.

Quatre nouvelles recommandations sont proposées, une par axe, avec **deux preuves requises
par recommandation**. Les conseils portent sur attente/attention, qualité gustative,
niveau des prix/valeur et distance/ambiance. Ils n'inventent ni manque de compétence,
ni problème d'accès ni causalité à partir d'une autre catégorie.

Le registre des preuves requises est conservé : retirer un seul extrait ou appui rend
la recommandation `review_needed` et masque ses actions. La prévisualisation vérifie
de nouveau les empreintes et le soutien textuel ; elle ne repose pas sur un booléen ancien.

Les **quatre recommandations du rapport Sol existant restent non entièrement justifiées
par leurs citations**. Elles ne sont ni remplacées ni certifiées rétroactivement. Aucun
nouveau rapport Sol n'est généré et aucun nouveau rédacteur n'est activé.

## Stockage, sécurité et accès

Nouvelle table immuable `analysis_jev_pilot_evidence_v21`, liée à l'audit V2 et à son hash.
RPC privée `save_pilot_evidence_v21` : contrôles organisationnels, hashes, comptages,
identités des réponses et maintien exact des extraits sélectionnés. RLS owner/admin/manager
de l'organisation ; aucun accès anonyme ni écriture du navigateur. Idempotence par parent/règles.
Les fonctions, contraintes et enregistrements V2 ne sont pas modifiés.

Endpoint `jev-pilot-evidence-v21` : GET readonly, POST `audit_free` uniquement, aucune voie
payante. Rechargement/PWA restaurent l'état ; double clic bloqué. Le bouton Sol reste désactivé.

Chemin : **Plus / Thêm → Test Jev → Rapport pilote → Audit des preuves V2 → Voir la correction
V2.1**. La V2 historique reste consultable. FR/VI, comparaison des états, huit extraits,
recommandations liées et provenance.

## Vérifications

**1 265 tests Vitest réussis**, dont 40 tests V2.1 ajoutés ; trois tests Deno hors réseau,
tests SQL/RLS, lint/build et quatre scénarios mobiles FR/VI réussis.

- Cas réels et SHA256, service général vs professionnalisme explicite, compétence/knowledge,
  ambiguïtés, boissons/plats, prix/valeur, emplacement/accès, négations et hypothèses.
- V2 inchangée ; conservation exacte des huit citations ; métriques cohérentes et mêmes
  statistiques/cache/rapport ; pas de recommandation fondée si une preuve manque.
- Tests API : lecture sans création, recalcul gratuit manuel, rejet d'action payante, rôles.
- SQL/RLS rollback, immutabilité, idempotence, contrôle de portée et intégrité des empreintes.
- Deno sans réseau, lint, build ; FR/VI à 360/390/430/768 px, rechargement, zéro overflow
  et aucune requête fournisseur.
- Empreintes des **79 tables existantes** avant/après identiques, y compris l'audit V2,
  les 422 analyses, le rapport Sol, les benchmarks et les traductions.
