// Logic helper: deterministic, explainable, offline activity understanding and logic suggestions.
//   abbreviations — construction abbreviation dictionary and name normalisation
//   locations     — Level / Area / Zone / Building / Wing / side / grid tokens
//   categories    — twelve MasterFormat-style categories through finer work stages, with the matching terms
//   sequence      — canonical trade sequencing rules with plain-English reasons
//   suggest       — loose ends, cycle-safe and non-redundant link proposals, advisory link reviews
//   csv           — export (client-safe; import it from './csv' in client components)

export { ABBREVIATIONS, normalizeName, foldText, type Abbreviation, type NormalizedName } from './abbreviations'
export { extractLocation, locationTokens, compareLocations, previousLocationGap, type Location, type LocationToken, type LocationKind, type LocationMatch } from './locations'
export { CATEGORIES, STAGES, classifyName, type Classification, type WorkCategory, type StageId, type Modifier } from './categories'
export { STAGE_EDGES, stageDistance, relation, whereText, type Relation, type RelationRule } from './sequence'
export { suggestLogic, profileActivities, redundantLinks, type LogicActivity, type LogicLink, type LogicSuggestion, type LogicAssistResult, type SuggestionKind, type ActivityProfile, type ActivityRef, type SuggestOptions } from './suggest'
export { suggestionsCsv, csvCell, SUGGESTION_KIND_LABEL } from './csv'
