# HOME Reviews — Contrôle Luna sur 48 avis multilingues stratifiés (préparation manuelle, aucun appel payant)

## Travail déjà terminé et vérifié

Un **nouveau** jeu source, non comparé directement aux benchmarks JEV/Decisions anglais précédents, est scellé en base avec ses annotations GPT-6 AI-only.

- Organisation : `93228bbb-6397-41e3-b8be-21ee7060eda7`.
- Set ID : `a125ba0e-e4b0-49ca-83c8-1e52a27bd2be` ; version `luna-native-balanced48-v1`.
- SHA256 canonique du manifeste : `5f0aeb92cf1d27890d447cd4ed9c6ab2f297773ad9b736912db44593c998caca`.
- Annotation seal ID : `24883941-e3bc-4759-9af6-d21bd62413f9`.
- SHA256 canonique des références : `ba06732a224c7f34b68208551abcc88d5d6c42b9713c32663d44df3e37df7781`.
- Fichiers déjà publiés : `docs/luna-native-balanced48-source-v1-20261012.json`, `docs/luna-native-balanced48-gpt6-ai-references-20261012.json` ; migration `20261012231500_luna_native_balanced48_storage.sql`.
- Tables RLS **immutables** : `analysis_luna_balanced_sets`, `analysis_luna_balanced_cases`, `analysis_luna_balanced_reference_seals`, `analysis_luna_balanced_references`.
- Dataset : **48 avis uniques / 12 restaurants**, étoiles 9×1★, 6×2★, 5×3★, 12×4★, 16×5★. **20 avis 1–3★**, **12 avis 4★**, **16 avis 5★**. Axes : Qualité 16, Service 14, Prix 9, Ambiance 9.
- Langues sources : russe 23, vietnamien 13, coréen 9, français 1, japonais 1, anglais 1. **Ne pas convertir en anglais ni traduire rétroactivement**.
- Propositions de thèmes et polarités **déterministes** depuis règles lexicales multilingues ou probes par SHA ; elles ne sont pas des prédictions JEV. 36 ancrages textuels, 12 probes, 16 polarités négatives et 32 positives.
- Références GPT-6 AI-only, scellées **après les propositions et avant toute prédiction Luna** : 18 positives, 12 négatives, 1 mixte, 16 absentes, 1 incertaine. Selon la polarité proposée, 21 associations justifiées, 26 non justifiées, 1 incertaine.
- Limite critique : seulement **4 propositions justifiées parmi les 20 avis 1–3★**, parce que le sélecteur a aussi créé des sondes difficiles ou attribué une polarité opposée. Ce jeu teste surtout la **vérification/rejet de preuves**, il **ne mesure pas le rappel global des critiques**. Un futur jeu distinct riche en véritables critiques négatives sera nécessaire ; ne pas sélectionner d'autres propositions après consultation des références.
- Vérifications faites avant scellement : 48 SHA256 texte exacts, aucun doublon de review ID et aucun chevauchement dans JEV cache, jeux compacts, gold, validation négative, anciennes tâches Luna/holdout vérifiées. Les textes d'origine sont stockés en base avec RLS, **pas dans GitHub public**.
- Origine du benchmark : ChatGPT GPT-6, annotations partiellement aveugles (la distribution globale par étoile était connue, pas les polarités par avis). **Pas de Gold humain**, et aptitude multilingue différente de l'ancien test Luna sur des avis traduits anglais.
- Sur ces 48 : **zéro nouvelle tentative JEV, Luna, Sol, OpenAI API ou Apify**. Les anciennes exécutions Luna ne doivent jamais être rappelées.

## Nouvelle tâche technique — séparée, uniquement préparatoire

Créer une expérience `luna-native-balanced48-run-v1` qui **réutilise** l'architecture anti-retry/durable du précédent `openai-decisions-evidence40-run-v1` et de `process-luna-multirest`, sans toucher aux jobs ou résultats existants.

