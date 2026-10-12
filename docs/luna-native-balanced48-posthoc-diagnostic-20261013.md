# HOME Reviews — Diagnostic postérieur au test Luna multilingue 48

> Diagnostic GPT-6 dans ChatGPT à partir des données Supabase vérifiées le 13 octobre 2026. **N'est pas une validation humaine indépendante** et ne modifie ni les références GPT-6 scellées ni les sorties Luna. Aucun nouveau fournisseur appelé.

## Traçabilité, intégrité, coût

- Repo: `ngpcao-spec/home-reviews-demo`; commit exécutant `ddd2d05fcc15c65bd7651530c5ada6efa890f38b`, CI réussi.
- Set source `a125ba0e-e4b0-49ca-83c8-1e52a27bd2be`; sceau de références IA `24883941-e3bc-4759-9af6-d21bd62413f9`. Source natif original (RU 23, VI 13, KO 9, FR 1, JA 1, EN 1); 12 restaurants, étoiles 9×1, 6×2, 5×3, 12×4, 16×5.
- Run `18592287-79ce-4db2-a55f-2b3e04f17348`; `status=completed`, consentement `user_directive_codex_delegation` avec opérateur Codex, exécuté une fois entre 00:55 et 01:00 heure du Vietnam, 13/10/2026.
- 48/48 réponses completed ; 48 positions et 48 avis uniques ; **48 attempts, zéro retry, zéro échec, zéro facturation incertaine**. Modèle réellement servi `gpt-6-luna` ; méthode `choice`, un seul thème/polarité proposé par avis ; ni JEV ni Sol relancés.
- Entrée 24 975 tokens, sortie 0. Estimation préalable : 0,0031544 USD ; **coût calculé par usage x tarif standard** : 0,0024975 USD. Montant réellement facturé non audité. SHA du résultat `bc4ecbf75b461130ecf53326e12254881c89cd7659e498dc3c4a799c75b16e82` vérifié dans Supabase.

## Score par comparaison aux références GPT-6 préalablement scellées

- 48 cas, **47 références binaires évaluables**, 1 `uncertain` exclue des métriques.
- **18 TP, 3 FP, 19 TN, 0 FN parmi les décisions** ; 7 abstentions supplémentaires : **3 cas justifiés** et **4 non justifiés** restent sans décision.
- Précision des preuves acceptées : **18/(18+3) = 85,7 %**.
- Rappel des preuves justifiées avec abstentions comptées comme manquées : **18/21 = 85,7 %**. Ne **pas** interpréter FN=0 comme rappel 100 %.
- Couverture de décisions sur références évaluables : **40/47 = 85,1 %**. Accord des décisions : 37/40 = 92,5 %. F1 de vérification : 0,857.
- Pour 16 propositions de polarité négative : 5 TP, 1 FP, 7 TN, 3 abstentions ; précision 83,3 %. **Ce sous-groupe n'évalue pas la découverte de toutes les critiques négatives**.
- Ces évaluations portent sur **un thème/polarité candidate** proposé par un sélecteur heuristique ; ce ne sont **pas des prédictions JEV** et elles ne valident pas le rappel des 25 thèmes ni la précision globale d'un rapport HOME Reviews.

## Onze cas à inspecter — erreurs, abstentions, référence indécise

Les extraits intégraux demeurent sous RLS en Supabase ; ce diagnostic GitHub n'expose pas leurs textes complets.

### Trois faux positifs (`Luna = supported` alors que référence IA = unsupported)

| Position | Thème/polarité proposés | Signal d'erreur textuelle | P(supported) |
|---|---|---|---:|
| **14** | `freshness:positive` (russe, 2★) | Un sashimi décrit comme **congelé et non frais** : inversion de polarité. | 0,77 |
| **20** | `communication:negative` (coréen, 3★) | « Aucun problème de communication » : négation explicite ignorée. | 0,79 |
| **37** | `temperature:positive` (russe, 5★) | « Hotpot » est un nom de plat ; climatisation de la salle ≠ température de service prouvée. | 0,76 |

