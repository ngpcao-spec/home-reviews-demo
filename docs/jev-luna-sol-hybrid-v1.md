# Préparation expérimentale JEV + Luna + Sol V1

Version : `jev-luna-sol-hybrid-v1`. Aucune autorisation de dépense ; aucun fournisseur appelé.

## Architecture et interfaces auditées

La source est le plan vietnamien équilibré `71e46e6f-0c95-4d0e-840f-618c3f66e85d`, version `jev-hybrid-evidence-report-v1.1-balanced`, snapshot `f9c8876b-1b5a-4d10-9538-758881b61b6b`.

Le module indépendant `jev-luna-sol.ts` réutilise les interfaces de `jev-hybrid-balanced`, les empreintes et estimations locales de `jev-hybrid-evidence`, les questions complètes V12 et le parseur natif de `decisions-config`, le tokenizer de `decisions-preparation`, le catalogue d’actions et les contrôles structurés de `pilot-evidence-v3`. Les anciens composants et leurs règles restent inchangés. Le worker pilote et le générateur narratif ont été examinés ; leurs dispatchs payants ne sont pas importés dans ce parcours.

La préparation vérifie le snapshot, les citations, les offsets UTF-16, les contextes, le thème, la polarité et les empreintes du dossier source. Un adaptateur en mémoire prend en charge l’ordre des clés JSONB sans modifier le plan V1.1. Les 422 cache fingerprints sont vérifiés en SQL : organisation, établissement, review ID, texte, configuration, instructions, seuils, modèle, statut completed, 25 résultats et empreinte de la réponse.

Luna reçoit le texte anglais complet une seule fois par avis et les questions concernant ses citations. Son payload ne contient ni notes Google, ni prédictions JEV, ni annotations GPT-6, ni provenance des audits. Les définitions V12 sont conservées ; des instructions supplémentaires, versionnées et propres à la vérification des citations, demandent une preuve explicite et distinguent notamment le professionnalisme des compliments généraux. Cela ne modifie pas l’extraction JEV historique.

Le parseur conserve la décision native, les probabilités, la confiance, le modèle servi, l’usage et le SHA256 de la réponse. Le seuil expérimental 0,60 reste celui des benchmarks Luna. Une confiance insuffisante, une ambiguïté ou un refus conduit à UNCERTAIN. Une réponse invalide ou un modèle inattendu ne déclenche aucune nouvelle tentative.

Le dossier Sol définitif exige des décisions complètes et correctement rattachées. Il contient seulement les preuves ACCEPTED. REJECTED et UNCERTAIN restent dans l’audit, sans changer les comptages JEV. Les métadonnées de provenance sont conservées, mais les traductions remplacées et les opinions d’audits antérieurs ne sont pas transmises à Sol. La provenance complète reste dans le plan immuable.

Sol est préparé pour un appel `gpt-6.1-sol`, reasoning low, rédaction seulement, sans reclassification JEV. JSON structuré : Service, Qualité, Prix, Ambiance, aspects positifs, aspects négatifs, conclusion et recommandations. Le schéma reprend les composants du rapport hybride et retire les verdicts sémantiques Sol : cette vérification relève désormais de Luna.

La validation finale refuse les IDs inventés, les mutations des empreintes, les chiffres libres, les axes incohérents et les citations modifiées. Une affirmation utilisant une preuve rejetée ou incertaine est masquée et marquée review_needed. Les recommandations utilisent un catalogue borné, vérifié contre le thème, la polarité et une action textuelle précise dans la citation. L’incertitude de V3 ne rejette pas une preuve acceptée par Luna ; elle peut laisser l’action recommandée à réexaminer. Ce contrôle déterministe ne prouve pas toute la sémantique d’un texte libre.

## Artisan : préparation réelle et gratuite

- Google annoncé dans le snapshot : 1 615 avis ; stockés : 523 ; avec texte : 424 ; analysés : 422.
- 422 résultats réutilisables, modèle JEV servi `jev-1.13.0`, configuration complète V12 économique.
- 25 citations, 24 avis distincts, 14 thèmes, 15 critiques et 10 appréciations positives.
- Par étoiles : 3 / 3 / 5 / 3 / 11. Onze citations issues d’avis 1–3 étoiles.
- Qualité : 6 positives / 6 négatives ; Service : 2 / 4 ; Prix : 1 / 4 ; Ambiance : 1 / 1.
- Les 25 preuves sont rule_confirmed. Aucune n’a été évaluée par Luna dans cette expérience.
- 25 questions regroupées en 24 requêtes futures maximum ; un seul appel Sol futur ; zéro nouvel appel JEV.

Les fréquences restent calculées sur les 422 avis analysés, jamais sur les seules citations. Le dossier diversifié n’est pas un échantillon statistiquement représentatif des avis Google.

## Estimations recalculées

