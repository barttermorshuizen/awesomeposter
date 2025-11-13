import { markRaw, type Component } from 'vue'
import DefaultFacetWidget from './DefaultFacetWidget.vue'
import PostVisualWidget from './PostVisualWidget.vue'
import PostVisualInputGallery from './PostVisualInputGallery.vue'
import CompanyInformationWidget from './CompanyInformationWidget.vue'
import SocialPostPreview from './SocialPostPreview.vue'
import FeedbackInlineDecorator from './FeedbackInlineDecorator.vue'

export type InputFacetDecoratorEntry = {
  id: string
  facet: string
  component: Component
}

const registry = new Map<string, Component>([
  ['post_visual', markRaw(PostVisualWidget)],
  ['post_visual.output', markRaw(PostVisualWidget)],
  ['post_visual.input', markRaw(PostVisualInputGallery)],
  ['company_information.input', markRaw(CompanyInformationWidget)],
  ['social_post.preview', markRaw(SocialPostPreview)],
  ['social_post.preview.output', markRaw(SocialPostPreview)],
  ['post', markRaw(SocialPostPreview)],
  ['post.output', markRaw(SocialPostPreview)]
])

const inputDecorators: InputFacetDecoratorEntry[] = []

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

export function registerInputFacetDecorator(entry: InputFacetDecoratorEntry) {
  const normalized: InputFacetDecoratorEntry = {
    ...entry,
    component: markRaw(entry.component)
  }
  const existingIndex = inputDecorators.findIndex((decorator) => decorator.id === normalized.id)
  if (existingIndex >= 0) {
    inputDecorators.splice(existingIndex, 1, normalized)
    return
  }
  inputDecorators.push(normalized)
}

export function getInputFacetDecorators(activeFacets: string[]): InputFacetDecoratorEntry[] {
  if (!activeFacets.length) return []
  const facetSet = new Set(activeFacets)
  return inputDecorators.filter((decorator) => facetSet.has(decorator.facet))
}

registerInputFacetDecorator({
  id: 'feedback.inline',
  facet: 'feedback',
  component: FeedbackInlineDecorator
})
