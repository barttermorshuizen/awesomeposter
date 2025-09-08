# [Historical] AwesomePoster: Nuxt UI to Vuetify Migration Plan

Note: This document reflects a past migration path (Nuxt UI → Vuetify 3 under Nuxt). The current project stack uses Vue 3 + Vite for the frontend and Nitro/H3 for the API/server. Keep this file for historical context; do not treat it as the active plan.

## Overview

This document outlines the complete migration strategy for transitioning the AwesomePoster project from Nuxt UI to Vuetify 3, including both frontend components and backend API preservation.

## Current Project Analysis

### Frontend Stack
- **Nuxt 4.0.3** with Nuxt UI 3.3.2
- **Tailwind CSS** for styling with custom dark theme
- **Heroicons** for icons
- **Custom CSS variables** for theming (dark blue/gray palette)
- Complex components: data tables, forms, file uploads, modals

### Backend API Structure
- **34 API endpoints** across multiple domains
- **Drizzle ORM** with PostgreSQL
- **Cloudflare R2** storage integration
- **AI agent orchestration** system
- **Real-time workflow** progress tracking
- **Email ingestion** and processing

## Migration Strategy

### Phase 1: Setup New Vuetify Project (1-2 days)

#### 1.1 Create New Project Structure
```bash
# Create new Vuetify-based project
npx nuxi@latest init awesomeposter
cd awesomeposter
```

#### 1.2 Install Vuetify 3
```bash
npm install vuetify @mdi/font
npm install -D @nuxt/eslint @nuxt/test-utils
```

#### 1.3 Configure Nuxt for Vuetify
Update `nuxt.config.ts`:
```typescript
export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/test-utils'],
  css: ['vuetify/lib/styles/main.sass', '@mdi/font/css/materialdesignicons.css'],
  build: {
    transpile: ['vuetify']
  }
})
```

#### 1.4 Create Custom Theme
Create `plugins/vuetify.ts`:
```typescript
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

export default defineNuxtPlugin(() => {
  const vuetify = createVuetify({
    components,
    directives,
    theme: {
      defaultTheme: 'dark',
      themes: {
        dark: {
          colors: {
            primary: '#6ea8fe',    // --accent
            background: '#0b1020', // --bg
            surface: '#121a33',    // --panel
            'on-surface': '#e6e8ef', // --fg
            'surface-variant': '#243055', // --border
            'on-surface-variant': '#9aa3b2' // --muted
          }
        }
      }
    }
  })
  
  nuxtApp.vueApp.use(vuetify)
})
```

### Phase 2: API Migration (2-3 days)

#### 2.1 Copy All Server API Endpoints (34 endpoints)

**Briefs API (7 endpoints):**
- `server/api/briefs/index.get.ts` - List briefs with client joins
- `server/api/briefs/index.post.ts` - Create new brief
- `server/api/briefs/[id]/index.get.ts` - Get brief by ID
- `server/api/briefs/[id]/index.patch.ts` - Update brief
- `server/api/briefs/[id]/index.delete.ts` - Delete brief with cascading
- `server/api/briefs/[id]/approve.post.ts` - Approve brief workflow
- `server/api/briefs/[id]/assets.get.ts` - Get brief assets
- `server/api/briefs/[id]/send-to-agent.post.ts` - Trigger AI workflow

**Clients API (6 endpoints):**
- `server/api/clients/index.get.ts` - List all clients
- `server/api/clients/index.post.ts` - Create new client
- `server/api/clients/[id]/index.get.ts` - Get client by ID
- `server/api/clients/[id]/index.delete.ts` - Delete client with cleanup
- `server/api/clients/[id]/profile.get.ts` - Get client profile with JSON fields
- `server/api/clients/[id]/profile.patch.ts` - Update client profile

**Assets API (5 endpoints):**
- `server/api/assets/index.get.ts` - List assets with filtering
- `server/api/assets/index.post.ts` - Create asset upload URL
- `server/api/assets/upload.post.ts` - Handle file upload to R2
- `server/api/assets/[id]/index.patch.ts` - Update asset metadata
- `server/api/assets/[id]/index.delete.ts` - Delete asset from R2 and DB
- `server/api/assets/[id]/download.get.ts` - Generate signed download URL

