<template>
  <v-container class="py-8">
    <v-row justify="center">
      <v-col cols="12" md="8" lg="6">
        <v-card elevation="2">
          <v-card-title class="text-h5 d-flex align-center">
            <v-icon icon="mdi-poster-outline" class="me-2" />
            Welcome to AwesomePoster
          </v-card-title>
          <v-card-text>
            <p class="mb-4">
              This Vue 3 app is configured with Vuetify 3, Pinia, and Vue Router.
            </p>

            <v-alert type="success" variant="tonal" density="comfortable" class="mb-4">
              Vuetify and MDI icons are working.
            </v-alert>

            <div class="d-flex align-center">
              <v-btn color="primary" variant="elevated" prepend-icon="mdi-plus" @click="store.increment">
                Increment
              </v-btn>
              <div class="ms-4">
                <div>Count: {{ store.count }}</div>
                <div class="text-medium-emphasis">Double: {{ store.doubleCount }}</div>
              </div>
            </div>
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" href="https://vuetifyjs.com" target="_blank" rel="noopener">
              Vuetify Docs
              <v-icon icon="mdi-open-in-new" class="ms-1" />
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { useCounterStore } from '@/stores/counter'

const store = useCounterStore()
</script>

<style scoped>
</style>