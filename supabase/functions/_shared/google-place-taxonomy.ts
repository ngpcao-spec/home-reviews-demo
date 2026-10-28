/** Explicit aliases only. Never inspect a business name or commercial description. */
export const placeKey=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase().replace(/[_-]/g,' ').replace(/\s+/g,' ').trim();
export type TaxonomyKind='cuisines'|'specialties'|'usages';
const groups:Record<TaxonomyKind,Record<string,string[]>>={
 cuisines:{
  italian:['italian','italien','italienne','italian restaurant','restaurant italien','nhà hàng ý'],
  vietnamese:['vietnamese','vietnamien','vietnamienne','vietnamese restaurant','restaurant vietnamien','nhà hàng việt nam'],
  japanese:['japanese','japonais','japonaise','japanese restaurant','restaurant japonais','nhà hàng nhật bản'],
  indian:['indian','indien','indienne','indian restaurant','restaurant indien','nhà hàng ấn độ'],
  european:['european','européen','européenne','european restaurant','restaurant européen','nhà hàng châu âu'],
  scandinavian:['scandinavian','scandinave','scandinavian restaurant','restaurant scandinave','nhà hàng scandinavi'],
  asian:['asian','asiatique','asian restaurant','restaurant asiatique','nhà hàng châu á'],
  korean:['korean','coréen','coréenne','korean restaurant','restaurant coréen','nhà hàng hàn quốc'],
  western:['western','occidentale','western restaurant','restaurant occidental','nhà hàng phương tây'],
 },
 specialties:{pizza:['pizza','pizza restaurant','pizzeria','nhà hàng pizza'],seafood:['seafood','fruits de mer','seafood restaurant','restaurant de fruits de mer','nhà hàng hải sản'],barbecue:['barbecue','bbq','grillades','barbecue restaurant','restaurant de grillades','nhà hàng món nướng'],steak:['steak','steakhouse','steak house','restaurant de grillades à l’américaine','nhà hàng bít tết'],sandwich:['sandwich','sandwich shop','sandwicherie','cửa hàng sandwich']},
 usages:{restaurant:['restaurant','nhà hàng'],cafe:['cafe','café','coffee shop','quán cà phê'],bar:['bar','quán bar'],cocktail_bar:['cocktail bar','bar à cocktails','quán bar cocktail'],bakery:['bakery','boulangerie','tiệm bánh'],brunch:['brunch','brunch restaurant','restaurant brunch','nhà hàng chuyên phục vụ bữa nửa buổi'],breakfast:['breakfast restaurant','restaurant de petits déjeuners','nhà hàng chuyên phục vụ bữa sáng'],lunch:['lunch restaurant','nhà hàng phục vụ bữa trưa'],coworking:['coworking','coworking space','espace de coworking','không gian làm việc chia sẻ'],family_restaurant:['family restaurant','restaurant familial','nhà hàng gia đình'],nightclub:['nightclub','boîte de nuit','hộp đêm'],live_music_venue:['live music venue','salle de concert','địa điểm ca nhạc trực tiếp'],music_club:['music club','club de musique','câu lạc bộ âm nhạc'],bistro:['bistro','bistrot','quán ăn nhỏ'],wine_shop:['wine store','caviste','cửa hàng rượu'],italian_grocery:['italian grocery store','épicerie italienne','cửa hàng tạp hóa ý'],grocery_delivery:['grocery delivery service','dịch vụ giao hàng tạp hóa'],bar_grill:['bar & grill','bar-grill'],wedding_buffet:['wedding buffet','tiệc cưới đứng']},
};
const aliases=Object.fromEntries(Object.entries(groups).map(([kind,values])=>[kind,Object.fromEntries(Object.entries(values).flatMap(([id,labels])=>[id,...labels].map(label=>[placeKey(label),id])))])) as Record<TaxonomyKind,Record<string,string>>;
export function taxonomyValue(kind:TaxonomyKind,label:string){const k=placeKey(label);return Object.hasOwn(aliases[kind],k)?aliases[kind][k]:null;}
export function placeCategories(labels:string[]) {
 const raw=[...new Map(labels.map(x=>[placeKey(x),x])).values()];
 const result={raw,cuisines:[] as string[],specialties:[] as string[],usages:[] as string[],mappings:[] as {label:string;kind:TaxonomyKind;value:string}[],unrecognized:[] as string[]};
 for(const label of raw){let found=false;for(const kind of Object.keys(groups) as TaxonomyKind[]){const value=taxonomyValue(kind,label);if(value){found=true;result[kind].push(value);result.mappings.push({label,kind,value});}}if(!found)result.unrecognized.push(label);}
 for(const kind of Object.keys(groups) as TaxonomyKind[])result[kind]=[...new Set(result[kind])].sort();
 return result;
}
/** Label aliases scoped to explicit boolean additionalInfo entries. */
export const PLACE_FEATURES:Record<string,{fr:string;vi:string;aliases:string[]}>=Object.fromEntries(([
 ['dine_in','Sur place','Ăn tại chỗ',['dine-in','repas sur place','ăn tại chỗ']],
 ['takeaway','À emporter','Đồ ăn mang đi',['takeout','takeaway','vente à emporter','đồ ăn mang đi']],
 ['delivery','Livraison','Giao hàng',['delivery','livraison','giao hàng']],
 ['reservation','Réservation acceptée','Nhận đặt chỗ',['accepts reservations','reservations','réservations acceptées','nhận đặt chỗ']],
 ['breakfast','Petit déjeuner','Bữa sáng',['breakfast','petit déjeuner','bữa sáng']],
 ['brunch','Brunch','Bữa nửa buổi',['brunch','bữa nửa buổi']],
 ['lunch','Déjeuner','Bữa trưa',['lunch','déjeuner','bữa trưa']],
 ['dinner','Dîner','Bữa tối',['dinner','dîner','bữa tối']],
 ['outdoor_seating','Places en extérieur','Chỗ ngồi ngoài trời',['outdoor seating','terrasse','places assises à l’extérieur','chỗ ngồi ngoài trời']],
 ['rooftop','Toit-terrasse','Chỗ ngồi trên sân thượng',['rooftop seating','toit-terrasse','chỗ ngồi trên sân thượng']],
 ['private_room','Salle privée','Phòng ăn riêng tư',['private dining room','salle à manger privée','phòng ăn riêng tư']],
 ['wifi','Wi-Fi','Wi-Fi',['wi-fi','wifi','wi-fi miễn phí']],
 ['free_parking','Parking gratuit','Bãi đỗ xe miễn phí',['free parking lot','parking gratuit','bãi đỗ xe miễn phí']],
 ['onsite_parking','Parking sur place','Chỗ đỗ xe trong khuôn viên',['on-site parking','parking sur place','chỗ đỗ xe trong khuôn viên']],
 ['free_street_parking','Stationnement gratuit dans la rue','Đỗ xe miễn phí trên đường',['free street parking','stationnement gratuit dans la rue','đỗ xe miễn phí trên đường']],
 ['wheelchair_entrance','Entrée accessible en fauteuil','Lối vào cho xe lăn',['wheelchair accessible entrance','entrée accessible en fauteuil roulant','lối vào cho xe lăn']],
 ['wheelchair_seating','Places accessibles en fauteuil','Chỗ ngồi cho xe lăn',['wheelchair accessible seating','places assises accessibles en fauteuil roulant','chỗ ngồi cho xe lăn']],
 ['wheelchair_parking','Parking accessible en fauteuil','Chỗ đỗ xe cho xe lăn',['wheelchair accessible parking lot','parking accessible en fauteuil roulant','chỗ đỗ xe cho xe lăn']],
 ['wheelchair_toilet','Toilettes accessibles en fauteuil','Nhà vệ sinh cho xe lăn',['wheelchair accessible restroom','toilettes accessibles en fauteuil roulant','nhà vệ sinh cho xe lăn']],
 ['vegetarian_options','Options végétariennes','Các món chay',['vegetarian options','plats végétariens','các món chay']],
 ['vegan_options','Options végétaliennes','Các món thuần chay',['vegan options','plats végétaliens','các món thuần chay']],
 ['kids','Adapté aux enfants','Phù hợp cho trẻ em',['good for kids','adapté aux enfants','phù hợp cho trẻ em']],
 ['kids_menu','Menu enfant','Thực đơn dành cho trẻ em',['kids menu','menu enfant','thực đơn dành cho trẻ em']],
 ['high_chairs','Chaises hautes','Ghế cao cho bé',['high chairs','chaises hautes','ghế cao cho bé']],
 ['family_friendly','Adapté aux familles','Dành cho gia đình',['family-friendly','adapté aux familles','dành cho gia đình']],
 ['groups','Groupes','Nhóm',['groups','groupes','nhóm']],
 ['dogs','Chiens acceptés','Cho phép mang theo chó',['dogs allowed','chiens acceptés','cho phép mang theo chó']],
 ['dogs_outside','Chiens en extérieur','Cho phép mang theo chó bên ngoài',['dogs allowed outside','chiens autorisés à l’extérieur','cho phép mang theo chó bên ngoài']],
 ['dogs_inside','Chiens en intérieur','Được mang chó vào trong',['dogs allowed inside','chiens autorisés à l’intérieur','được mang chó vào trong']],
 ['credit_cards','Cartes de crédit','Thẻ tín dụng',['credit cards','cartes de crédit','thẻ tín dụng']],
 ['debit_cards','Cartes de débit','Thẻ ghi nợ',['debit cards','cartes de débit','thẻ ghi nợ']],
 ['nfc','Paiement NFC','Thanh toán di động qua NFC',['nfc mobile payments','paiements mobiles nfc','thanh toán di động qua nfc']],
 ['cash_only','Espèces uniquement','Chỉ nhận tiền mặt',['cash-only','argent liquide seulement','chỉ nhận tiền mặt']],
 ['quiet','Calme déclaré sur Google','Yên tĩnh theo Google',['quiet','calme','yên tĩnh']],
 ['romantic','Romantique','Lãng mạn',['romantic','romantique','lãng mạn']],
 ['live_music','Musique en direct','Nhạc sống',['live music','concerts','nhạc sống']],
 ['cozy','Chaleureux','Ấm cúng',['cozy','cosy','chaleureux','ấm cúng']],
 ['casual','Décontracté','Thông thường',['casual','décontracté','thông thường']],
 ['upscale','Haut de gamme','Cao cấp',['upscale','haut de gamme','cao cấp']],
 ['air_conditioning','Climatisation','Điều hòa',['air conditioning','climatisation','điều hòa']],
] as [string,string,string,string[]][]).map(([id,fr,vi,labels])=>[id,{fr,vi,aliases:[id,...labels]}]));
const featureAliases=Object.fromEntries(Object.entries(PLACE_FEATURES).flatMap(([id,x])=>x.aliases.map(label=>[placeKey(label),id])));
export const placeFeature=(label:string)=>Object.hasOwn(featureAliases,placeKey(label))?featureAliases[placeKey(label)]:null;
export const placeFeatureLabel=(id:string,language:string)=>PLACE_FEATURES[id]?.[language==='vi'?'vi':'fr']??id;