1. Auditer et valider à chaque PREVIEW et START côté serveur les IDs, le sceau source et de référence, les 48 textes natifs et les empreintes en `analysis_luna_balanced_cases`. Refuser si le source vivant diverge du snapshot scellé ; ne **jamais** envoyer les références GPT-6 à Luna.
2. Modèle futur `gpt-6-luna`, `POST /v1/decisions`, un seul `choice` supported/unsupported/uncertain pour thème+polarité par avis. Le texte envoyé est **l'original en russe/vietnamien/coréen/etc.** et les instructions de frontière du thème peuvent rester en anglais. Aucune étoile, jugement GPT-6, sortie JEV, prédiction précédente, prénom du client ou secret n'est envoyé.
3. Maximum **48 appels**, une seule tentative par cas ; **aucune répétition automatique** en cas de timeout, échec ou HTTP 429, 5xx, et aucun fallback Responses/JEV/Sol. Enregistrer `billing_uncertain` quand la facture est inconnue ; pas de deuxième déclenchement. Une tâche est réservée et marquée dispatched **avant** le seul appel HTTP. Protéger les doubles clics, tâches concurrentes et pertes de réseau iPhone.
4. Réaliser d'abord la préparation **gratuite** du manifeste des 48 requêtes et de leur coût. Recalculer les tokens localement sans les appeler "facturés". Tarif Decisions `0,10 USD/million de tokens d'entrée` sous réserve de suppléments applicables ; montant à confirmer manuellement plus tard.
5. Nouvelle entrée UI FR/VI iPhone : `Plus / Thêm → Test JEV → OpenAI Decisions → Test multilingue équilibré (48 avis)`. Détail étoiles/langues/axes et mise en garde : natif ≠ anglais, 21 propositions justifiées seulement. Actions "Prévisualiser gratuitement" et **confirmation du coût distincte sur iPhone** pour un futur lancement. **Ne pas déclencher de dépense pendant Codex**.
6. Après la confirmation manuelle uniquement, l'Edge Function côté serveur utilisera les secrets existants et le modèle indiqué ; max une requête par cas. Sauvegarder réponse brute, choix, probabilities/confidence, refus, usage, modèle réellement servi, identifiants/latences, coût calculé au tarif connu, SHA256 de requête/réponse et erreur technique sans exposer les secrets.
7. Après réussite ou état terminal : comparer contre les 47 références évaluables, sans inclure le 1 `uncertain` dans la matrice. Couverture, abstentions, TP/FP/FN/TN, précision sélective, rappel de preuves justifiées, étoiles (1–3/4/5), axes, thème, langue originale, restaurant, temps et coût. **Aucun comparatif JEV inventé** ; aucune conclusion de précision générale ou production.
8. Protéger les tables historiques et ces 4 tables scellées ; nouvelles tables distinctes pour plans/runs/tasks/events/results. RLS owner/admin/manager, service role, immutabilité et idempotence. Tester avec `SET LOCAL ROLE service_role`, pas de lecture SQL directe `auth.users`. Interdire l'exécution si le modèle bêta n'est pas disponible, sans fallback.
9. Tests : Deno/provider mock sans réseau, SQL/RLS/contrôle des SHA, fermetures iPhone, concurrence/anti-double paiement, 48 positions, FR/VI Playwright (iPhone + iPad), lint/build. Aucun appel payant depuis tests, migration ou déploiement.
10. **Le GO antérieur de ChatGPT autorise seulement cette préparation**. N'ouvrir aucune dépense à partir d'une mutation SQL, d'une page GET, d'un cron ou du déploiement. Le lancement Luna appartient exclusivement à l'utilisateur après affichage/confirmation explicite du coût dans l'app.

Livrable Codex : en français, architecture, préparation gratuite, estimation de coût et taille native, contrôle source/references, code/RLS/Edge, tests/CI, écran iPhone, et **zéro nouvel appel IA payant pendant ce travail**. Ne pas relancer les 39 anciens appels Luna, ne pas modifier V11/V12/V13, la V1 JEV économique ou les rapports Sol.
