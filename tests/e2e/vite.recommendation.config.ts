import {defineConfig} from 'vite';
import resume from './vite.resume.config.ts';
export default defineConfig({...resume,resolve:{alias:[...resume.resolve!.alias as {find:RegExp;replacement:string}[],
 {find:/^npm:js-tiktoken@1\.0\.21$/,replacement:'js-tiktoken'},
 {find:/^npm:franc-min@6\.2\.0$/,replacement:'franc-min'},
 {find:/^npm:zod@4\.6\.5$/,replacement:'zod'},
 {find:/^npm:@supabase\/supabase-js@2\.117\.2$/,replacement:'@supabase/supabase-js'},
]}});
