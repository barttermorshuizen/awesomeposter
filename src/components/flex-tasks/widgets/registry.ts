import { markRaw, type Component } from 'vue'
import DefaultFacetWidget from './DefaultFacetWidget.vue'
import PostVisualWidget from './PostVisualWidget.vue'
import PostVisualInputGallery from './PostVisualInputGallery.vue'
import CompanyInformationWidget from './CompanyInformationWidget.vue'

const registry = new Map<string, Component>([
  ['post_visual', markRaw(PostVisualWidget)],
  ['post_visual.output', markRaw(PostVisualWidget)],
  ['post_visual.input', markRaw(PostVisualInputGallery)],
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
