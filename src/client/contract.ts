import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { MemoryLocaleKey } from './locales.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.missherMemory': MemoryLocaleKey
  }
}
