export type ConditionVariableType = 'string' | 'number' | 'boolean' | 'array'

export type ConditionComparisonOperator = '==' | '!=' | '<' | '<=' | '>' | '>='
export type ConditionLogicalOperator = '&&' | '||'
export type ConditionUnaryOperator = '!'
export type ConditionBinaryOperator =
  | ConditionComparisonOperator
  | ConditionLogicalOperator

export type JsonLogicExpression =
  | null
  | boolean
  | number
  | string
  | JsonLogicExpression[]
  | { [operator: string]: JsonLogicExpression }

export interface ConditionVariableDefinition {
  /**
   * Stable identifier used in UI selections.
   */
  id: string
  /**
   * Dot-delimited JSON path resolved by the parser.
   */
  path: string
  /**
   * Human-readable label surfaced in UIs.
   */
  label: string
  /**
   * Optional grouping hint for UI organisation.
   */
  group?: string
  /**
   * Data type used for operator validation.
   */
  type: ConditionVariableType
  /**
   * Optional description for documentation/tooltips.
   */
  description?: string
  /**
   * Examples primarily help UI previews and docs.
   */
  example?: unknown
  /**
   * Operators permitted for this variable in comparisons.
   */
  allowedOperators: readonly ConditionComparisonOperator[]
}

export interface ConditionVariableCatalog {
  variables: readonly ConditionVariableDefinition[]
}

export interface ConditionDslPosition {
  /**
   * Zero-based character offset into the original DSL string.
   */
  offset: number
  /**
   * One-based line number derived from the DSL string.
   */
  line: number
  /**
   * One-based column number derived from the DSL string.
   */
  column: number
}

export interface ConditionDslRange {
  start: ConditionDslPosition
  end: ConditionDslPosition
}

export type ConditionDslErrorCode =
  | 'syntax_error'
  | 'unknown_variable'
  | 'operator_not_allowed'
  | 'invalid_json_logic'
  | 'empty_expression'
  | 'type_mismatch'

export interface ConditionDslError {
  code: ConditionDslErrorCode
  message: string
  range: ConditionDslRange
}

export interface ConditionDslWarning {
  code: 'noop_true'
  message: string
  range?: ConditionDslRange
}

export interface ConditionDslParseSuccess {
  ok: true
  /**
   * Fully parsed AST used for downstream conversions.
   */
  ast: ConditionExpressionNode
  /**
   * Canonical JSON-Logic structure for persistence.
   */
  jsonLogic: JsonLogicExpression
  /**
   * Canonical DSL string representation with normalised whitespace.
   */
  canonical: string
  /**
   * Ordered list of catalog entries referenced in the expression.
   */
  variables: readonly ConditionVariableDefinition[]
  warnings: readonly ConditionDslWarning[]
}

export interface ConditionDslParseFailure {
  ok: false
  errors: readonly ConditionDslError[]
}

export type ConditionDslParseResult =
  | ConditionDslParseSuccess
  | ConditionDslParseFailure

export interface ConditionDslRenderSuccess {
  ok: true
  expression: string
}

export interface ConditionDslRenderFailure {
  ok: false
  errors: readonly ConditionDslError[]
}

export type ConditionDslRenderResult =
  | ConditionDslRenderSuccess
  | ConditionDslRenderFailure

export interface EvaluateConditionSuccess {
  ok: true
  result: boolean
  resolvedVariables: Record<string, unknown>
}

export interface EvaluateConditionFailure {
  ok: false
  error: string
}

export type EvaluateConditionResult =
  | EvaluateConditionSuccess
  | EvaluateConditionFailure

export interface SourceRange {
  start: number
  end: number
}

export type ConditionExpressionNode =
  | {
      type: 'literal'
      value: number | string | boolean | null
      range: SourceRange | null
    }
  | {
      type: 'variable'
      path: string
      range: SourceRange | null
    }
  | {
      type: 'unary'
      operator: ConditionUnaryOperator
      argument: ConditionExpressionNode
      range: SourceRange | null
      operatorRange: SourceRange | null
    }
  | {
      type: 'binary'
      operator: ConditionBinaryOperator
      left: ConditionExpressionNode
      right: ConditionExpressionNode
      range: SourceRange | null
      operatorRange: SourceRange | null
    }
