import { markRaw, type Component } from 'vue'
import DefaultFacetWidget from './DefaultFacetWidget.vue'
import ToneOfVoiceWidget from './ToneOfVoiceWidget.vue'
import ObjectiveBriefWidget from './ObjectiveBriefWidget.vue'
import ClarificationResponseWidget from './ClarificationResponseWidget.vue'

const registry = new Map<string, Component>([
  ['toneOfVoice', markRaw(ToneOfVoiceWidget)],
  ['toneGuidelines', markRaw(ToneOfVoiceWidget)],
  ['objectiveBrief', markRaw(ObjectiveBriefWidget)],
  ['clarificationResponse', markRaw(ClarificationResponseWidget)]
])

export function getFacetWidgetComponent(facetName: string): Component {
  return registry.get(facetName) ?? DefaultFacetWidget
}

export function registerFacetWidget(facetName: string, component: Component) {
  registry.set(facetName, markRaw(component))
}