**Agent API (6 endpoints):**
- `server/api/agent/plan-strategy.post.ts` - AI strategy planning
- `server/api/agent/write-drafts.post.ts` - Generate content drafts
- `server/api/agent/critique-revise.post.ts` - Evaluate and improve drafts
- `server/api/agent/finalize.post.ts` - Finalize strategy
- `server/api/agent/execute-workflow.post.ts` - Run complete workflow
- `server/api/agent/execute-workflow-progress.post.ts` - Progressive workflow
- `server/api/agent/workflow-status.get.ts` - Check workflow status

**Other APIs (7 endpoints):**
- `server/api/inbound/mailgun.post.ts` - Webhook processing
- `server/api/tasks/index.get.ts` - List tasks
- `server/api/tasks/[id]/complete.post.ts` - Complete task
- `server/api/generate-variants.post.ts` - Generate content variants
- `server/api/rank-variants.post.ts` - Rank content variants
- `server/api/retrieve-winners.post.ts` - Get winning content
- `server/api/test-client-profile.get.ts` - Test profile generation

#### 2.2 Copy Server Utilities
```
server/utils/
├── db.ts                    # Database connection and queries
├── env.ts                   # Environment configuration
├── storage.ts               # R2 storage integration
├── llm.ts                   # OpenAI integration
├── queue.ts                 # Job queue system
├── sample-client-profile.ts # Profile generation
└── agents/
    ├── orchestrator.ts      # Main AI orchestrator
    ├── copywriter.ts        # Copywriting agent
    └── digital-marketeer.ts # Marketing agent
```

#### 2.3 Copy Server Jobs
```
server/jobs/
└── parse-email.ts          # Email processing job
```

#### 2.4 Copy Package Dependencies
Update `package.json` with all backend dependencies:
```json
{
  "dependencies": {
    "@awesomeposter/db": "file:../../packages/db",
    "@awesomeposter/shared": "file:../../packages/shared",
    "@aws-sdk/client-s3": "^3.864.0",
    "@aws-sdk/s3-request-presigner": "^3.873.0",
    "drizzle-orm": "^0.44.4",
    "openai": "^5.12.2",
    "pg": "^8.16.3",
    "zod": "^3.25.76"
  }
}
```

### Phase 3: Core Layout Migration (2-3 days)

#### 3.1 Migrate Main Layout
Replace `app/layouts/default.vue`:
```vue
<template>
  <v-app>
    <v-navigation-drawer
      v-model="drawer"
      :rail="rail"
      permanent
      @click="rail = false"
    >
      <v-list-item
        prepend-avatar="https://randomuser.me/api/portraits/men/85.jpg"
        title="AwesomePoster"
        nav
      >
        <template v-slot:append>
          <v-btn
            variant="text"
            icon="mdi-chevron-left"
            @click.stop="rail = !rail"
          ></v-btn>
        </template>
      </v-list-item>

      <v-divider></v-divider>

      <v-list density="compact" nav>
        <v-list-item
          v-for="item in navigationItems"
          :key="item.title"
          :prepend-icon="item.icon"
          :title="item.title"
          :to="item.to"
          :value="item.title"
        ></v-list-item>
      </v-list>
    </v-navigation-drawer>

    <v-app-bar>
      <v-app-bar-nav-icon @click="drawer = !drawer"></v-app-bar-nav-icon>
      <v-toolbar-title>{{ pageTitle }}</v-toolbar-title>
      <v-spacer></v-spacer>
      <v-text-field
        hide-details
        placeholder="Search"
        prepend-inner-icon="mdi-magnify"
        variant="outlined"
        density="compact"
        style="max-width: 300px;"
      ></v-text-field>
      <v-btn
        color="primary"
        prepend-icon="mdi-plus"
        to="/briefs-new"
      >
        New Brief
      </v-btn>
    </v-app-bar>

    <v-main>
      <v-container fluid>
        <slot />
      </v-container>
    </v-main>
  </v-app>
</template>

<script setup>
const drawer = ref(true)
const rail = ref(false)

const navigationItems = [
  { title: 'Dashboard', icon: 'mdi-view-dashboard', to: '/' },
  { title: 'Briefs', icon: 'mdi-file-document', to: '/briefs' },
  { title: 'Inbox', icon: 'mdi-inbox', to: '/inbox' },
  { title: 'Clients', icon: 'mdi-account-group', to: '/clients' },
  { title: 'Assets', icon: 'mdi-folder-image', to: '/assets' },
  { title: 'Settings', icon: 'mdi-cog', to: '/settings' }
]

const route = useRoute()
const pageTitle = computed(() => {
  const item = navigationItems.find(item => item.to === route.path)
  return item?.title || 'AwesomePoster'
})
</script>
```

