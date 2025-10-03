<script setup lang="ts">
import FeatureFlagsPanel from '@/components/settings/FeatureFlagsPanel.vue'
</script>

<template>
  <v-container class="py-8">
    <v-row class="align-center mb-6">
      <v-col cols="12" md="8" class="d-flex align-center">
        <v-icon icon="mdi-cog-outline" class="me-2" />
        <div>
          <h1 class="text-h5 text-md-h4 mb-1">Settings</h1>
          <p class="text-body-2 text-medium-emphasis mb-0">
            Administrative controls for pilot rollout and internal tooling.
          </p>
        </div>
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="12" lg="8">
        <FeatureFlagsPanel />
      </v-col>
    </v-row>
  </v-container>
</template>