| Étape | Tokens estimés entrée / sortie | Coût USD prévu |
|---|---:|---:|
| JEV réutilisé | Aucun nouvel usage | 0 |
| Luna groupé | 22 835 / 0 | 0,0022835 |
| Sol, si les 25 preuves sont acceptées | 18 679 / 3 800 | 0,075358 |
| Total conditionnel | — | 0,0776415 |
| Estimation haute, sortie Sol 9 500 | — | 0,1346415 |

Dossier Sol conditionnel : 51 866 octets. Budget d’entrée Sol : 20 000 tokens ; il n’est pas augmenté. Tarifs persistés : Luna 0,10 USD/M entrée ; Sol 2 USD/M entrée et 10 USD/M sortie. Apify et traduction : tarifs non disponibles, pas inventés. L’ancienne estimation Sol V1.1, relue depuis le plan, est 0,087816 USD ; les payloads et hypothèses de sortie diffèrent, donc aucune économie facturée n’est démontrée.

Les tokens sont des estimations locales o200k_base avec marge et framing. Les éventuels suppléments régionaux ou de contexte sont non vérifiés. Les coûts réels sont inconnus. L’estimation définitive Sol devra être recalculée sur les seuls ACCEPTED, puis autorisée séparément. Documentation officielle du format groupé : [Decisions](https://developers.openai.com/api/docs/guides/decisions).

## Stockage et sécurité

Tables indépendantes : `analysis_jev_luna_sol_plans`, `runs`, `tasks`, `verdicts`, `results`, `events` (même préfixe). Plans, verdicts, résultats et événements sont immuables. RLS owner/admin/manager par organisation ; clés étrangères composites interdisant les associations entre organisations ; aucun secret frontend. Le GET authentifié résout l’établissement sélectionné via le client RLS avant de lire ses plans. Il ne dépend pas d’un ancien benchmark d’une autre organisation.

`save_jls_preparation` est SECURITY INVOKER, accessible exclusivement à service_role, pour une opération d’administration gratuite et identifiable. Il verrouille et retourne le même plan lors d’une répétition. Il ne crée ni run, ni tâche, ni consentement.

Le schéma durable réserve une tâche Luna unique par review/run, une tâche Sol unique par run, compte de tentative limité à un, budget Luna correspondant au plan et aucune relance automatique. Les contrats de worker sont exercés exclusivement par des mocks explicites. `start_jls_run`, `claim_jls_task`, les triggers d’exécution et `process-jev-luna-sol-hybrid` refusent toute exécution payante, même en présence d’anciennes autorisations ou de clés API. Aucun cron n’est installé.

Une future activation demandera une autorisation distincte, liée au plan et aux empreintes, avec identité autorisée, source de consentement, expiration et périmètre limité. La délégation Codex est prévue dans le contrat et le schéma ; aucune délégation de dépense n’est créée ici. Le dispatch fournisseur et la réservation transactionnelle restent volontairement non branchés tant qu’une mission d’activation n’est pas autorisée.

## Interface et validation technique

Plus / Thêm → Test Jev → Rapport hybride JEV + Luna + Sol. Route : `/#/plus/jev-luna-sol`. Établissement sélectionnable dans les données de l’organisation actuelle. Lecture des citations et des textes complets, distribution par étoiles, axes et thèmes, statistiques globales, coûts, export gratuit des payloads et prévisualisation conditionnelle Sol. Bouton de génération désactivé. Rechargement et retour au premier plan relisent uniquement les plans persistants.

Tests : suite complète de 1 599 tests réussie avant l’ajout du test de provenance ; 33 tests ciblés finaux, Deno hors réseau, SQL/RLS transactionnels annulés, huit tests mobiles FR/VI (360, 390, 430, iPad 768), lint, build, Deno check/lint. Tous les fournisseurs sont simulés. Ces tests techniques ne sont pas une nouvelle validation indépendante de la qualité de Luna.

Les empreintes et compteurs de préparation sont dans `jev-luna-sol-hybrid-v1-summary.json`. Les prévisualisations sont les seuls nouveaux objets de données ; les analyses, rapports, audits, références et configurations historiques restent protégés.

## Déploiement technique

Migration Supabase `20261014001441_jev_luna_sol_hybrid_preparation` appliquée. Fonctions `jev-luna-sol-hybrid` et `process-jev-luna-sol-hybrid` déployées en version 1. Contrôles HTTP réels : lecture sans authentification refusée (401), lancement POST refusé (405), worker fermé (403). Aucun nouvel avis de sécurité Supabase sur les composants ajoutés.

Prévisualisation FR : `1b2fdd29-9447-4de3-a134-084dd13ddc49` ; VI : `5295245f-b2c1-4f5d-80ad-ca9f821ae3da`. Deux plans gratuits persistés, zéro run, tâche, verdict, rapport ou consentement de dépense.
