# Contrôle Luna multi-restaurants — préparation gratuite

Le protocole `luna-multirest-evidence-v1` est séparé du test Artisan `openai-decisions-evidence40-run-v1`. JEV V12 reste inchangée et aucune intégration au rapport hybride n'est activée.

## Données et scellement

Source historique immuable : `analysis_jev_hybrid_controls`, ID `4942bc5e-5790-4087-b382-ca4644d71f47`, SHA `d1d47e0c178d7ee0189cecabeda98249a951a63b271feccea6c04f55ccec895a`.

Nouveau jeu : `929bef2d-e841-43e0-a055-3d924d5f88b2`, scellé le 12 octobre 2026 à 18:22 (Asia/Saigon). SHA du jeu : `6ece86a66208a86ba7c32a5825277ee28fbb0abafc2b828b6c255b4006c7dcb8`. Les 40 identifiants, les textes originaux et anglais, leurs SHA, les établissements et leur organisation ont été vérifiés.

40 avis distincts, 11 restaurants de la même organisation autorisée ; 3 avis à une étoile, aucun à 2/3/4 étoiles, 37 à cinq étoiles. Aucun résultat JEV en cache et aucun chevauchement trouvé dans les tables d'avis/annotations/tâches historiques ou les anciens contrôles de preuves vérifiés. Les jugements/prédictions n'ont pas été utilisés pour la sélection.

## Propositions et limites

Sélecteur `multirest-text-candidates-v1` : statements déterministes V3 figés en premier, puis ancrage d'entité non confirmé, puis sonde de frontière choisie par SHA256 pour les textes génériques. Les critères de tri et le dictionnaire sont centralisés ; les étoiles ne déterminent ni thème ni polarité.

23 propositions issues de signaux structurés, 8 ancrages à confirmer, 9 sondes sans thème explicite. Ces propositions ne sont ni des prédictions JEV ni 40 preuves déjà confirmées. Elles comprennent 37 polarités proposées positives et 3 négatives, sur 11 thèmes ; les 25 thèmes V12 restent disponibles et inchangés. Le détail par thème/restaurant est dans le résumé JSON et l'application.

Le cas 32, `86621ac9-27a9-456b-9f34-9db6946bc623`, contient une version anglaise suivie de phrases vietnamiennes. Son texte et ses empreintes sont conservés. Il reste dans les 40 cas et l'export d'annotation, mais le futur envoi Luna est bloqué pour ce cas : 39 envois admissibles, plafond 40. Aucune correction rétroactive de traduction n'a été faite.

Ce contrôle très positif ne démontre pas la détection des critiques négatives. Un contrôle complémentaire devra inclure davantage de 1–3 et 4 étoiles, sur plusieurs restaurants autorisés, avec anglais vérifié et références IA produites avant les prédictions. Aucun nouvel import ou traduction n'est lancé.

## Référence IA aveugle

Exporter depuis l'application puis utiliser une conversation GPT-6 séparée, avec uniquement cet export. Chaque item contient exactement `review_id`, `analysis_text`, `theme_key`, `analysis_text_sha256`. Ni polarité proposée, étoile, statut V3, méthode de sélection, prédiction JEV/Luna ni probabilité. Les définitions V12 du thème et les choix possibles accompagnent l'export, sans préremplir de réponse.

Le modèle devra retourner les en-têtes de protocole/empreinte/provenance et 40 items avec les cinq champs `review_id`, `theme_key`, `analysis_text_sha256`, `choice`, `justification`. Choix : absent/positive/negative/both/uncertain. Aucune annotation n'a été créée pendant cette préparation. 0 référence, 0 scellement de références, 0 résultat Luna.

L'import exige les 40 choix explicites, les mêmes thèmes/empreintes, une justification et la provenance GPT-6 IA. Le scellement est atomique, idempotent et immuable. Les incertitudes restent stockées et exclues des métriques concernées. Les références IA ne sont pas un Gold humain indépendant.

## Luna et coût futur

Configuration indépendante : `luna-multirest-evidence-choice-v1`, SHA `9f26dc31bc17218e8903f5ece895928dca277b748b4fede16c7805513482743e`. Elle réutilise les frontières V12 et la question de vérification texte + thème + polarité de Decisions. Réponses : supported/unsupported/uncertain, modèle demandé gpt-6-luna, POST /v1/decisions, un passage, confiance native et distribution conservées, aucune répétition automatique.

Estimation locale o200k_base + 12 % + 128 tokens de framing par requête, sans facturation constatée : 22 295 tokens / 0,0022295 USD pour 39 cas admissibles ; scénario 40 cas avant exclusion : 0,002311 USD. Tarif standard configuré 0,10 USD/million en entrée, sans charge de sortie. Suppléments régionaux/contexte non vérifiés.

Le dispatch payant est totalement désactivé et rejette toute action launch/confirm/GO. Aucune table de dépenses, aucun job ni cron n'a été créé. Un futur lancement nécessite références scellées, activation technique spécifique et confirmation manuelle explicite du coût sur iPhone.

## Serveur et évaluation préparée

Tables dédiées : `analysis_luna_multirest_sets`, `_cases`, `_reference_seals`, `_references`, `_results`. RLS owner/admin/manager de la même organisation, lecture seulement côté client. RPC service-only SECURITY INVOKER, aucune lecture SQL de auth.users. Authentification/compte actif vérifiés côté serveur par les composants existants.

La fonction `luna-multirest` expose uniquement GET, préparation gratuite et import/scellement des références. Les empreintes source/configuration/cas sont recontrôlées en lecture. Les résultats futurs exigent une référence scellée et un cas existant, avec unicité par cas et un seul passage.

Le calcul hors fournisseur prépare TP/FP/TN/FN, indécisions, couverture, précision sélective, rappel des preuves soutenues, détail par thème/restaurant, les trois avis faibles séparément, Brier/ECE, confiance, tokens, durée et coûts estimés observés. Réponses invalides/manquantes et textes exclus ne deviennent pas des décisions valides. Aucun score JEV n'est inventé.

## Vérification et accès

1 476 tests unitaires sur 150 fichiers ; 2 tests Deno sans réseau ; Deno check/lint ; SQL avec le rôle réel service_role et ROLLBACK des références fictives de test ; lint/build ; 16 tests Playwright FR/VI, 360/390/430 et iPad 768 px. Aucun fournisseur n'a été appelé.

Plus / Thêm → Test Jev → OpenAI Decisions → Contrôle Luna multi-restaurants (`/plus/luna-multirest`). Export gratuit, import manuel de références et reprise des états après rechargement. Le bouton de lancement Luna reste désactivé.
