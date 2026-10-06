export const GOLD_TAXONOMY_VERSION='gold-taxonomy-v1'
export const GOLD_CHOICES=['absent','positive','negative','both','uncertain'] as const
export type GoldChoice=typeof GOLD_CHOICES[number]
type Entry={axis:'quality'|'service'|'atmosphere'|'price';fr:string;vi:string;definition_fr:string;definition_vi:string}
const entry=(axis:Entry['axis'],fr:string,vi:string,definition_fr:string,definition_vi:string):Entry=>({axis,fr,vi,definition_fr,definition_vi})
// Product definitions explicitly approved for human annotation. Version is frozen.
export const GOLD_TAXONOMY={
  food_quality:entry('quality','Goût et qualité','Hương vị và chất lượng','Opinion explicite sur le goût, la saveur ou la qualité générale des plats.','Ý kiến rõ ràng về hương vị hoặc chất lượng chung của món ăn.'),
  freshness:entry('quality','Fraîcheur','Độ tươi','Fraîcheur des aliments ou ingrédients.','Độ tươi của thực phẩm hoặc nguyên liệu.'),
  cooking:entry('quality','Cuisson','Độ chín','Cuisson ou préparation : trop cuit, pas assez cuit, bien préparé.','Độ chín hoặc cách chế biến: quá chín, chưa chín, nấu tốt.'),
  temperature:entry('quality','Température du plat','Nhiệt độ món ăn','Température du plat servi, chaud ou froid.','Nhiệt độ món ăn khi phục vụ, nóng hoặc lạnh.'),
  portions:entry('quality','Portions','Khẩu phần','Quantité ou taille des portions.','Số lượng hoặc kích thước khẩu phần.'),
  presentation:entry('quality','Présentation','Trình bày','Présentation visuelle et dressage des plats.','Cách trình bày hoặc bày biện món ăn.'),
  drinks:entry('quality','Boissons','Đồ uống','Opinion sur les boissons, café, cocktails, etc.','Ý kiến về đồ uống, cà phê, cocktail, v.v.'),
  variety:entry('quality','Choix du menu','Lựa chọn thực đơn','Variété du menu, choix disponibles et options alimentaires.','Sự đa dạng của thực đơn, lựa chọn có sẵn và chế độ ăn.'),
  consistency:entry('quality','Régularité','Sự ổn định','Régularité ou irrégularité entre plats ou visites.','Chất lượng đồng đều hoặc không đồng đều giữa món ăn hoặc các lần ghé.'),
  friendly_staff:entry('service','Amabilité','Sự thân thiện','Uniquement amabilité, gentillesse, accueil chaleureux ou politesse ; impolitesse et froideur en négatif. Rapidité, attention ou professionnalisme seuls ne suffisent pas.','Chỉ sự thân thiện, tốt bụng, chào đón, ấm áp hoặc lịch sự; thô lỗ hay lạnh lùng là tiêu cực. Nhanh, quan tâm hay chuyên nghiệp đơn thuần chưa đủ.'),
  attentiveness:entry('service','Attention au client','Sự quan tâm','Attention concrète aux besoins : personnel attentionné, vérification de la table, besoin remarqué, réactivité, aide proactive. Ignorer ou devoir demander plusieurs fois est négatif. « Great service » ou « friendly staff » seuls ne suffisent pas.','Quan tâm cụ thể đến nhu cầu: chú ý, kiểm tra bàn, nhận ra nhu cầu, phản hồi nhanh, chủ động giúp. Phớt lờ hoặc phải nhắc nhiều lần là tiêu cực. Chỉ « great service » hay « friendly staff » chưa đủ.'),
  wait_time:entry('service','Attente / rapidité','Thời gian chờ','Temps d’attente ou rapidité explicitement décrit : arrivé vite, attendu 40 minutes.','Thời gian chờ hoặc tốc độ được mô tả rõ: đến nhanh, chờ 40 phút.'),
  coordination:entry('service','Organisation du service','Phối hợp phục vụ','Organisation ou synchronisation du service. Ne pas déduire ce thème de « bad service » seul.','Tổ chức hoặc phối hợp phục vụ. Không suy ra chỉ từ « bad service ».'),
  communication:entry('service','Communication','Giao tiếp','Explications, compréhension, langue, écoute ou information donnée au client.','Giải thích, hiểu nhau, ngôn ngữ, lắng nghe hoặc thông tin cho khách.'),
  order_accuracy:entry('service','Exactitude de commande','Độ chính xác đơn hàng','Mauvaise commande, élément oublié, mauvais plat ou commande explicitement correcte.','Sai đơn, thiếu món, sai món hoặc đơn hàng được xác nhận đúng.'),
  professionalism:entry('service','Professionnalisme','Tính chuyên nghiệp','Uniquement compétence, connaissances, sérieux, comportement professionnel ou gestion compétente d’une situation. Nice/friendly staff, great/fast service seuls ne suffisent pas.','Chỉ năng lực, kiến thức, sự nghiêm túc, hành vi chuyên nghiệp hoặc xử lý tình huống có năng lực. Nice/friendly staff hay great/fast service đơn thuần chưa đủ.'),
  atmosphere:entry('atmosphere','Ambiance','Bầu không khí','Ambiance générale ou vibe explicitement évaluée.','Bầu không khí chung hoặc cảm giác được đánh giá rõ ràng.'),
  decor:entry('atmosphere','Décoration','Trang trí','Décoration, design ou intérieur.','Trang trí, thiết kế hoặc nội thất.'),
  noise:entry('atmosphere','Bruit / calme','Độ ồn / yên tĩnh','Jugement explicite sur le bruit, le calme ou le niveau sonore.','Đánh giá rõ về tiếng ồn, sự yên tĩnh hoặc mức âm thanh.'),
  comfort:entry('atmosphere','Confort','Sự thoải mái','Confort physique : sièges, espace, température de salle ou confort général.','Thoải mái về thể chất: ghế, không gian, nhiệt độ phòng hoặc cảm giác thoải mái.'),
  cleanliness:entry('atmosphere','Propreté','Vệ sinh','Propreté ou hygiène.','Sự sạch sẽ hoặc vệ sinh.'),
  location:entry('atmosphere','Emplacement / accès','Vị trí / tiếp cận','Emplacement, accès ou difficulté à trouver.','Vị trí, khả năng tiếp cận hoặc khó tìm.'),
  value:entry('price','Rapport qualité/prix','Giá trị so với giá','Rapport qualité/prix explicitement évalué.','Đánh giá rõ về giá trị nhận được so với số tiền.'),
  billing:entry('price','Facture / frais','Hóa đơn / phí','Facture, erreur de facturation, surcharge ou frais supplémentaires.','Hóa đơn, sai hóa đơn, phụ thu hoặc phí bổ sung.'),
  price_level:entry('price','Niveau de prix','Mức giá','Prix bon marché, cher ou raisonnable.','Giá rẻ, đắt hoặc hợp lý.'),
} as const
export type GoldTheme=keyof typeof GOLD_TAXONOMY
export const GOLD_KEYS=Object.keys(GOLD_TAXONOMY) as GoldTheme[]
export const GOLD_RULES={fr:'Évaluez uniquement les opinions explicites du texte. « Great service » seul ne désigne aucun des sept thèmes Service. Plusieurs thèmes peuvent être présents. Both exige un signal positif et négatif sur le même thème. Uncertain signifie impossible à trancher et sera exclu des métriques.',vi:'Chỉ đánh giá ý kiến được nêu rõ trong văn bản. « Great service » đơn thuần không xác định chủ đề Dịch vụ cụ thể nào. Có thể có nhiều chủ đề. Both cần cả tín hiệu tích cực và tiêu cực trên cùng chủ đề. Uncertain là không thể quyết định và sẽ bị loại khỏi chỉ số.'}
