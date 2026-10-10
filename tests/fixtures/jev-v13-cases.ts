// Short invented cases derived from the 19 audit topics; no complete real review is embedded.
// Expected annotations describe the intended product rules, not measured provider behavior.
export const V13_CASES=[
 {id:'recipe-residue',theme:'cooking',text:'The crepe contained gritty unneutralized baking soda.',choice:'negative',verdict:'confirmed_v12_error'},
 {id:'food-handling',theme:'cleanliness',text:'A server pressed the served potatoes with bare fingers and returned them.',choice:'negative',verdict:'confirmed_v12_error'},
 {id:'service-for-money',theme:'value',text:'For the price I paid, this careless service was unacceptable.',choice:'negative',verdict:'confirmed_v12_error'},
 {id:'remote-trip',theme:'location',text:'This distant restaurant was not worth the trip from the city center.',choice:'negative',verdict:'confirmed_v12_error'},
 {id:'pest-claim',theme:'cleanliness',text:'Mosquitoes bit us inside. I later received a dengue diagnosis.',choice:'negative',verdict:'confirmed_v12_error'},
 {id:'salt-dose',theme:'cooking',text:'One sandwich had far too much salt in its filling.',choice:'negative',verdict:'confirmed_v12_error'},
 {id:'excess-spice',theme:'cooking',text:'The seasoning contained excessive spice and salt.',choice:'negative',verdict:'confirmed_v12_error'},
 {id:'unclear-follow-up',theme:'communication',text:'The server promised to return soon but did not come back.',choice:'uncertain',verdict:'ambiguous'},
 {id:'product-family-unavailable',theme:'variety',text:'The menu advertised burgers, but none could be ordered.',choice:'negative',verdict:'confirmed_v12_error'},
 {id:'unbalanced-recipe',theme:'cooking',text:'The seasonings were insufficient and the sourness was unbalanced.',choice:'negative',verdict:'confirmed_v12_error'},
 {id:'salty-main',theme:'cooking',text:'The meat had excessive salt while the side salad tasted good.',choice:'negative',verdict:'confirmed_v12_error'},
 {id:'sugar-assembly',theme:'cooking',text:'The cake had too much sugar and its ingredients were badly assembled.',choice:'negative',verdict:'confirmed_v12_error'},
 {id:'felt-ambience',theme:'atmosphere',text:'The rude service ruined the atmosphere we experienced.',choice:'negative',verdict:'ai_reference_correction'},
 {id:'organization-ambiguous',theme:'coordination',text:'Our meal arrived late and a replacement was disappointing.',choice:'uncertain',verdict:'ambiguous'},
 {id:'attitude-not-care',theme:'attentiveness',text:'The staff had a bad attitude, with no comment about availability or care.',choice:'absent',verdict:'confirmed_v12_error'},
 {id:'always-poor',theme:'consistency',text:'Every visit had the same disappointing food. Drinks were good.',choice:'absent',verdict:'confirmed_v12_error'},
 {id:'poor-value-not-price',theme:'price_level',text:'What we received was poor value for the amount paid.',choice:'absent',verdict:'confirmed_v12_error'},
 {id:'forgotten-order',theme:'attentiveness',text:'One ordered dish was forgotten. The trainee had inadequate supervision.',choice:'absent',verdict:'confirmed_v12_error'},
 {id:'dish-variation',theme:'consistency',text:'The sides were well made, but both main dishes were disappointing.',choice:'negative',verdict:'ai_reference_correction'},
] as const
