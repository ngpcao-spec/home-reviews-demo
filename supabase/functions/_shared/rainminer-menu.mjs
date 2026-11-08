export const RAINMINER_ACTOR = 'rainminer/google-maps-menu-scraper';
export const RAINMINER_ACTOR_ID = '8GGZ9N7j2JhqnQ3oT';

const normalize = value => typeof value === 'string'
  ? value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
  : '';

const beverageSection = /^(?:soft drinks?|boissons?|drinks?|beverages?|tea\s*\/\s*coffee|coffee|tea|wine(?: list)?|vodka|tequila|rhum|rum|(?:blended scotch |japanese |american )?whisk[ey]+|juices?|smoothies?|(?:classic )?cocktails?|beers?)$/;
const beverageSectionTranslation = /^(?:the|cafe|tra|ca phe|do uong|nuoc giai khat|чаи|кофе|напитки)$/u;
const isBeverageSection = section => {
  // Some OCR headings mix Cyrillic Т/а with Latin letters in “Trà”.
  const parts = section.split(/\s*[/,;|&+·\p{Pd}]\s*|\s+(?:and|et|va|и)\s+/u).filter(Boolean);
  return parts.length > 0 && parts.every(part =>
    beverageSection.test(part) || beverageSectionTranslation.test(part.replace(/^[тt]r[аa]$/u, 'tra')));
};
const foodSection = /^(?:food|pizzas?|desserts?|rice|soups?|salads?|pasta|seafood|main courses?|starters?)$/;
const foodName = /\b(?:pizza|steak|lobster|octopus|chicken|poulet|coq|beef|pork|fish|salad|soup|cake|gateau|tiramisu|ice cream|noodles?|rice|pasta|risotto|sauce|braised|grilled)\b/;
const beverageName = /^(?:vanil(?:l)?a latte|latte|cappuccino|americano|(?:milk|black|vietnamese white|coconut) coffee(?: \(vn\))?|tea cup\s*\(\s*lipton tea\s*\)|nuoc suoi|nuoc tang luc|mojito|long island iced tea|pinnacolada|pina colada|singapore sling|jim beam highball|tequila sunrise|peach crush|gin & tonic|screwdriver korea style)$/;
const explicitBeverageName = /^(?:(?:(?:iced|hot|iced\/hot) )?(?:(?:green|black|lemon|kumquat) )?(?:iced )?tea|lipton(?: lemon)?(?: iced\/hot)?|(?:(?:iced|hot|iced\/hot) )?(?:(?:black|milk) )?coffee|espresso|tra (?:tac|chanh|xanh|nong)|ca phe(?: (?:den|sua|da)){0,2}|(?:черныи )?кофе(?: с молоком)?(?: со льдом)?)(?: \([^()]*\))?$/u;
const ambiguousDrinkName = /\b(?:yogurt|yoghurt|yaourt|sua chua)\b|иогурт/u;

export function classifyMenuRow({category, name}) {
  const section = normalize(category);
  const label = normalize(name).replace(/^[\s\p{Pd}]+|[:\s]+$/gu, '');
  const drinkSection = isBeverageSection(section);
  const drinkName = beverageName.test(label) || explicitBeverageName.test(label);
  if (!label) return 'review';
  if (foodName.test(label) || foodSection.test(section)) {
    return drinkSection || drinkName ? 'review' : 'food';
  }
  if (ambiguousDrinkName.test(label)) return 'review';
  if (drinkSection || drinkName) return 'drink';
  return 'review';
}

export function importRainminerMenu(rows, provenance, placeId) {
  if (!/^ChIJ[\w-]+$/.test(placeId) || !Array.isArray(rows)) throw Error('INVALID_MENU_INPUT');
  if (provenance.actor?.name !== RAINMINER_ACTOR ||
      !provenance.runId || !provenance.datasetId ||
      provenance.input?.placeIds?.length !== 1 || provenance.input.placeIds[0] !== placeId ||
      provenance.input.startUrls?.length || provenance.input.textQueries?.length) {
    throw Error('MENU_RUN_IDENTITY_MISMATCH');
  }
  const decisions = rows.map((row, index) => {
    if (row?.placeId !== placeId) throw Error(`MENU_ROW_PLACE_ID_MISMATCH:${index + 1}`);
    return {sourceRow: index + 1, classification: classifyMenuRow(row), row};
  });
  const references = decisions.filter(entry => entry.classification !== 'drink');
  return {
    placeId, provenance, references,
    excludedDrinks: decisions.filter(entry => entry.classification === 'drink'),
    counts: {
      received: rows.length, excludedDrinks: rows.length - references.length,
      retained: references.length,
      food: references.filter(entry => entry.classification === 'food').length,
      review: references.filter(entry => entry.classification === 'review').length,
    },
  };
}