### Phase 4: Component Migration (5-7 days)

#### 4.1 Data Tables Migration

**Before (Nuxt UI):**
```vue
<UTable
  :data="tableRows"
  :columns="columns"
  :loading="isLoading"
  class="w-full min-w-full table-auto"
/>
```

**After (Vuetify):**
```vue
<v-data-table
  :headers="headers"
  :items="items"
  :loading="loading"
  :search="search"
  class="elevation-1"
>
  <template v-slot:item.actions="{ item }">
    <v-icon
      size="small"
      class="me-2"
      @click="editItem(item)"
    >
      mdi-pencil
    </v-icon>
    <v-icon
      size="small"
      @click="deleteItem(item)"
    >
      mdi-delete
    </v-icon>
  </template>
</v-data-table>
```

#### 4.2 Forms Migration

**Before (Nuxt UI):**
```vue
<UInput v-model="localQuery" icon="i-heroicons-magnifying-glass-20-solid" placeholder="Search briefs" />
<UButton color="primary" icon="i-heroicons-plus" label="New" />
```

**After (Vuetify):**
```vue
<v-text-field
  v-model="localQuery"
  prepend-inner-icon="mdi-magnify"
  placeholder="Search briefs"
  variant="outlined"
  density="compact"
></v-text-field>
<v-btn
  color="primary"
  prepend-icon="mdi-plus"
>
  New
</v-btn>
```

#### 4.3 File Upload Migration

**Before (Custom with drag-drop):**
```vue
<div 
  class="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6"
  @dragover.prevent="isDragOver = true"
  @drop.prevent="handleDrop"
>
  <!-- Custom upload area -->
</div>
```

**After (Vuetify):**
```vue
<v-file-input
  v-model="files"
  multiple
  prepend-icon="mdi-camera"
  accept="image/*,.pdf,.doc,.docx,.txt,.mp4,.mov,.avi,.wmv,.flv,.webm"
  label="Upload files"
  variant="outlined"
  @change="handleFileSelect"
></v-file-input>

<!-- Custom drag-drop area -->
<v-card
  class="mx-auto pa-12 pb-8"
  elevation="8"
  max-width="448"
  rounded="lg"
  @dragover.prevent="isDragOver = true"
  @drop.prevent="handleDrop"
>
  <v-card-text class="text-center">
    <v-icon
      class="mb-5"
      color="primary"
      icon="mdi-cloud-upload"
      size="112"
    ></v-icon>
    <div class="text-h6 mb-2">Drop files here or click to upload</div>
    <div class="text-caption">PNG, JPG, PDF, DOC, MP4, MOV, AVI up to 10MB each</div>
  </v-card-text>
</v-card>
```

#### 4.4 Modals Migration

**Before (Custom modal):**
```vue
<div v-if="showDeleteModal" class="fixed inset-0 z-50 flex items-center justify-center">
  <div class="absolute inset-0 bg-black/50" @click="showDeleteModal = false" />
  <div class="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4">
    <!-- Modal content -->
  </div>
</div>
```

**After (Vuetify):**
```vue
<v-dialog v-model="showDeleteModal" max-width="500px">
  <v-card>
    <v-card-title class="text-h5">
      <v-icon color="error" class="me-2">mdi-alert</v-icon>
      Delete Brief
    </v-card-title>
    <v-card-text>
      Are you sure you want to delete <strong>{{ briefToDelete?.title }}</strong>?
      This action cannot be undone.
    </v-card-text>
    <v-card-actions>
      <v-spacer></v-spacer>
      <v-btn color="blue-darken-1" variant="text" @click="showDeleteModal = false">
        Cancel
      </v-btn>
      <v-btn color="error" variant="text" @click="confirmDelete" :loading="isDeleting">
        Delete
      </v-btn>
    </v-card-actions>
  </v-card>
</v-dialog>
```

