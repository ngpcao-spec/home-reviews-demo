import {defineConfig} from '@playwright/test'
import shared from './playwright.shared-stack.config'
export default defineConfig({...shared,testMatch:'automatic-menus.spec.ts'})
