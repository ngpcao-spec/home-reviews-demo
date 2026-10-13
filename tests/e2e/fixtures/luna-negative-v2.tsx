// Explicit technical mock, not a persisted or annotated real experiment.
import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {I18nProvider} from '../../../src/i18n';import {NegativeWorkspace} from '../../../src/pages/LunaNegativeV2Page';import {negativeFixture} from '../../fixtures/luna-negative-v2';
import '../../../src/styles/global.css';import '../../../src/styles/pages.css';import '../../../src/styles/reference.css';import '../../../src/styles/warm-theme.css';
const language=new URLSearchParams(location.search).get('language')==='vi'?'vi':'fr',initial=await negativeFixture(),key='mock-negative-v2';
export function Fixture(){const [data,setData]=useState(()=>localStorage.getItem(key)?JSON.parse(localStorage.getItem(key)!):initial);return <NegativeWorkspace data={data} onFreeze={async()=>{localStorage.setItem(key,JSON.stringify(data));setData({...data});}} onSeal={async()=>{throw new Error('MOCK_NO_REAL_ANNOTATIONS');}} onRefresh={async()=>{localStorage.setItem(key,JSON.stringify(data));setData({...data});}}/>;}
createRoot(document.getElementById('root')!).render(<I18nProvider language={language}><main className='page-frame'><div className='jev-page gold-page decisions-page'><Fixture/></div></main></I18nProvider>);
