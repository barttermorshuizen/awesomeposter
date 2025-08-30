<script setup lang="ts">
interface Props {
  title: string
  description?: string
  icon?: string
}
const props = defineProps<Props>()
</script>

<template>
  <v-container class="py-8">
    <v-row>
      <v-col cols="12">
        <div class="d-flex align-center mb-4">
          <v-icon :icon="props.icon || 'mdi-view-dashboard-outline'" class="me-2" />
          <h1 class="text-h5 text-md-h4">{{ props.title }}</h1>
        </div>
        <p class="text-medium-emphasis mb-6" v-if="props.description">{{ props.description }}</p>
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="12" md="8" lg="9">
        <v-card elevation="2">
          <v-card-text>
            <v-skeleton-loader type="article, list-item@3" class="mb-4" />
            <div class="text-medium-emphasis">
              Placeholder content area for the "{{ props.title }}" screen.
            </div>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="4" lg="3">
        <v-card elevation="2">
          <v-card-title class="text-subtitle-1">Side Panel</v-card-title>
          <v-card-text>
            <v-skeleton-loader type="list-item@4" />
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<style scoped>
</style>