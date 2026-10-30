# Fiches de recommandation : extraits de rapport V3

Configuration : `recommendation-ai-report-excerpts-v3`.
Contenu : `recommendation-report-points-v1`.
Client : `preference_mode: report_facts_v3`.
Modèle et paramètres inchangés : `gpt-6.1-sol`, effort faible, sortie structurée, 1 800 tokens maximum, `store:false`, aucun outil.

## Sources et calcul des effectifs

Le moteur existant reste l'unique présélection (20 candidats au maximum). Ses scores exacts, bandes, départages, contraintes et diversité ne changent pas. Les trois premiers de la recherche classique restent ceux du moteur. Les fractions restent disponibles côté serveur ; seuls leurs scores décimaux exacts sont nécessaires dans le dossier IA.

Tous les points forts et réserves validés du rapport durable sont fournis, y compris les points prix, indépendamment de la préférence service. Aucune lecture d'avis actuel n'alimente ces textes ou leurs effectifs. Chaque point reçoit une référence propre, par exemple `reservation_quality_1`, ainsi que sa rubrique, son texte intégral utile, sa publication, sa section et son index. Les sources Google restent distinctes, datées et déclaratives.

`distinct_reviews` déduplique les `review_id` des liaisons de preuves de cette même publication. Chaque référence doit avoir une seule identité figée, une rubrique et une polarité compatibles. Rapport, organisation, établissement, langue, source, date et empreinte doivent correspondre. Une référence absente, ambiguë ou incompatible rend l'effectif inconnu (`null`), sans présenter un effectif partiel comme complet. Les champs des anciennes sources autres que leurs IDs sont immédiatement écartés après lecture serveur.

L'effectif concerne le point de rapport entier : il ne mesure ni des clients indépendants, ni le nombre de répétitions d'un incident, ni chaque proposition dans une phrase regroupant plusieurs défauts. Une source unique documente un témoignage ; elle ne prouve pas que le problème n'a jamais existé ailleurs.

Le schéma durable actuel n'a pas d'annotation vérifiée de récurrence par problème. `recurrence` reste donc `unknown`, même avec plusieurs sources ou un texte évoquant une répétition. Cette dernière peut être comprise comme une affirmation attribuée au rapport, avec ses réserves, sans devenir une vérification indépendante. La pertinence n'est pas préclassée : le modèle doit la lire dans le texte et la demande, ou la laisser inconnue. Aucun détecteur de thèmes ou nouvelle règle de gravité n'est ajouté.

## Nuances et confidentialité

Les textes ne sont ni résumés automatiquement ni coupés. Les goûts personnels, qualifications positives, négations et limites causales sont conservés. Le modèle doit distinguer souhait mineur, plainte concrète et répétition alléguée ou établie. Un souhait d'espace ne démontre pas le bruit ; l'absence de critique ne démontre pas le calme. Un symptôme rapporté n'établit pas une causalité médicale. Les opinions sur le rapport qualité-prix ne donnent pas un budget : seules les indications Google séparées peuvent le faire.

Seules les synthèses anonymes du rapport sont admises : aucun avis complet, auteur, coordonnées, identifiant de client, photo ou description commerciale. Un filtre local masque les contacts et les personnes explicitement introduites par un titre ou un rôle. Il conserve le reste de la phrase et indique `redacted:true`. Ce filtre n'est pas un détecteur universel des noms sans contexte ; les dossiers réels existants sont contrôlés en privé avant livraison. Les identités de preuves restent serveur ; seuls les effectifs et les sources du rapport sont envoyés. La demande et la prose ne sont ni journalisées ni ajoutées au cache applicatif.

La limite locale de 200 000 octets est contrôlée avant réservation/appel. En dépassement, secours du moteur sans couper silencieusement une réserve ni envoyer des requêtes supplémentaires. La vérification de taille est une protection locale, pas une mesure de la limite fournisseur. Les dossiers de contrôle privés conservent les tailles et l'exhaustivité.

## Version, cache et protections

Le contenu, le prompt, la version, les droits, la langue, les données et la configuration participent à la clé de compatibilité. Une réponse V2 sans ces précisions ne peut pas être réutilisée en V3. Aucun ancien reçu n'est supprimé. Les versions sont ajoutées aux métriques techniques sauvegardées lors d'une future tentative normale.

Le serveur refuse une ancienne page V1/V2 avec HTTP 409 avant lecture du catalogue ou réservation. Les messages FR/VI expliquent désormais que les extraits anonymes des rapports sont transmis au clic. Les recherches classiques ne font aucun appel IA. Un clic de comparaison reste limité à un appel, réservé avant envoi, sans retry payant après résultat inconnu. Les IDs, doublons, droits et références locales sont contrôlés avant affichage ; la sortie conserve uniquement des références, pas de prose libre à exécuter.

L'affichage réutilise le point exact choisi, avec ses sources en Détails. Les notes, rapports publiés, modèles JEV/Sol, imports, synchronisations et tâches restent inchangés. Aucune migration, aucune régénération, aucun raccordement HOME AI.

## Validation et livraison

Tests hors réseau : conservation des nuances et critiques ; tous les points et catégories ; doublons et sources manquantes/ambiguës ; comptage sur le corpus figé ; dates SQL/ISO équivalentes ; confidentialité ; instructions adverses conservées comme données ; compatibilité V3/cache ; ancien client refusé ; appels concurrents et résultats inconnus. Les fixtures publiques sont synthétiques. Le rejeu privé des fiches existantes vérifie exhaustivité, taille, scores et ordre, sans réseau fournisseur.

Ces tests vérifient les données et les protections, pas la qualité réelle de la future sélection IA. Le prochain essai réel est manuel.

Déployer uniquement `test-restaurant-recommendations` depuis le commit intégré, JWT maintenu, puis la page via le workflow habituel. Aucun endpoint de comparaison ne doit être appelé pour vérifier la livraison. Contrôler les sources déployées et les fichiers Pages. Un retour arrière cohérent rétablit ensemble le client, le contrat et le serveur V2 ; conserver tous les reçus existants.

Références techniques : [données non fiables et isolation](https://developers.openai.com/api/docs/guides/agent-builder-safety), [sorties structurées](https://developers.openai.com/api/docs/guides/structured-outputs), [contexte Auth et RLS](https://supabase.com/docs/guides/functions/auth-legacy-jwt).