Ce sont des erreurs de frontière sémantique sur lesquelles un garde-fou de cohérence avant rapport doit porter. **Ne pas** utiliser ce même jeu pour ajuster les règles puis le déclarer indépendant.

### Sept abstentions finales (seuil de confiance, pas toujours choix natif `uncertain`)

| Position | Thème/polarité proposés | Référence IA | Évaluation du diagnostic |
|---|---|---|---|
| **8** | `food_quality:positive` (russe) | Non justifié | Critique explicite du goût ; abstention prudente plutôt que fausse acceptation. |
| **11** | `billing:positive` (russe) | Non justifié | Dispute sur une remise après problème de ramen ; prudence acceptable. |
| **13** | `friendly_staff:negative` (vietnamien + anglais) | Non justifié | Personnel explicitement apprécié malgré critique des plats ; prudence acceptable. |
| **16** | `friendly_staff:positive` (russe) | Justifié | Personnel qualifié de poli ; bonne preuve non retenue. |
| **22** | `atmosphere:negative` (russe) | Non justifié | Atmosphère appréciée, nourriture critiquée ; abstention prudente. |
| **25** | `food_quality:negative` (coréen) | Justifié (référence `both`) | Appréciations différentes pour deux plats (3/5 et 5/5) ; polarité mixte, à interpréter avec nuance. |
| **29** | `professionalism:positive` (vietnamien) | Justifié | Personnel enthousiaste et serviable selon le texte ; ambiguïté de frontière avec simple amabilité / service général à conserver. |

La nature exacte du verdict final est parfois due à un **filtre de confiance**, même lorsque la réponse native Luna était `supported` ou `unsupported` : ne pas confondre cette abstention avec un verdict natif du fournisseur.

### Une référence GPT-6 `uncertain`, exclue du score

- **19**, `food_quality:positive`, coréen (3★). La fraîcheur est reconnue mais le goût décrit comme ordinaire ; qualification de jugement positif de qualité reste ambiguë. Luna dit `unsupported`, sans score binaire imputé.

## Résultats par langue (petits échantillons)

- Russe, 23 cas : 10 TP / 2 FP / 7 TN / 4 abstentions ; précision des acceptations 83,3 %.
- Vietnamien, 13 cas : 5 TP / 0 FP / 6 TN / 2 abstentions ; précision 100 % (sur 5 acceptations).
- Coréen, 9 cas dont 1 référence incertaine : 3 TP / 1 FP / 3 TN / 1 abstention ; précision 75 % (sur 4 acceptations).
- Anglais, français et japonais : 1 cas chacun, tous rejets corrects, insuffisant pour conclusion par langue.

## Décision

**GO uniquement pour poursuivre l'expérimentation, NO GO pour production/autonomie sans surveillance.**

Le coût par vérification est très bas ; les trois faux positifs montrent qu'une décision confiante peut contredire une négation, une entité ou une polarité. Conserver JEV V12 comme moteur de thèmes, Luna comme deuxième vérificateur expérimental, et la validation déterministe des citations + recommandations.

### Prochaine évaluation utile et véritablement représentative de l'architecture visée

Préparer un **nouveau jeu** d'avis **avec classifications JEV V12 préexistantes** sur des restaurants différents, en suréchantillonnant des critiques explicites. Prélever les paires thème/polarité **avant** annotation GPT-6, conserver les empreintes du texte anglais réellement analysé par JEV, et figer les données avant d'appeler Luna. Mesurer coût par preuve et effet réel sur faux positifs, sans modifier les seuils sur les jeux déjà évalués. Si les seuls JEV préexistants sont des échantillons déjà utilisés ou quasi tous positifs, **ne pas appeler JEV automatiquement** : documenter la limite et demander un budget dédié avant toute nouvelle analyse.

Une vérification/rédaction par Sol dans le **même appel** ne constitue pas une validation indépendante. Ne pas mettre en production les nouvelles expérimentations ni modifier les archives V11/V12/V13, JEV, Luna ou Sol. Aucun nouvel appel payant requis pour ce diagnostic.
