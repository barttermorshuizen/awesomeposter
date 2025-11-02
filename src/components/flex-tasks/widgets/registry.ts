import { markRaw, type Component } from 'vue'
import DefaultFacetWidget from './DefaultFacetWidget.vue'
import ToneOfVoiceWidget from './ToneOfVoiceWidget.vue'
import ObjectiveBriefWidget from './ObjectiveBriefWidget.vue'
import ClarificationResponseWidget from './ClarificationResponseWidget.vue'
import PostVisualWidget from './PostVisualWidget.vue'
import CompanyInformationWidget from './CompanyInformationWidget.vue'

const registry = new Map<string, Component>([
  ['toneOfVoice', markRaw(ToneOfVoiceWidget)],
  ['toneOfVoice.output', markRaw(ToneOfVoiceWidget)],
  ['toneGuidelines', markRaw(ToneOfVoiceWidget)],
  ['toneGuidelines.output', markRaw(ToneOfVoiceWidget)],
  ['objectiveBrief', markRaw(ObjectiveBriefWidget)],
  ['objectiveBrief.output', markRaw(ObjectiveBriefWidget)],
  ['clarificationResponse', markRaw(ClarificationResponseWidget)],
  ['clarificationResponse.output', markRaw(ClarificationResponseWidget)],
  ['post_visual', markRaw(PostVisualWidget)],
  ['post_visual.output', markRaw(PostVisualWidget)],
  ['company_information.input', markRaw(CompanyInformationWidget)]
])

export function getOutputFacetWidgetComponent(facetName: string): Component {
  return (
    registry.get(`${facetName}.output`) ??
    registry.get(facetName) ??
    DefaultFacetWidget
  )
}

export function getInputFacetWidgetComponent(facetName: string): Component | null {
  return registry.get(`${facetName}.input`) ?? null
}

export function getFacetWidgetComponent(facetName: string): Component {
  return getOutputFacetWidgetComponent(facetName)
}

export function registerFacetWidget(
  facetName: string,
  component: Component,
  direction: 'input' | 'output' = 'output'
) {
  if (direction === 'input') {
    registry.set(`${facetName}.input`, markRaw(component))
    return
  }
  registry.set(`${facetName}.output`, markRaw(component))
  registry.set(facetName, markRaw(component))
}
