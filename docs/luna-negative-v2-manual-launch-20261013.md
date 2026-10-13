# Lancement manuel du contrôle Luna V2

Le lancement reste une action humaine distincte dans l'application. Ce développement ne constitue aucune autorisation de dépense et ne lance aucun benchmark.

## Sources immuables

- Jeu : `c8b3eee7-2554-43d9-a16b-5e12413af793`.
- Scellement GPT-6 : `c4031dc6-e0a3-4992-bb35-f790ecccd034`.
- Dataset SHA256 : `6e464e2f0fa13ae1f83168b65a04e3de3e396fc0c1150d08ba71e8e30b008189`.
- Référence SHA256 : `048df28c19e95a25e426ebb08fbb58665634027f85906712072b94e788818592`.
- Configuration inchangée : `luna-negative-focused-v2-choice-v1`, SHA256 `beb203a8c28cd68be8e556807d9b51cd096083d69734ed0692732440398bef4f`.
- 28 avis uniques, 13 restaurants, 32 associations et références. Une référence incertaine reste conservée et exclue des métriques binaires : 31 associations évaluables.

Les sources, textes, associations, références, organisations, établissements, empreintes et configuration sont vérifiés côté serveur et SQL avant la prévisualisation, la confirmation et le traitement. Les textes live ne remplacent jamais le snapshot.

## Exécution et coût

`luna-negative-v2-manual-run-v1` reprend le mécanisme Luna multi-restaurants : workers durables, verrouillage transactionnel, réservation avant envoi, authentification serveur, RLS et suivi de l'usage. Les tables et fonctions V2 restent distinctes de native48 et des autres expériences.

Un appel natif `POST https://api.openai.com/v1/decisions`, modèle `gpt-6-luna`, par avis. Maximum **28 tentatives**. Les quatre avis à deux questions utilisent une seule requête ; réponses `supported/unsupported/uncertain`, identifiants de questions uniques. Aucun résultat humain/IA, texte original ou rating Google dans le payload. Aucun appel JEV, Sol, Responses ou Apify.

Le recalcul local du dossier relu depuis Supabase donne **19 038 tokens d'entrée estimés**, soit **0,0019038 USD** au tarif standard configuré de 0,10 USD / million ; sortie gratuite. L'estimation initiale du snapshot était 19 000 tokens / 0,0019000 USD. La marge de l'estimateur et la sérialisation des requêtes expliquent ce léger écart. Les nouveaux montants sont affichés avant consentement et enregistrés dans le plan. Aucun plafond monétaire supplémentaire.

Il s'agit d'une estimation, pas d'une facture garantie. Suppléments régionaux/long contexte non vérifiés ; le coût futur est calculé depuis l'usage effectivement rapporté. Télémétrie absente : coût total inconnu, avec sous-total connu séparé. [Documentation officielle Decisions](https://developers.openai.com/api/docs/guides/decisions).

## Parcours iPhone / iPad

Plus / Thêm → Test Jev → OpenAI Decisions → **Contrôle Luna V2 — Critiques**.

1. Lire le nombre d'avis/questions, le modèle, l'estimation et les limites.
2. **Prévisualiser gratuitement et vérifier le coût** : enregistrement idempotent d'un plan, aucun run ni appel fournisseur.
3. **Confirmer le coût et lancer Luna V2** : action séparée, consentement versionné `luna-negative-v2-cost-confirmation-v1` et création transactionnelle d'un seul run / 28 tâches.
4. Suivre la progression ou fermer l'appareil. Le worker initial et le scheduler reprennent uniquement les tâches jamais envoyées.
5. Consulter les résultats et les cas à vérifier. Une réponse réseau ambiguë nécessite d'abord une lecture de l'état serveur ; aucun resend automatique.

La clé OpenAI est configurée côté serveur et absente du navigateur. Un utilisateur doit être actif et owner/admin/manager de l'organisation. Le worker scheduler exige le secret serveur existant. GET, reprise d'affichage, déploiement et prévisualisation ne lancent aucun appel IA. Le scheduler est conditionné à l'existence d'un run confirmé, en attente/en cours.

## Stockage et absence de doublons

Nouvelles tables : `analysis_luna_negative_v2_plans`, `runs`, `tasks`, `events`, `results`.
Un run unique par plan ; une tâche unique par avis ; `request_count` vaut 0 ou 1. Verrouillage et `SKIP LOCKED` avant dispatch. Les états terminaux ne sont pas réouverts. Timeout, erreur réseau, réponse perdue, HTTP 429/500 ou parsing invalide : réservation consommée, aucune répétition payante. Refus d'accès/modèle : arrêt des tâches non envoyées, sans API alternative.

Une requête à deux questions produit deux lignes `results` liées à **la même tâche**. Tokens, latence, coût et réponse brute sont conservés au niveau requête ; les résultats par question conservent le choix natif, choix interprété, probabilités, confiance, refus, thème, polarité, IDs et empreintes. Leur jointure avec la tâche restitue la télémétrie sans la facturer ni l'additionner deux fois.

## Mesures exploratoires

Précision sélective, rappel des preuves justifiées, TP/FP/FN/TN, abstentions, réponses manquantes, couverture ; sous-ensemble des associations négatives ; résultats par thème, axe et restaurant ; probabilités et calibration. Les bonnes preuves laissées incertaines ou sans réponse restent dans le dénominateur du rappel. Les labels GPT-6 incertains sont exclus des métriques binaires.

Bootstrap déterministe de 2 000 rééchantillonnages **par avis**, regroupant toutes ses questions. Les références GPT-6 sont IA, pas Gold humain. Le contrôle ne mesure pas l'extraction exhaustive des critiques, ni leur prévalence : 28 avis dont seulement 4 notés 1–4 étoiles, sélection enrichie en cas difficiles. Aucune comparaison JEV inventée et aucune activation dans les rapports commerciaux.

## Vérification technique

- 1 563 tests unitaires sur 156 fichiers, tous réussis.
- 5 tests Deno sans réseau, contrôles Deno check/lint.
- 16 tests mobiles FR/VI de lancement/résultats/reprise : 360, 390, 430 px et iPad 768×1024 ; zéro requête fournisseur et aucun débordement. Les 8 contrôles de préparation précédents passent également.
- SQL réel avec réponses simulées et **rollback** : confirmations idempotentes, coût/identité incorrects refusés, réservation, maximum 28, 32 résultats distincts, usage compté 28 fois, pas de retry, réponse terminale immuable, séparation des organisations et ACL.
- ESLint et build réussis. Aucune alerte de sécurité du linter sur le nouveau périmètre ; index des clés étrangères composites ajoutés sur les nouvelles tables.
- Fonctions `luna-negative-v2` et `process-luna-negative-v2` déployées ; requêtes non authentifiées : HTTP 401.
- Empreintes des 129 tables existantes inchangées après migrations/tests : annotations et données historiques préservées.

État vérifié après déploiement backend : **0 plan, 0 run, 0 tâche, 0 événement de consentement, 0 résultat V2**. Les 32 références et leur scellement unique sont inchangés. Aucun appel payant effectué. Le premier run attend la confirmation de l'utilisateur dans l'application.
