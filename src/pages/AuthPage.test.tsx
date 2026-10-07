import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import {afterEach,it,expect,vi} from 'vitest'
import {AuthPage} from './AuthPage'
const oauth=vi.hoisted(()=>vi.fn())
vi.mock('../lib/supabase',()=>({isSupabaseConfigured:true,supabase:{auth:{signInWithOAuth:oauth}}}))
afterEach(()=>{cleanup();oauth.mockReset()})
it('double tapping Google starts a single OAuth flow',async()=>{oauth.mockResolvedValue({error:null});render(<AuthPage/>);const button=screen.getByRole('button',{name:/Continuer avec Google/});fireEvent.click(button);fireEvent.click(button);expect(oauth).toHaveBeenCalledTimes(1);expect(button).toBeDisabled()})
it('a thrown sign-in request returns an actionable retry state without vendor/token leakage',async()=>{oauth.mockRejectedValue(new Error('SENSITIVE_VENDOR_CONTENT'));render(<AuthPage/>);fireEvent.click(screen.getByRole('button',{name:/Continuer avec Google/}));expect(await screen.findByRole('alert')).toHaveTextContent('Vérifiez votre connexion');expect(screen.getByRole('button',{name:/Continuer avec Google/})).toBeEnabled();expect(screen.queryByText('SENSITIVE_VENDOR_CONTENT')).not.toBeInTheDocument()})
