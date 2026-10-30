# Comparaison privée de sélection assistée par IA

> Historique V2, remplacé pour les nouvelles comparaisons par [les fiches de rapport V3](private-recommendation-report-facts-v3.md). Les descriptions ci-dessous de l'absence de prose transmise et du marqueur `free_text_v2` concernent exclusivement l'ancienne version.

La page `/#/plus/recommandations` conserve sa recherche déterministe et ajoute
un bouton explicite FR/VI de comparaison. Aucun appel au chargement, au changement
de filtre, ni via « Proposer des restaurants ». Aucun raccordement HOME AI.

## Modèle et données

Version : `recommendation-ai-free-text-reference-selection-v2`. Modèle : `gpt-6.1-sol`,
Responses API, effort faible, sortie JSON stricte, `store:false`, aucun outil,
1 800 tokens de sortie maximum, HTTP borné à 45 secondes. L'accès serveur existant
est réutilisé ; aucune clé dans le navigateur. Ce modèle déjà accessible dans le
projet permet de tester une sélection multilingue structurée sans modifier les
modèles, consignes ou parcours des rapports. Ce choix ne constitue pas une mesure
de qualité, de latence ou de coût sur cette fonctionnalité.

Documentation vérifiée le 30 octobre 2026 :
- https://developers.openai.com/api/docs/models/gpt-6.1-sol
- https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses

Le même moteur applique les droits, la validité, les bandes exactes de scores,
le départage par service et la diversité des prix. Son algorithme commun s'arrête
à trois résultats normalement, et à vingt pour la présélection privée. Les trois
premiers restent identiques. Aucun second classement déterministe. L'IA peut
choisir un autre ordre selon les préférences parmi ces seuls candidats.

Cuisine, budget VND par personne et caractéristiques obligatoires cochées sont
des contraintes serveur. Une donnée absente ou contradictoire ne les valide pas.
Le texte libre est explicitement une **préférence**, limité à 500 caractères ;
il ne remplace pas les contrôles d'exigences. **La demande entière est transmise**
dans `natural_language_request`, sans filtrage par mots-clés, suppression de négation
ou vocabulaire d'entrée fermé. Accents, ponctuation et paragraphes sont préservés
(trim/NFC uniquement). Le modèle doit interpréter portée des négations, nuances,
alternatives, priorités et conditions. Les instructions techniques restent séparées
du JSON utilisateur. Comprendre une préférence ne crée pas une preuve : un besoin
non documenté ne peut pas être présenté comme satisfait.
Le bouton actualisé envoie `preference_mode:'free_text_v2'`. Une ancienne page
en cache, dont l'information de confidentialité disait que le texte n'était pas
transmis, est refusée avec HTTP 409 **avant lecture du catalogue, réservation et
appel**. L'utilisateur doit actualiser la page ; les recherches classiques restent
compatibles. Ce marqueur ne remplace jamais les contrôles d'authentification/droits.
Aucune géolocalisation. Prix sans
unité confirmée admis sans budget, mais jamais confirmés pour un budget/personne.

La fiche candidat envoyée contient uniquement l'identifiant du candidat et des faits
typés : scores figés, cuisines normalisées, fourchette/devise/unité, caractéristiques
Google déjà normalisées et observations reconnues par le moteur, signaux positifs/réserves par
rubrique du rapport, références, date et fraîcheur. Le nombre de références est
fourni sans en déduire une fréquence de clients ou une gravité. Aucune prose des
avis/rapports, nom de personne, contact, adresse, description commerciale ou photo.
Les caractéristiques déjà normalisées (musique en direct, terrasse, etc.) ne sont
plus limitées aux neuf choix du formulaire obligatoire. Cela élargit les faits
disponibles sans ajouter de nouveau classement ni inférer de caractéristique.
La provenance est mutualisée par fiche ; les références natives restent côté
serveur. Le dossier demeure limité à vingt candidats et 200 000 octets de requête
complète, sortie exclue, très en dessous du contexte documenté du modèle. Dépassement :
repli sans appel ni troncature. Un cas synthétique de vingt fiches riches est vérifié.
Les points thématiques fins qui ne sont pas structurés ne sont pas transmis :
cette limite protège les données personnelles et évite d'inventer des thèmes.
Le champ utilisateur est distinct de ces fiches : il est transmis uniquement au
clic explicite. Les contacts, liens, présentations nominatives explicites et
caractères de contrôle dangereux sont refusés côté serveur **avant réservation**,
y compris si le helper est appelé directement. L'écran demande de n'inclure aucune
donnée personnelle. Ces contrôles locaux ne constituent pas un détecteur universel
de noms dans du texte libre. Aucune identité de compte ni prose d'avis/rapport
n'est ajoutée à la demande. Les identifiants natifs de preuves restent côté serveur ;
le modèle utilise leurs références de faits, avec type/date de source.

`store:false` empêche le stockage applicatif demandé via Responses ; ce paramètre
n'est pas une garantie générale de rétention fournisseur nulle. Aucun réglage de
compte OpenAI n'est modifié (voir https://developers.openai.com/api/docs/guides/your-data).

## Justifications contrôlables

L'IA renvoie au plus trois identifiants, une ou deux références de justification
et une référence de vigilance si elle existe. Elle ne renvoie ni score modifié,
ni affirmation libre. Le serveur vérifie l'identité, les doublons, l'appartenance
des références au candidat et leur polarité. Il restitue leurs libellés FR/VI
fidèles. Les sources restent rattachées au même rapport/corpus que les scores.
Une réserve ne peut servir de raison positive. Une caractéristique explicitement
négative peut étayer une préférence d'évitement ; son libellé conserve le « non »,
sans en déduire une propriété opposée. Un signal Google contradictoire
ne peut devenir une exigence confirmée. Les données et préférences sont déclarées
non fiables dans les consignes ; aucun outil n'est disponible au modèle.

