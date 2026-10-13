# Contrôle Luna V2 — Critiques

Version : `luna-negative-focused-v2`. Préparation gratuite, séparée des anciens contrôles. Aucun appel fournisseur, job payant, autorisation de dépense ou activation de production.

## Sélection et indépendance

Organisation autorisée : `93228bbb-6397-41e3-b8be-21ee7060eda7`.
Le contrôle examine les UUID présents dans toutes les colonnes et dans les tableaux **et clés** JSON de 122 tables `analysis_*`, `historical_*` et `jev_benchmark*`. Les UUID sont ensuite rapprochés des avis de cette organisation. Cette exclusion est volontairement conservatrice : une ancienne sélection réservée ou une mention dans un snapshot suffit à exclure un avis, même sans appel JEV. Les 39 documents historiques du dépôt ont également été recherchés ; aucun de leurs UUID ne correspond à un candidat restant.

Les prédictions et jugements historiques ne participent jamais au classement des nouveaux candidats. Le classement favorise le restaurant ayant le moins d'avis déjà retenus, puis SHA256(organization_id + version + review_id). Les groupes sont disjoints : jusqu'à 8 avis 1–4 étoiles, 12 avis 5 étoiles potentiellement mixtes, 12 contrôles positifs 5 étoiles. Un groupe insuffisant reste incomplet.

La recherche de critiques combine des expressions ciblées et la structure déterministe V3 existante. Ce n'est pas une annotation ni une compréhension sémantique complète. Les contrôles positifs comprennent trois sondes de polarité opposée sur un thème ancré, afin de tester le refus des preuves insuffisantes ; aucune réponse attendue n'est enregistrée. Les thèmes sont choisis avant toute référence GPT-6.

## Sources et conservation

Le résolveur anglais existant est utilisé à la frontière des nouvelles données. Les avis ayant déjà un override de traduction sont exclus par l'audit historique ; aucun override ni traduction n'est modifié. Une source `original_en` ou `google_translation_en` est exigée, avec exclusion conservatrice des scripts mélangés, phrases non anglaises connues et textes dont la langue est incertaine. Cette protection ne certifie pas la fidélité d'une traduction.

Le nouveau snapshot conserve original, texte anglais, identifiants, provenance, dates fournisseur, empreintes UTF-8 SHA256, strates, sélection, associations, instructions complètes V12 et requêtes regroupées. Les sources et références sont immuables. La transaction de scellement revérifie les avis, l'organisation, la traduction actuelle, les empreintes et les chevauchements.

## Questions et coûts

Une ou deux questions `choice` par avis : `supported`, `unsupported`, `uncertain`. Deux associations d'un même avis utilisent **une** requête future `POST /v1/decisions`, entrée commune `{review_alias, analysis_text}`. Aucun rating, original, jugement GPT-6 ou résultat JEV dans cette entrée. Les noms de questions sont uniques et liés au snapshot. Modèle demandé : `gpt-6-luna`, un passage sans retry automatique. Les 25 définitions complètes V12 sont inchangées.

L'estimation locale utilise le tokenizer existant avec marge et framing, à 0,10 USD / million de tokens d'entrée. Sortie gratuite ; suppléments régionaux/long contexte non vérifiés. Elle ne constitue pas une facture. Voir la [documentation officielle Decisions](https://developers.openai.com/api/docs/guides/decisions).

## Références et mesures futures

Export aveugle : uniquement `review_id`, `analysis_text`, `theme_key`, `analysis_text_sha256`, une entrée par association. Les annotations seront réalisées séparément dans ChatGPT. Aucune classification préremplie. L'import exige une entrée unique par couple avis/thème, la même empreinte, un choix `absent/positive/negative/both/uncertain` et une justification. Le scellement précède toute future prédiction.

Une référence est soutenue quand son choix correspond à la polarité candidate ou à `both`. Une référence `uncertain` est conservée, mais exclue des métriques binaires. Les abstentions Luna sont distinguées des rejets. Le rappel utilise toutes les références soutenues, y compris celles manquées ou laissées incertaines ; la précision sélective utilise les seules acceptations. Aucun true-negative artificiel dans un F1. Le rappel des critiques est séparé, limité aux associations négatives proposées, sans prétendre mesurer l'extraction de tous les thèmes d'un avis.

Les intervalles à 95 % sont préparés avec 2 000 bootstrap **par avis**, toutes ses associations étant tirées ensemble. Résultats par thème, axe et restaurant, probabilités/calibration et coûts par décision préparés. Aucune mesure n'existe encore. Les références GPT-6 restent des appréciations IA, pas une vérité humaine indépendante.

## Accès et sécurité

Plus / Thêm → Test Jev → OpenAI Decisions → Contrôle Luna V2 — Critiques.
Lecture authentifiée owner/admin/manager, RLS par organisation. Le navigateur ne possède aucune clé API. Les RPC de scellement sont réservées au service serveur, avec contrôle de rôle. GET et reprise navigateur lisent seulement les sources ; aucune création automatique. Les actions `launch`, `confirm_launch`, `wake` et `retry` sont refusées par ce nouvel endpoint. Une nouvelle autorisation et confirmation manuelle du coût sur iPhone seront nécessaires pour développer/activer le lancement ultérieur.
