# JEV V13 — développement ciblé

Configuration immuable: `themes_v13_targeted_recall_v1`. C'est une configuration d'analyse, pas un modèle fournisseur. Modèle demandé `jev-latest`; 25 thèmes, quatre choix, 3 répétitions, concurrence 8, seuils identiques à V12.

Instructions V12 copiées indépendamment. Les neuf ajustements ciblent cooking/préparation (dont dosage, assaisonnement et défauts de recette), cleanliness/hygiène, variety/indisponibilité, location/déplacement, value, attentiveness, consistency, atmosphere et price_level. Les autres questions restent identiques. Les symptômes et nuisibles rapportés déclenchent un diagnostic distinct, jamais une causalité médicale ou un 26e thème.

Les 19 audits et les 14 textes correspondants ont été lus. Tests: 19 cas courts inventés, plus séparation des thèmes, payloads, invariants, métriques, contrôles API/SQL, worker et reprise mobile. Les tests sans fournisseur vérifient des contrats d'instructions et l'implémentation; ils ne prouvent pas le comportement réel de Jev.

## Sources de développement

- Premier replay: V12 `1b06d0d9-623b-4ee4-b267-d1078a2aaa74`, 30 avis, 90 réponses V12 réutilisées et 90 nouvelles évaluations V13 après confirmation.
- Deuxième replay: `696e6e36-a024-4f69-957e-9cd4e0b50d1b`, cohorte appariée initiale de 31 avis parmi 32, 93 réponses V12 réutilisées et 93 évaluations V13 après confirmation. V12 a 32 avis complets, mais la cohorte est volontairement maintenue à 31 pour rester comparable au précédent V11/V12.
- Les références principales restent celles des sources existantes. Les 19 décisions post-prédictions restent séparées dans le replay diagnostique: 15 erreurs probables, 2 corrections IA de référence et 2 ambiguïtés exclues. Aucune annotation scellée ni score historique n'est réécrit.
- Les deux jeux sont explicitement des données de développement pour V13, jamais une validation indépendante de généralisation.

Tables nouvelles `analysis_jev_v13_*`: configurations, sealed_inputs (vide), runs, tasks et results. RLS owner/admin/manager; écritures serveur seulement. Configuration, sources scellées et résultats sont immuables. Double lancement réutilise le run existant. Le worker tourne après fermeture de la PWA; il ne renvoie jamais une requête payante ambiguë. Cron ne fait aucun appel lorsqu'aucun run n'est en attente.

Le circuit futur sait lire un nouveau jeu IA scellé après gel de la configuration et avant toute prédiction, dans une seule organisation, sans avis déjà utilisés ni avis Artisan. Il lance alors V12/V13 sur les mêmes textes, après confirmation (32 avis = 192 requêtes). Aucun futur jeu n'est enregistré durant ce développement.

Métriques: précision/rappel/F1 positif et négatif, micro/macro (support >=3), quatre axes, 25 thèmes, FP/FN potentiels, stabilité, avis suspects, modèle servi, coût/tokens/durée, réponses invalides. Bootstrap apparié par avis, 2000 rééchantillonnages, bornes nulles lorsque incomplet/non calculable. Une différence de modèle fournisseur est signalée. Aucun changement automatique de production.

Chemin: Plus / Thêm → Test Jev → JEV V13 — Test expérimental → choisir premier/deuxième jeu → Lancer le test V13 → confirmer le coût.

## Inventaire uniquement en lecture — 10 octobre 2026

Périmètre: organisation Artisan `93228bbb-6397-41e3-b8be-21ee7060eda7`; rôle owner vérifié sur l'acteur des runs existants. Artisan exclu. Les IDs déjà présents dans benchmarks, Gold, annotations, audits, usages de calibration et snapshots Jev historiques sont exclus. Aucun texte ni prédiction Jev du futur jeu n'a été lu. Les compteurs exigent le texte original conservé et une version originale anglaise ou une traduction anglaise fournisseur non vide. Aucun import ni traduction n'est lancé.

| Établissement | Inutilisés 1–3★, avec original | Inutilisés 4★, avec original | Prêts EN 1–3★ | Prêts EN 4★ | Sans EN, 1–4★ |
|---|---:|---:|---:|---:|---:|
| The Home Pizza Phu Quoc | 7 | 8 | 1 | 6 | 8 |
| Xóm Mới Garden | 35 | 18 | 4 | 2 | 47 |
| Cilantro Restaurant 2 | 7 | 2 | 3 | 1 | 5 |
| Làng Ngon Corner - Vietnamese Cuisine | 23 | 5 | 3 | 0 | 25 |
| The Home Pizza Nha Trang | 18 | 6 | 3 | 0 | 21 |
| Luong Son Cang Restaurant | 7 | 2 | 1 | 1 | 7 |
| Green Home Dining | 9 | 3 | 1 | 0 | 11 |
| Green Home Restaurant | 1 | 10 | 0 | 1 | 10 |
| Nhà hàng Nha Trang xưa | 6 | 3 | 1 | 0 | 8 |
| Green Home | 4 | 3 | 0 | 0 | 7 |
| K.HOUSE Restaurant | 7 | 1 | 0 | 0 | 8 |
| Mai Hương Restaurant - Nha Trang | 5 | 5 | 0 | 0 | 10 |
| Shabu Ssam BBQ Restaurant | 0 | 0 | 0 | 0 | 0 |

Il existe 17 négatifs 1–3★ + 11 mitigés 4★ prêts en anglais, soit 28, et largement assez de contrôles 5★ (hors Shabu également). Proposition sans traduction: **17 / 11 / 4**, 32 avis répartis entre plusieurs établissements autorisés de cette même organisation; 4 contrôles peuvent être pris dans les établissements de l'échantillon. Autre composition possible 20 / 8 / 4, mais elle exigerait au moins 3 avis négatifs anglais supplémentaires et une action explicitement autorisée. Au total, 167 avis inutilisés 1–4★ avec original conservé n'ont pas de version anglaise.

Il ne s'agit que d'une proposition de quotas. Aucun review_id du troisième jeu n'est sélectionné ou figé, aucun holdout ni label n'est créé. L'annotation IA aveugle du prochain jeu est une étape séparée, préalable aux prédictions. L'échantillon surreprésente les avis négatifs et ne mesure pas leur fréquence réelle.