### Phase 5: API Integration Testing (1-2 days)

#### 5.1 Test All API Endpoints
Create test checklist:
- [ ] Briefs CRUD operations
- [ ] Client management with profiles
- [ ] Asset upload/download with R2
- [ ] AI agent workflows
- [ ] Email webhook processing
- [ ] Task management

#### 5.2 Verify Data Flow
- [ ] Form submissions to POST/PATCH endpoints
- [ ] File uploads to `/api/assets/upload`
- [ ] Delete confirmations to DELETE endpoints
- [ ] Real-time updates from agent workflows

### Phase 6: Styling & Cleanup (2-3 days)

#### 6.1 Remove Tailwind Dependencies
```bash
npm uninstall @nuxtjs/tailwindcss @tailwindcss/postcss autoprefixer
```

#### 6.2 Remove Nuxt UI Dependencies
```bash
npm uninstall @nuxt/ui @iconify-json/heroicons @nuxt/icon
```

#### 6.3 Update Configuration
Remove from `nuxt.config.ts`:
```typescript
// Remove these lines
modules: ['@nuxt/ui', '@nuxt/icon'],
css: ['~/assets/tailwind.css'],
postcss: {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {}
  }
}
```

### Phase 7: Final Testing & Documentation (2-3 days)

#### 7.1 End-to-End Testing
- [ ] Complete user workflows
- [ ] API integration verification
- [ ] File upload/download functionality
- [ ] AI agent execution
- [ ] Responsive design testing

#### 7.2 Performance Optimization
- [ ] Bundle size analysis
- [ ] Loading performance
- [ ] API response times

#### 7.3 Documentation Updates
- [ ] Update README.md
- [ ] Update deployment instructions
- [ ] Update development setup guide

## Component Mapping Reference

| Current (Nuxt UI) | Vuetify Equivalent | Migration Notes |
|-------------------|-------------------|-----------------|
| `UInput` | `v-text-field` | Built-in validation, multiple variants |
| `UButton` | `v-btn` | Color system, loading states, icons |
| `UCard` | `v-card` | Header/content/actions structure |
| `UTable` | `v-data-table` | Advanced sorting, filtering, pagination |
| `UBadge` | `v-chip` | Color variants, closable, clickable |
| `UAlert` | `v-alert` | Multiple types, dismissible |
| Custom Modal | `v-dialog` | Better accessibility, animations |
| Toast | `v-snackbar` | Built-in positioning, actions |

## Timeline Summary

| Phase | Duration | Activities |
|-------|----------|------------|
| 1 | 1-2 days | Project setup, Vuetify configuration |
| 2 | 2-3 days | **API migration (34 endpoints + utilities)** |
| 3 | 2-3 days | Layout and navigation migration |
| 4 | 5-7 days | Component migration (tables, forms, modals) |
| 5 | 1-2 days | **API integration testing** |
| 6 | 2-3 days | Styling cleanup, dependency removal |
| 7 | 2-3 days | Final testing and documentation |

**Total: 3-4 weeks**

## Risk Mitigation

1. **API Preservation**: All 34 endpoints copied with zero modification
2. **Data Integrity**: Database operations remain unchanged
3. **Feature Parity**: Every UI component has Vuetify equivalent
4. **Testing Strategy**: Phase-by-phase verification
5. **Rollback Plan**: Maintain original project until migration complete

## Success Criteria

- [ ] All 34 API endpoints functional
- [ ] All UI components migrated to Vuetify
- [ ] File upload/download working with R2
- [ ] AI agent workflows operational
- [ ] Database operations preserved
- [ ] Performance maintained or improved
- [ ] Zero data loss during migration

## Post-Migration Benefits

1. **Better Material Design** compliance and accessibility
2. **Reduced bundle size** (eliminate Tailwind + Nuxt UI overhead)
3. **More robust components** with better TypeScript support
4. **Consistent theming** system across all components
5. **Better mobile responsiveness** out of the box
6. **Active maintenance** and long-term support
7. **Enhanced developer experience** with comprehensive documentation

---

*This migration plan ensures complete preservation of all backend functionality while modernizing the frontend with Vuetify's robust component system.*
