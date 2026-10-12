# OpenAI Decisions — préparation expérimentale gratuite

Version `openai-decisions-exploratory-v1`. Expérience `73a7bfe9-c618-4e2f-aa82-3b0fae8eb989`. Aucun fournisseur appelé, aucune autorisation de dépense et aucun job payant. L'expérimentation et la production restent désactivées.

## Faisabilité vérifiée dans la documentation officielle

[Guide Decisions](https://developers.openai.com/api/docs/guides/decisions), [contrat TypeScript](https://developers.openai.com/api/reference/typescript/resources/decisions/methods/create), consultés le 12 octobre 2026. Endpoint dédié `POST /v1/decisions`, modèle demandé conservé `gpt-6-luna`. Les questions indépendantes peuvent partager une entrée ; `choice` fournit choix, confiance et distribution, `predicate` une probabilité. Les refus sont conservés. Decisions ne fournit pas de texte narratif, citation extraite ou justification libre : ces fonctions restent distinctes.

Le service est annoncé en bêta publique. L'accès de ce compte, les limites effectives pour 25/50 questions et la version servie ne sont pas vérifiés : aucun appel de contrôle n'a été effectué. Aucun SDK OpenAI, client réseau ou clé API n'est nécessaire pour cette préparation. Les tarifs Decisions sont spécifiques à cet endpoint ; ne pas les appliquer à Responses.

## Données anciennes en lecture seule

Jeu `e544eea5-1c9d-4b68-909e-38b68061e85f` : 32 textes anglais, 800 annotations GPT-6 scellées, **16 incertaines**, soit 784 choix comparables. Les empreintes des originaux, traductions figées, références et configurations sont contrôlées avec `verifyCompactSeal`. La configuration A complète est `v12_economy_1pass_v1` ; B compacte n'est pas utilisée. Les 32 tâches A sont complètes, avec texte SHA256 identique et 25 thèmes valides. Leur modèle servi est `jev-1.13.0`. Aucune traduction corrigée n'est appliquée rétroactivement.

Les références et réponses JEV ont été comparées à leur export initial après préparation : identiques. Aucune ancienne table n'est modifiée par les migrations ou la RPC gratuite. V11/V12/V13, moteur économique, audits, rapports et pipeline hybride sont inchangés.

## Configurations nouvelles

- `luna-decisions-choice-v1` : une requête par avis, 25 questions, options absent/positive/negative/both. Chaque instruction et description d'option provient exactement de V12 complet.
- `luna-decisions-predicate-v1` : une requête par avis, 50 questions, deux conditions par thème. Les probabilités marginales sont conservées séparément ; aucune probabilité conjointe `both` n'est inventée.
- `luna-decisions-evidence-choice-v1` : une question supported/unsupported/uncertain par association, avec texte anglais complet et définition V12 correspondante.

Seuils distincts `luna-decisions-thresholds-v1`, provisoires et non ajustés aux références : Choice conserve le choix natif mais s'abstient si confiance < 0,60 ; Predicate utilise 0,50 avec une zone d'incertitude inclusive 0,45–0,55. Une polarité certaine reste exploitable quand l'autre est incertaine. Les seuils JEV restent figés.

Les payloads de classification contiennent uniquement l'alias, le texte analytique anglais et les questions. Aucune étoile, sous-note, langue originale, texte original, prédiction concurrente ou référence GPT-6 n'est transmise. Les questions respectent les frontières V12 et les règles de négation, mélange de polarités et causalité médicale. Une copie indépendante permet le versionnement sans modifier les instructions historiques.

## Mesures

Le code prépare TP/FP/FN, précision/rappel/F1 négatif, positif et global, macro-F1 avec support >= 3, 25 thèmes, quatre axes, accord exact et cas mixtes. Les true negatives ne contribuent pas au F1. Les références incertaines sont exclues ; les abstentions de prédiction restent visibles et peuvent compter comme critiques non détectées. Les scores sélectifs présentent séparément leur couverture. Brier, ECE et confiance native sont des diagnostics contre références IA. Bootstrap apparié par avis : 2 000 tirages, seed SHA256 déterministe ; cas sans support non concluants. Un seul passage ne permet aucune mesure de stabilité entre répétitions.

Baseline JEV recalculée, sans nouvel appel : F1 négatif 0,846561 (TP 80 / FP 20 / FN 9 ; support 89), F1 positif 0,833333 (TP 60 / FP 16 / FN 8 ; support 68), micro-F1 global 0,840841. Ce sont des résultats exploratoires contre références IA, pas une performance validée humainement. Tous les résultats Luna restent absents.

## Estimation économique

Tarifs : JEV 0,042 USD/million d'entrée (run enregistré et tarif fourni) ; Decisions standard 0,10 USD/million d'entrée et zéro charge de sortie/cache selon le guide. Les suppléments régionaux/de contexte long sont signalés et non vérifiés.

La tokenisation locale `o200k_base` compte le JSON préparé avec marge de 12 % et 128 tokens de cadrage. Le sérialiseur facturé et le tokeniseur du modèle ne sont pas vérifiés. **Ces chiffres ne sont pas des tokens facturés ni un coût réellement payé.**

| Mode, 32 avis | Entrée | Nature | Coût d'entrée |
|---|---:|---|---:|
| JEV complet existant | 272 289 | Mesuré historiquement | 0,011436138 USD |
| Luna Choice | 275 112 | Estimé localement | 0,0275112 USD |
| Luna Predicate | 510 869 | Estimé localement | 0,0510869 USD |

La réutilisation JEV coûte zéro supplémentaire. Choice + Predicate : au maximum 64 nouvelles évaluations futures, coût standard estimé 0,0785981 USD. Pas de répétition ni retry payant automatique.

À tarifs constants, rentabilité si `tokens_Luna <= 0,42 × tokens_JEV`. Sur ce jeu : 114 361,38 tokens au total, environ **3 574 par avis**. Les estimations actuelles sont 8 597 (Choice) et 15 965 (Predicate) par avis. Aucune économie n'est démontrée avec ces instructions complètes. Une éventuelle différence de qualité ou latence reste à mesurer.

| Volume, extrapolation de ces 32 avis | Choice estimé | Predicate estimé |
|---|---:|---:|
| 100 | 0,0859725 USD | 0,1596466 USD |
| 500 | 0,4298625 USD | 0,7982328 USD |
| 1 000 | 0,859725 USD | 1,5964656 USD |

## Vérification de preuves et architectures

Les 40 cas du contrôle `3988aa10-0c5c-4a52-b1ff-1b576b488c52` et leurs références déjà figées sont relus sans modification. Quatre références incertaines sont exclues des futures métriques binaires. Le contrôle a déjà été utilisé ; il s'agit d'un diagnostic rétrospectif, jamais d'une nouvelle validation indépendante. L'ancien V3 accepte cinq bonnes associations, aucune mauvaise, rejette une bonne et laisse 32 cas sans décision. Ses résultats sont repris de l'évaluation immuable, pas réécrits.

40 requêtes de vérification futures : **0,0023527 USD estimé**. Aucun résultat Decisions n'existe. Un jugement sur une association ne crée pas une citation exacte ou une explication ; extraction, empreintes et rédaction doivent rester contrôlées séparément.

Illustration 32 avis et 25 vérifications de preuves (pas une comparaison de rapports exécutés) :

- JEV déjà mémorisé → Decisions → Sol : 0 + environ 0,0014704 USD + Sol.
- JEV nouveau au coût observé de ce jeu → Decisions → Sol : environ 0,0129066 USD + Sol.
- Decisions Choice → Sol : environ 0,0275112 USD + Sol.
- Decisions Predicate → Sol : environ 0,0510869 USD + Sol.

Le coût Sol et les résultats complets de ces architectures restent inconnus ; le coût ancien du rapport hybride n'est pas réutilisé. Les 32 avis et les 40 cas appartiennent à deux jeux distincts : aucune généralisation ou comparaison appariée de bout en bout n'est revendiquée.

## Stockage, interface et tests

Quatre tables nouvelles `analysis_decisions_experiments`, `analysis_decisions_configurations`, `analysis_decisions_tasks`, `analysis_decisions_results`. RLS owner/admin/manager de la même organisation ; accès anonyme/écriture authentifiée refusés, sauvegarde serveur contrôlant sceau et textes, idempotence et immutabilité. Trois configurations et une seule préparation ; zéro tâche, résultat ou autorisation payante. Les tâches sont verrouillées en état blocked, compteur zéro. L'ouverture du connecteur et des autorisations fera l'objet d'une future livraison explicitement autorisée.

Accès : **Plus / Thêm → Test Jev → OpenAI Decisions — Test expérimental** (`/plus/decisions-experiment`). FR/VI, baseline réelle JEV, coûts estimés, deux usages, limites, reprise par lecture serveur. Les trois boutons payants restent désactivés. GET uniquement ; tout POST est refusé avant traitement. Aucun fournisseur ou clé n'est chargé par ce lecteur.

Tests : 1 421 cas unitaires / 147 fichiers, dont 28 nouveaux ; deux tests Deno avec réseau interdit ; Deno check/lint ; SQL/RLS/immutabilité/idempotence en transaction annulée ; lint/build ; huit scénarios FR/VI 360/390/430/iPad 768, aucun overflow ni trafic fournisseur. Les fixtures navigateur sont explicitement des mocks et ne contiennent aucune prédiction Luna présentée comme réelle.

**Coût fournisseur supplémentaire réel de cette mission : zéro. Aucune activation en production.**
