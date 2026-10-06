import {describe,it,expect} from 'vitest'
import {localizedReviewText} from './review-translation'
describe('FR/VI display with English fallback',()=>{
  it('R: preserves the preferred VI translation ahead of English',()=>{expect(localizedReviewText('Русский',[{language:'en',translated_text:'English'},{language:'vi',translated_text:'Tiếng Việt'}],'vi')).toEqual({displayText:'Tiếng Việt',translatedText:'Tiếng Việt',originalText:'Русский'})})
  it('S: uses English when VI is absent',()=>{expect(localizedReviewText('Русский',[{language:'en',translated_text:'English'}],'vi')).toEqual({displayText:'English',translatedText:'English',originalText:'Русский'})})
  it('T/U: falls back to original and preserves it for audit',()=>{expect(localizedReviewText('Русский',[],'fr')).toEqual({displayText:'Русский',originalText:'Русский',translatedText:undefined})})
})