Un rapport `CORPUS_CHANGED` reste daté et utilisable selon la règle existante.
Les autorisations, la langue et le catalogue sont relus avant restitution. En
cas de changement, la réponse n'est pas présentée ; aucune nouvelle tentative IA.
Cette validation structurelle ne prouve pas l'optimalité de l'adéquation choisie.

## Tentative, cache et mesures

La migration `20261030042203_private_recommendation_ai_comparison.sql` crée une
table dans `private`, avec RLS et aucun accès anon/authenticated. Deux RPC à droits
d'invocateur sont exécutables uniquement par `service_role` pour réserver puis
finaliser. Les données de catalogue continuent à être lues par le client utilisateur
et ses RLS, jamais par l'admin. L'appartenance est aussi vérifiée à la réservation.

Une empreinte lie configuration/prompts/modèle, **texte entier** normalisé, langue,
données, organisation, utilisateur et accès. La réservation durable précède le
seul envoi HTTP. Un verrou transactionnel sérialise la réservation ; une seule
comparaison en vol par organisation. Doubles clics, reconnexions et appels concurrents
rejoignent la tentative. Une réservation abandonnée est traitée comme inconnue
après deux minutes. Elle ne peut jamais être renvoyée avec la même empreinte.
Une autre demande peut être tentée après ce délai, sans rejouer la précédente.
Les variantes « je cherche le calme », « je ne cherche pas le calme » et « pas
forcément le calme » ont des empreintes différentes. La version V2 ne réutilise
pas les réponses V1 qui avaient perdu une partie du texte. Les anciennes tentatives,
y compris inconnues, restent conservées, sans purge ni renvoi.

Le cache conserve seulement les identifiants/références validés et les mesures,
aucun texte de préférence ni requête/réponse complète. Les échecs, invalides et
inconnus restent consommés. Une erreur d'enregistrement du reçu ne permet aucun
renvoi payant. Aucun retry, polling, worker ni tâche périodique ajouté. Une nouvelle
comparaison après changement de critères/données peut coûter un nouvel appel.

Les reçus privés et journaux techniques conservent modèle servi, tokens natifs
entrée/sortie/cache lorsqu'ils existent, identifiant fournisseur, durée HTTP et
coût seulement s'il est réellement retourné. Un champ absent reste inconnu.
Aucun tarif supposé ni facture vérifiée. Un résultat réutilisé affiche les mesures
de sa tentative initiale, sans nouvelle consommation.

## Validation et déploiement

Tests hors réseau : transmission exacte FR/VI/EN/autres langues, négations,
conditions, paragraphes, injection laissée dans les données, absence du texte
dans cache/journaux, moteur commun et limite vingt, budgets/unités, contraintes
inconnues, références étrangères, doublons, polarité et vigilance, cache, accès,
réponse tardive, interruption, quota HTTP, reçu non sauvegardé. Tests PostgreSQL
locaux des droits, réservations, concurrence, consommation et réexécution. Tests
mobile FR/VI 390 et 360 px avec réponses simulées et réseau externe bloqué.
Ils vérifient le raccordement et les protections, **pas la qualité réelle de la
compréhension du modèle** : aucun appel IA n'est exécuté pendant cette livraison.

La migration V1 existe déjà ; **aucune nouvelle migration n'est nécessaire** pour
le texte libre V2. Après CI : intégrer le commit, déployer
`test-restaurant-recommendations` avec JWT vérifié et ses dépendances, puis Pages.
Vérifier les sources/versions, le refus sans authentification et zéro nouvelle
tentative de comparaison. Ne jamais cliquer « Comparer avec l'IA » en production
pour valider cette livraison : les premiers appels réels seront ceux de l'utilisateur.

Retour arrière : masquer le bouton et redéployer l'ancienne fonction de lecture.
Conserver la table de tentatives pour préserver les consommations/inconnus ; ne
pas supprimer les empreintes pour forcer une nouvelle tentative. Aucun avis,
rapport, score, import ou réglage de génération n'est modifié par cette option.
## Affichage des références choisies

The provider selects IDs and reason/caution references, not free-form explanations. `renderChoices` resolves those validated references against the same proposal's saved sources after selection, including on a compatible cache hit. It never changes the request, selector, scores, native choices or attempt ownership.

Report excerpts are bound by report ID, section, index and evidence IDs; every matching excerpt remains accessible in Details. The primary excerpt is the first saved point of that selected category, not a newly generated AI justification. Cautions and Details use the selected reference rather than an unrelated first reservation. The UI does not add a caution when the selection has none.

Google declarations retain their raw label, field, observation date and an identity-matching Maps link when available. A quiet declaration is attributed to Google, not to reviews or an acoustic measurement. A count of report points/evidence references does not establish recurring incidents. A missing or incompatible detailed source stays unavailable; it is not silently replaced.

Completed, cached, pending and fallback results have explicit localized origin labels. Cached usage refers to the original native receipt, not new consumption. A privacy-safe response log records attempt ID/status/model/candidate count for future provenance. Historical cache hits before this instrumentation cannot be reconstructed from the native receipt alone. No preference text or source prose is added to these logs or provider requests.

Unit/mobile fixtures use synthetic data and mocked replies. Private saved-response replays and nominative audits remain outside the repository. They establish presentation/source fidelity, not semantic suitability of the model's choices.
