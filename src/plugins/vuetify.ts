import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import { createVuetify, type ThemeDefinition } from 'vuetify'
import { aliases, mdi } from 'vuetify/iconsets/mdi'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

// Custom dark theme (from migration plan palette)
const awesomeposterDark: ThemeDefinition = {
  dark: true,
  colors: {
    primary: '#6ea8fe',         // accent
    background: '#0b1020',      // bg
    surface: '#121a33',         // panel
    'on-surface': '#e6e8ef',    // fg
    'surface-variant': '#243055',        // border
    'on-surface-variant': '#9aa3b2',     // muted
  },
}

// Create Vuetify instance with MDI icons, components, directives, and custom theme
const vuetify = createVuetify({
  components,
  directives,
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: { mdi },
  },
  theme: {
    defaultTheme: 'awesomeposterDark',
    themes: {
      awesomeposterDark,
    },
  },
})

export default vuetify