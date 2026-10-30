# Comparaison privée de sélection assistée par IA

La page `/#/plus/recommandations` conserve sa recherche déterministe et ajoute
un bouton explicite FR/VI de comparaison. Aucun appel au chargement, au changement
de filtre, ni via « Proposer des restaurants ». Aucun raccordement HOME AI.

## Modèle et données

Version : `recommendation-ai-reference-selection-v1`. Modèle : `gpt-6.1-sol`,
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
il ne remplace pas les contrôles d'exigences. Il est projeté localement sur un
vocabulaire fermé FR/VI/EN issu des caractéristiques connues et des trois rubriques.
Seuls ces codes, jamais le texte libre, sont transmis. Les négations et détails
non reconnus ne sont pas interprétés, et l'écran affiche les critères reconnus.
Cette limite de V1 est explicite : aucune promesse d'interprétation libre générale.
Aucune géolocalisation. Prix sans
unité confirmée admis sans budget, mais jamais confirmés pour un budget/personne.

La fiche envoyée contient uniquement l'identifiant du candidat et des faits
typés : scores figés, cuisines normalisées, fourchette/devise/unité, caractéristiques
Google et observations reconnues par le moteur, signaux positifs/réserves par
rubrique du rapport, références, date et fraîcheur. Le nombre de références est
fourni sans en déduire une fréquence de clients ou une gravité. Aucune prose des
avis/rapports, nom de personne, contact, adresse, description commerciale ou photo.
Les points thématiques fins qui ne sont pas structurés ne sont pas transmis :
cette limite protège les données personnelles et évite d'inventer des thèmes.
Le champ utilisateur refuse contacts, liens et caractères de contrôle ; l'écran
demande de ne pas y saisir de données personnelles. Les noms éventuellement saisis
ne peuvent pas être transmis, puisqu'aucun fragment de texte libre n'est envoyé.

## Justifications contrôlables

L'IA renvoie au plus trois identifiants, une ou deux références de justification
et une référence de vigilance si elle existe. Elle ne renvoie ni score modifié,
ni affirmation libre. Le serveur vérifie l'identité, les doublons, l'appartenance
des références au candidat et leur polarité. Il restitue leurs libellés FR/VI
fidèles. Les sources restent rattachées au même rapport/corpus que les scores.
Une réserve ne peut servir de raison positive. Un signal Google contradictoire
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

Une empreinte lie configuration/prompts/modèle, demande normalisée, langue,
données, organisation, utilisateur et accès. La réservation durable précède le
seul envoi HTTP. Un verrou transactionnel sérialise la réservation ; une seule
comparaison en vol par organisation. Doubles clics, reconnexions et appels concurrents
rejoignent la tentative. Une réservation abandonnée est traitée comme inconnue
après deux minutes. Elle ne peut jamais être renvoyée avec la même empreinte.
Une autre demande peut être tentée après ce délai, sans rejouer la précédente.

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

Tests hors réseau : moteur commun et limite vingt, budgets/unités, contraintes
inconnues, références étrangères, doublons, polarité et vigilance, cache, accès,
réponse tardive, interruption, quota HTTP, reçu non sauvegardé. Tests PostgreSQL
locaux des droits, réservations, concurrence, consommation et réexécution. Tests
mobile FR/VI 390 et 360 px avec réponses simulées et réseau externe bloqué.

Après CI : intégrer le commit, appliquer **uniquement** cette migration, déployer
`test-restaurant-recommendations` avec JWT vérifié et ses dépendances, puis Pages.
Vérifier les sources/versions, le refus sans authentification et zéro nouvelle
tentative de comparaison. Ne jamais cliquer « Comparer avec l'IA » en production
pour valider cette livraison : les premiers appels réels seront ceux de l'utilisateur.

Retour arrière : masquer le bouton et redéployer l'ancienne fonction de lecture.
Conserver la table de tentatives pour préserver les consommations/inconnus ; ne
pas supprimer les empreintes pour forcer une nouvelle tentative. Aucun avis,
rapport, score, import ou réglage de génération n'est modifié par cette option.
