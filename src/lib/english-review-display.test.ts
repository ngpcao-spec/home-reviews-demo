import {describe,it,expect} from 'vitest'
import {localizedReviewText} from './review-translation'
describe('FR/VI display without English fallback',()=>{
  it('R: preserves the preferred VI translation ahead of English',()=>{expect(localizedReviewText('Русский',[{language:'en',translated_text:'English'},{language:'vi',translated_text:'Tiếng Việt'}],'vi')).toEqual({displayText:'Tiếng Việt',translatedText:'Tiếng Việt',originalText:'Русский'})})
  it('S: preserves the original when VI is absent, without substituting English',()=>{expect(localizedReviewText('Русский',[{language:'en',translated_text:'English'}],'vi')).toEqual({displayText:'Русский',translatedText:undefined,originalText:'Русский'})})
  it('T/U: falls back to original and preserves it for audit',()=>{expect(localizedReviewText('Русский',[],'fr')).toEqual({displayText:'Русский',originalText:'Русский',translatedText:undefined})})
})
