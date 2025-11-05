import {
  type ConditionBinaryOperator,
  type ConditionComparisonOperator,
  type ConditionDslError,
  type ConditionDslParseFailure,
  type ConditionDslParseResult,
  type ConditionDslParseSuccess,
  type ConditionDslRenderResult,
  type ConditionDslRenderSuccess,
  type ConditionDslWarning,
  type ConditionExpressionNode,
  type ConditionQuantifierOperator,
  type ConditionUnaryOperator,
  type ConditionVariableCatalog,
  type ConditionVariableDefinition,
  type ConditionVariableType,
  type EvaluateConditionFailure,
  type EvaluateConditionResult,
  type EvaluateConditionSuccess,
  type JsonLogicExpression,
  type SourceRange,
} from './types.js'

interface Token {
  kind: TokenKind
  value: string
  start: number
  end: number
}

type TokenKind =
  | 'identifier'
  | 'number'
  | 'string'
  | 'boolean'
  | 'operator'
  | 'not'
  | 'paren'
  | 'comma'

interface ParseContext {
  tokens: readonly Token[]
  index: number
  input: string
}

interface ParseError extends Error {
  position?: number
}

interface LineIndex {
  get(offset: number): { line: number; column: number }
}

export function parseDsl(
  expression: string,
  catalog: ConditionVariableCatalog,
): ConditionDslParseResult {
  const trimmed = expression.trim()
  const index = createLineIndex(expression)

  if (!trimmed) {
    return {
      ok: false,
      errors: [
        createDiagnostic(
          {
            code: 'empty_expression',
            message: 'Expression is empty.',
          },
          index,
          0,
          0,
        ),
      ],
    }
  }

  let tokens: Token[]
  try {
    tokens = tokenize(expression)
  } catch (error) {
    return toFailure(normaliseError(error), index)
  }

  const ctx: ParseContext = {
    tokens,
    index: 0,
    input: expression,
  }

  let ast: ConditionExpressionNode
  try {
    ast = parseExpression(ctx)
    ensureEnd(ctx)
  } catch (error) {
    return toFailure(normaliseError(error), index)
  }

  const validationErrors = validateAst(ast, catalog, index)
  if (validationErrors.length > 0) {
    return {
      ok: false,
      errors: validationErrors,
    }
  }

  const jsonLogic = expressionToJsonLogic(ast)
  const canonical = renderExpression(ast)
  const variables = collectVariableDefinitions(ast, catalog)

  const warnings: ConditionDslWarning[] = []
  if (canonical === 'true') {
    warnings.push({ code: 'noop_true', message: 'Expression always resolves to true.' })
  }

  const result: ConditionDslParseSuccess = {
    ok: true,
    ast,
    jsonLogic,
    canonical,
    variables,
    warnings,
  }
  return result
}

export function toDsl(
  jsonLogic: JsonLogicExpression,
  catalog: ConditionVariableCatalog,
): ConditionDslRenderResult {
  const index = createLineIndex('')
  try {
    const lookup = buildCatalogLookup(catalog)
    const ast = jsonLogicToExpression(jsonLogic, lookup)
    const validationErrors = validateAst(ast, catalog, index)
    if (validationErrors.length > 0) {
      return {
        ok: false,
        errors: validationErrors,
      }
    }
    const expression = renderExpression(ast)
    const result: ConditionDslRenderSuccess = {
      ok: true,
      expression,
    }
    return result
  } catch (error) {
    return {
      ok: false,
      errors: [
        createDiagnostic(
          {
            code: 'invalid_json_logic',
            message:
              error instanceof Error
                ? error.message
                : 'Unable to convert JSON-Logic payload.',
          },
          index,
          0,
          0,
        ),
      ],
    }
  }
}

export function evaluateCondition(
  jsonLogic: JsonLogicExpression,
  payload: unknown,
): EvaluateConditionResult {
  try {
    const resolved: Record<string, unknown> = {}
    const result = Boolean(evaluate(jsonLogic, payload, resolved))
    const success: EvaluateConditionSuccess = { ok: true, result, resolvedVariables: resolved }
    return success
  } catch (error) {
    const failure: EvaluateConditionFailure = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
    return failure
  }
}

function createLineIndex(input: string): LineIndex {
  const starts: number[] = [0]
  for (let i = 0; i < input.length; i += 1) {
    if (input[i] === '\n') {
      starts.push(i + 1)
    }
  }
  return {
    get(offset: number) {
      const clamped = Math.max(0, Math.min(offset, input.length))
      let low = 0
      let high = starts.length - 1
      while (low <= high) {
        const mid = Math.floor((low + high) / 2)
        const start = starts[mid]
        const next = mid + 1 < starts.length ? starts[mid + 1] : input.length + 1
        if (clamped < start) {
          high = mid - 1
        } else if (clamped >= next) {
          low = mid + 1
        } else {
          return {
            line: mid + 1,
            column: clamped - start + 1,
          }
        }
      }
      const last = starts[starts.length - 1] ?? 0
      return {
        line: starts.length,
        column: clamped - last + 1,
      }
    },
  }
}

function toFailure(
  error: { message: string; position?: number },
  index: LineIndex,
): ConditionDslParseFailure {
  const position = typeof error.position === 'number' ? error.position : 0
  const diagnostic = createDiagnostic(
    { code: 'syntax_error', message: error.message },
    index,
    position,
    position + 1,
  )
  return {
    ok: false,
    errors: [diagnostic],
  }
}

function normaliseError(error: unknown): { message: string; position?: number } {
  if (error && typeof error === 'object' && 'message' in error) {
    const err = error as ParseError
    return { message: err.message, position: err.position }
  }
  return { message: String(error) }
}

function createDiagnostic(
  info: { code: ConditionDslError['code']; message: string },
  index: LineIndex,
  startOffset: number,
  endOffset: number,
): ConditionDslError {
  const start = index.get(startOffset)
  const end = index.get(Math.max(startOffset, endOffset))
  return {
    code: info.code,
    message: info.message,
    range: {
      start: { offset: startOffset, line: start.line, column: start.column },
      end: { offset: endOffset, line: end.line, column: end.column },
    },
  }
}

function ensureEnd(ctx: ParseContext): void {
  if (ctx.index < ctx.tokens.length) {
    const token = ctx.tokens[ctx.index]
    throw createParseError(`Unexpected token \`${token.value}\`.`, ctx, token.start)
  }
}

function parseExpression(ctx: ParseContext): ConditionExpressionNode {
  return parseOr(ctx)
}

function parseOr(ctx: ParseContext): ConditionExpressionNode {
  let node = parseAnd(ctx)
   
  while (true) {
    const token = matchOperator(ctx, '||')
    if (!token) break
    const right = parseAnd(ctx)
    node = {
      type: 'binary',
      operator: '||',
      left: node,
      right,
      range: combineRanges(node.range, right.range),
      operatorRange: { start: token.start, end: token.end },
    }
  }
  return node
}

function parseAnd(ctx: ParseContext): ConditionExpressionNode {
  let node = parseEquality(ctx)
   
  while (true) {
    const token = matchOperator(ctx, '&&')
    if (!token) break
    const right = parseEquality(ctx)
    node = {
      type: 'binary',
      operator: '&&',
      left: node,
      right,
      range: combineRanges(node.range, right.range),
      operatorRange: { start: token.start, end: token.end },
    }
  }
  return node
}

function parseEquality(ctx: ParseContext): ConditionExpressionNode {
  let node = parseComparison(ctx)
   
  while (true) {
    const eqToken = matchOperator(ctx, '==')
    if (eqToken) {
      const right = parseComparison(ctx)
      node = {
        type: 'binary',
        operator: '==',
        left: node,
        right,
        range: combineRanges(node.range, right.range),
        operatorRange: { start: eqToken.start, end: eqToken.end },
      }
      continue
    }
    const neToken = matchOperator(ctx, '!=')
    if (neToken) {
      const right = parseComparison(ctx)
      node = {
        type: 'binary',
        operator: '!=',
        left: node,
        right,
        range: combineRanges(node.range, right.range),
        operatorRange: { start: neToken.start, end: neToken.end },
      }
      continue
    }
    break
  }
  return node
}

function parseComparison(ctx: ParseContext): ConditionExpressionNode {
  let node = parseUnary(ctx)
   
  while (true) {
    const gteToken = matchOperator(ctx, '>=')
    if (gteToken) {
      const right = parseUnary(ctx)
      node = {
        type: 'binary',
        operator: '>=',
        left: node,
        right,
        range: combineRanges(node.range, right.range),
        operatorRange: { start: gteToken.start, end: gteToken.end },
      }
      continue
    }

    const lteToken = matchOperator(ctx, '<=')
    if (lteToken) {
      const right = parseUnary(ctx)
      node = {
        type: 'binary',
        operator: '<=',
        left: node,
        right,
        range: combineRanges(node.range, right.range),
        operatorRange: { start: lteToken.start, end: lteToken.end },
      }
      continue
    }

    const gtToken = matchOperator(ctx, '>')
    if (gtToken) {
      const right = parseUnary(ctx)
      node = {
        type: 'binary',
        operator: '>',
        left: node,
        right,
        range: combineRanges(node.range, right.range),
        operatorRange: { start: gtToken.start, end: gtToken.end },
      }
      continue
    }

    const ltToken = matchOperator(ctx, '<')
    if (ltToken) {
      const right = parseUnary(ctx)
      node = {
        type: 'binary',
        operator: '<',
        left: node,
        right,
        range: combineRanges(node.range, right.range),
        operatorRange: { start: ltToken.start, end: ltToken.end },
      }
      continue
    }
    break
  }
  return node
}

function parseUnary(ctx: ParseContext): ConditionExpressionNode {
  const token = matchKind(ctx, 'not')
  if (token) {
    const argument = parseUnary(ctx)
    return {
      type: 'unary',
      operator: '!',
      argument,
      range: combineRanges({ start: token.start, end: token.end }, argument.range),
      operatorRange: { start: token.start, end: token.end },
    }
  }
  return parsePrimary(ctx)
}

function parsePrimary(ctx: ParseContext): ConditionExpressionNode {
  const token = peek(ctx)
  if (!token) {
    throw createParseError('Unexpected end of expression.', ctx)
  }

  switch (token.kind) {
    case 'number': {
      consume(ctx)
      return {
        type: 'literal',
        value: Number(token.value),
        range: { start: token.start, end: token.end },
      }
    }
    case 'string': {
      consume(ctx)
      return {
        type: 'literal',
        value: token.value,
        range: { start: token.start, end: token.end },
      }
    }
    case 'boolean': {
      consume(ctx)
      return {
        type: 'literal',
        value: token.value === 'true',
        range: { start: token.start, end: token.end },
      }
    }
    case 'identifier': {
      consume(ctx)
      if (
        (token.value === 'some' || token.value === 'all') &&
        peek(ctx)?.kind === 'paren' &&
        peek(ctx)?.value === '('
      ) {
        return parseQuantifier(ctx, token)
      }
      if (token.value === 'null') {
        return {
          type: 'literal',
          value: null,
          range: { start: token.start, end: token.end },
        }
      }
      return {
        type: 'variable',
        path: token.value,
        range: { start: token.start, end: token.end },
      }
    }
    case 'paren': {
      if (token.value === '(') {
        consume(ctx)
        const expr = parseExpression(ctx)
        const closing = consume(ctx)
        if (!closing || closing.kind !== 'paren' || closing.value !== ')') {
          throw createParseError('Unclosed parenthesis.', ctx, token.start)
        }
        return {
          ...expr,
          range: combineRanges({ start: token.start, end: token.end }, { start: closing.start, end: closing.end }),
        }
      }
      break
    }
  }

  throw createParseError(`Unexpected token \`${token.value}\`.`, ctx, token.start)
}

function combineRanges(left: SourceRange | null, right: SourceRange | null): SourceRange | null {
  if (!left && !right) return null
  if (!left) return right
  if (!right) return left
  return {
    start: Math.min(left.start, right.start),
    end: Math.max(left.end, right.end),
  }
}

function parseQuantifier(ctx: ParseContext, operatorToken: Token): ConditionExpressionNode {
  const opening = matchKind(ctx, 'paren')
  if (!opening || opening.value !== '(') {
    throw createParseError(`Expected \`(\` after \`${operatorToken.value}\`.`, ctx, operatorToken.end)
  }

  const collection = parseExpression(ctx)

  let alias = 'item'
  let aliasProvided = false
  let aliasRange: SourceRange | null = null

  const maybeAs = peek(ctx)
  if (maybeAs && maybeAs.kind === 'identifier' && maybeAs.value === 'as') {
    consume(ctx) // consume `as`
    const aliasToken = matchKind(ctx, 'identifier')
    if (!aliasToken) {
      throw createParseError('Expected alias identifier after `as`.', ctx)
    }
    if (aliasToken.value.includes('.')) {
      throw createParseError('Alias may not contain `.` segments.', ctx, aliasToken.start)
    }
    alias = aliasToken.value
    aliasProvided = true
    aliasRange = { start: aliasToken.start, end: aliasToken.end }
  }

  const comma = matchKind(ctx, 'comma')
  if (!comma) {
    throw createParseError('Expected `,` after quantifier collection.', ctx)
  }

  const predicate = parseExpression(ctx)
  const closing = consume(ctx)
  if (!closing || closing.kind !== 'paren' || closing.value !== ')') {
    throw createParseError('Unclosed quantifier predicate.', ctx, operatorToken.start)
  }

  const node: ConditionExpressionNode = {
    type: 'quantifier',
    operator: operatorToken.value as 'some' | 'all',
    collection,
    predicate,
    alias,
    aliasProvided,
    range: { start: operatorToken.start, end: closing.end },
    operatorRange: { start: operatorToken.start, end: operatorToken.end },
    collectionRange: collection.range,
    aliasRange,
    predicateRange: predicate.range,
  }

  return node
}

function matchOperator(ctx: ParseContext, operator: ConditionBinaryOperator): Token | null {
  const token = peek(ctx)
  if (token && token.kind === 'operator' && token.value === operator) {
    consume(ctx)
    return token
  }
  return null
}

function matchKind(ctx: ParseContext, kind: TokenKind): Token | null {
  const token = peek(ctx)
  if (token && token.kind === kind) {
    consume(ctx)
    return token
  }
  return null
}

function peek(ctx: ParseContext): Token | undefined {
  return ctx.tokens[ctx.index]
}

function consume(ctx: ParseContext): Token | undefined {
  const token = ctx.tokens[ctx.index]
  if (token) {
    ctx.index += 1
  }
  return token
}

function createParseError(message: string, ctx: ParseContext, position?: number): Error {
  const err = new Error(message)
  ;(err as ParseError).position =
    typeof position === 'number' ? position : ctx.tokens[Math.max(ctx.index - 1, 0)]?.end ?? 0
  return err
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  const length = input.length

  while (index < length) {
    const char = input[index]!

    if (isWhitespace(char)) {
      index += 1
      continue
    }

    if (char === '(' || char === ')') {
      tokens.push({
        kind: 'paren',
        value: char,
        start: index,
        end: index + 1,
      })
      index += 1
      continue
    }

    if (char === ',') {
      tokens.push({
        kind: 'comma',
        value: ',',
        start: index,
        end: index + 1,
      })
      index += 1
      continue
    }

    if (char === '&' && input[index + 1] === '&') {
      tokens.push({
        kind: 'operator',
        value: '&&',
        start: index,
        end: index + 2,
      })
      index += 2
      continue
    }

    if (char === '|' && input[index + 1] === '|') {
      tokens.push({
        kind: 'operator',
        value: '||',
        start: index,
        end: index + 2,
      })
      index += 2
      continue
    }

    if (char === '=' && input[index + 1] === '=') {
      tokens.push({
        kind: 'operator',
        value: '==',
        start: index,
        end: index + 2,
      })
      index += 2
      continue
    }

    if (char === '!' && input[index + 1] === '=') {
      tokens.push({
        kind: 'operator',
        value: '!=',
        start: index,
        end: index + 2,
      })
      index += 2
      continue
    }

    if (char === '>' || char === '<') {
      if (input[index + 1] === '=') {
        tokens.push({
          kind: 'operator',
          value: `${char}=`,
          start: index,
          end: index + 2,
        })
        index += 2
        continue
      }
      tokens.push({
        kind: 'operator',
        value: char,
        start: index,
        end: index + 1,
      })
      index += 1
      continue
    }

    if (char === '!') {
      tokens.push({
        kind: 'not',
        value: '!',
        start: index,
        end: index + 1,
      })
      index += 1
      continue
    }

    if (char === '"' || char === "'") {
      const closingIndex = findClosingQuote(input, index + 1, char)
      if (closingIndex === -1) {
        const err = new Error('Unterminated string literal.')
        ;(err as ParseError).position = index
        throw err
      }
      const raw = input.slice(index + 1, closingIndex)
      tokens.push({
        kind: 'string',
        value: unescapeString(raw),
        start: index,
        end: closingIndex + 1,
      })
      index = closingIndex + 1
      continue
    }

    if (isDigit(char) || (char === '.' && isDigit(input[index + 1]!))) {
      const start = index
      index += 1
      while (index < length && (isDigit(input[index]!) || input[index] === '.')) {
        index += 1
      }
      const raw = input.slice(start, index)
      tokens.push({
        kind: 'number',
        value: raw,
        start,
        end: index,
      })
      continue
    }

    if (isIdentifierStart(char)) {
      const start = index
      index += 1
      while (index < length && isIdentifierPart(input[index]!)) {
        index += 1
      }
      const raw = input.slice(start, index)
      if (raw === 'true' || raw === 'false') {
        tokens.push({
          kind: 'boolean',
          value: raw,
          start,
          end: index,
        })
      } else {
        tokens.push({
          kind: 'identifier',
          value: raw,
          start,
          end: index,
        })
      }
      continue
    }

    const err = new Error(`Unexpected character \`${char}\`.`)
    ;(err as ParseError).position = index
    throw err
  }

  return tokens
}

function isWhitespace(char: string): boolean {
  return /\s/.test(char)
}

function isDigit(char: string): boolean {
  return char >= '0' && char <= '9'
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_]/.test(char)
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_.]/.test(char)
}

function findClosingQuote(input: string, start: number, quote: string): number {
  let index = start
  while (index < input.length) {
    const char = input[index]!
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === quote) {
      return index
    }
    index += 1
  }
  return -1
}

function unescapeString(value: string): string {
  return value.replace(/\\(['"\\bfnrt])/g, (_, group: string) => {
    switch (group) {
      case 'b':
        return '\b'
      case 'f':
        return '\f'
      case 'n':
        return '\n'
      case 'r':
        return '\r'
      case 't':
        return '\t'
      case "'":
        return "'"
      case '"':
        return '"'
      case '\\':
        return '\\'
      default:
        return group
    }
  })
}

function validateAst(
  ast: ConditionExpressionNode,
  catalog: ConditionVariableCatalog,
  index: LineIndex,
): ConditionDslError[] {
  const errors: ConditionDslError[] = []
  const lookup = buildCatalogLookup(catalog)
  validateNode(ast, lookup, index, errors, [])
  return errors
}

interface QuantifierScopeState {
  alias: string
  aliasRange: SourceRange | null
  predicateRange: SourceRange | null
  used: boolean
}

function validateNode(
  node: ConditionExpressionNode,
  lookup: Map<string, ConditionVariableDefinition>,
  index: LineIndex,
  errors: ConditionDslError[],
  scopes: QuantifierScopeState[],
): void {
  switch (node.type) {
    case 'literal':
      return
    case 'variable': {
      if (markAliasUsage(node.path, scopes)) {
        return
      }
      const variable = lookup.get(node.path)
      if (!variable) {
        errors.push(
          createDiagnostic(
            {
              code: 'unknown_variable',
              message: `Variable \`${node.path}\` is not registered.`,
            },
            index,
            node.range?.start ?? 0,
            node.range?.end ?? 0,
          ),
        )
      }
      return
    }
    case 'unary': {
      validateNode(node.argument, lookup, index, errors, scopes)
      return
    }
    case 'binary': {
      validateNode(node.left, lookup, index, errors, scopes)
      validateNode(node.right, lookup, index, errors, scopes)
      if (isComparisonOperator(node.operator)) {
        const operatorRange = node.operatorRange ?? node.range
        const variables = collectVariablesForNode(node)
        for (const variable of variables) {
          if (markAliasUsage(variable.path, scopes)) {
            continue
          }
          const definition = lookup.get(variable.path)
          if (!definition) continue
          if (!definition.allowedOperators.includes(node.operator)) {
            errors.push(
              createDiagnostic(
                {
                  code: 'operator_not_allowed',
                  message: `Operator \`${node.operator}\` is not allowed for variable \`${definition.path}\`.`,
                },
                index,
                operatorRange?.start ?? variable.range?.start ?? 0,
                operatorRange?.end ?? variable.range?.end ?? 0,
              ),
            )
          }
        }
        const typeErrors = validateComparisonOperandTypes(node, lookup, index)
        errors.push(...typeErrors)
      }
      return
    }
    case 'quantifier': {
      validateNode(node.collection, lookup, index, errors, scopes)
      if (node.collection.type !== 'variable') {
        errors.push(
          createDiagnostic(
            {
              code: 'invalid_quantifier',
              message: 'Quantifier collection must reference a variable.',
            },
            index,
            node.collection.range?.start ?? node.range?.start ?? 0,
            node.collection.range?.end ?? node.range?.end ?? 0,
          ),
        )
      } else {
        const definition = lookup.get(node.collection.path)
        if (definition && definition.type !== 'array') {
          errors.push(
            createDiagnostic(
              {
                code: 'invalid_quantifier',
                message: `Quantifier \`${node.operator}\` expects collection \`${definition.path}\` to be an array.`,
              },
              index,
              node.collection.range?.start ?? node.range?.start ?? 0,
              node.collection.range?.end ?? node.range?.end ?? 0,
            ),
          )
        }
      }
      const scopeEntry: QuantifierScopeState = {
        alias: node.alias,
        aliasRange: node.aliasRange,
        predicateRange: node.predicateRange ?? node.range,
        used: false,
      }
      validateNode(node.predicate, lookup, index, errors, [...scopes, scopeEntry])
      if (!scopeEntry.used) {
        errors.push(
          createDiagnostic(
            {
              code: 'invalid_quantifier',
              message: `Quantifier predicate must reference alias \`${node.alias}\`.`,
            },
            index,
            scopeEntry.predicateRange?.start ?? node.range?.start ?? 0,
            scopeEntry.predicateRange?.end ?? node.range?.end ?? 0,
          ),
        )
      }
      return
    }
    default:
      return
  }
}

function markAliasUsage(path: string, scopes: QuantifierScopeState[]): boolean {
  for (let i = scopes.length - 1; i >= 0; i -= 1) {
    const scope = scopes[i]!
    if (path === scope.alias || path.startsWith(`${scope.alias}.`)) {
      scope.used = true
      return true
    }
  }
  return false
}

function expressionToJsonLogic(node: ConditionExpressionNode): JsonLogicExpression {
  switch (node.type) {
    case 'literal':
      return node.value
    case 'variable':
      return { var: node.path }
    case 'unary':
      return { '!': expressionToJsonLogic(node.argument) }
    case 'binary': {
      const left = expressionToJsonLogic(node.left)
      const right = expressionToJsonLogic(node.right)
      if (node.operator === '&&') {
        return { and: flattenLogical('and', [left, right]) }
      }
      if (node.operator === '||') {
        return { or: flattenLogical('or', [left, right]) }
      }
      return { [node.operator]: [left, right] }
    }
    case 'quantifier': {
      const collection = expressionToJsonLogic(node.collection)
      const predicate = expressionToJsonLogic(node.predicate)
      const operands: JsonLogicExpression[] = [collection, predicate]
      if (node.aliasProvided || node.alias !== 'item') {
        operands.push(node.alias)
      }
      return { [node.operator]: operands }
    }
    default:
      return true
  }
}

function jsonLogicToExpression(
  value: JsonLogicExpression,
  lookup: Map<string, ConditionVariableDefinition>,
  aliasStack: readonly string[] = [],
): ConditionExpressionNode {
  if (Array.isArray(value)) {
    throw new Error('Unexpected array at root level in JSON-Logic expression.')
  }

  if (value === null || typeof value !== 'object') {
    return {
      type: 'literal',
      value,
      range: null,
    }
  }

  const entries = Object.entries(value)
  if (entries.length !== 1) {
    throw new Error('JSON-Logic object must have exactly one operator.')
  }
  const [operator, operand] = entries[0]!

  switch (operator) {
    case 'and':
    case 'or': {
      if (!Array.isArray(operand) || operand.length === 0) {
        throw new Error(`Operator \`${operator}\` expects a non-empty array.`)
      }
      const op: ConditionBinaryOperator = operator === 'and' ? '&&' : '||'
      return foldLogical(op, operand, lookup, aliasStack)
    }
    case '!': {
      return {
        type: 'unary',
        operator: '!',
        argument: jsonLogicToExpression(operand, lookup, aliasStack),
        range: null,
        operatorRange: null,
      }
    }
    case 'var': {
      if (typeof operand === 'string') {
        const path = normaliseVarFromJsonLogic(operand, lookup, aliasStack)
        return { type: 'variable', path, range: null }
      }
      if (Array.isArray(operand) && typeof operand[0] === 'string') {
        const path = normaliseVarFromJsonLogic(operand[0], lookup, aliasStack)
        return { type: 'variable', path, range: null }
      }
      throw new Error('`var` operator expects a string path.')
    }
    case '==':
    case '!=':
    case '>':
    case '>=':
    case '<':
    case '<=': {
      if (!Array.isArray(operand) || operand.length !== 2) {
        throw new Error(`Operator \`${operator}\` expects exactly two operands.`)
      }
      const [leftOperand, rightOperand] = operand
      return {
        type: 'binary',
        operator,
        left: jsonLogicToExpression(leftOperand, lookup, aliasStack),
        right: jsonLogicToExpression(rightOperand, lookup, aliasStack),
        range: null,
        operatorRange: null,
      }
    }
    case 'some':
    case 'all': {
      if (!Array.isArray(operand) || operand.length < 2 || operand.length > 3) {
        throw new Error(`Operator \`${operator}\` expects [collection, predicate, alias?] operands.`)
      }
      const [collectionOperand, predicateOperand, aliasOperand] = operand
      const alias =
        typeof aliasOperand === 'string' && aliasOperand.trim().length > 0
          ? aliasOperand
          : 'item'
      const aliasProvided =
        typeof aliasOperand === 'string' && aliasOperand.trim().length > 0 && alias !== 'item'
      const collection = jsonLogicToExpression(collectionOperand, lookup, aliasStack)
      const predicate = jsonLogicToExpression(predicateOperand, lookup, [...aliasStack, alias])
      return {
        type: 'quantifier',
        operator: operator as ConditionQuantifierOperator,
        collection,
        predicate,
        alias,
        aliasProvided,
        range: null,
        operatorRange: null,
        collectionRange: null,
        aliasRange: null,
        predicateRange: null,
      }
    }
    default:
      throw new Error(`Operator \`${operator}\` is not supported by the DSL renderer.`)
  }
}

function foldLogical(
  operator: ConditionBinaryOperator,
  operands: JsonLogicExpression[],
  lookup: Map<string, ConditionVariableDefinition>,
  aliasStack: readonly string[],
): ConditionExpressionNode {
  if (operands.length === 1) {
    return jsonLogicToExpression(operands[0]!, lookup, aliasStack)
  }
  let result = jsonLogicToExpression(operands[0]!, lookup, aliasStack)
  for (let i = 1; i < operands.length; i += 1) {
    const right = jsonLogicToExpression(operands[i]!, lookup, aliasStack)
    result = {
      type: 'binary',
      operator,
      left: result,
      right,
      range: null,
      operatorRange: null,
    }
  }
  return result
}

function normaliseVarFromJsonLogic(
  path: string,
  lookup: Map<string, ConditionVariableDefinition>,
  aliasStack: readonly string[],
): string {
  if (lookup.has(path)) {
    return path
  }
  for (let i = aliasStack.length - 1; i >= 0; i -= 1) {
    const alias = aliasStack[i]!
    if (path === alias || path.startsWith(`${alias}.`)) {
      return path
    }
  }
  if (aliasStack.length > 0) {
    const activeAlias = aliasStack[aliasStack.length - 1]!
    if (path === '') {
      return activeAlias
    }
    return `${activeAlias}.${path}`
  }
  return path
}

function flattenLogical(
  kind: 'and' | 'or',
  operands: JsonLogicExpression[],
): JsonLogicExpression[] {
  const flattened: JsonLogicExpression[] = []
  for (const operand of operands) {
    if (
      operand &&
      typeof operand === 'object' &&
      !Array.isArray(operand) &&
      kind in operand &&
      Array.isArray((operand as Record<string, JsonLogicExpression>)[kind])
    ) {
      flattened.push(...(operand as Record<string, JsonLogicExpression[]>)[kind])
    } else {
      flattened.push(operand)
    }
  }
  return flattened
}

function renderExpression(node: ConditionExpressionNode): string {
  return renderNode(node, 0)
}

function renderNode(node: ConditionExpressionNode, parentPrecedence: number): string {
  switch (node.type) {
    case 'literal':
      return formatLiteral(node.value)
    case 'variable':
      return node.path
    case 'unary': {
      const precedence = getPrecedence(node.operator)
      const argument = renderNode(node.argument, precedence)
      const argumentNeedsParens = needsParensForUnary(node.argument, precedence)
      const renderedArgument = argumentNeedsParens ? `(${argument})` : argument
      const expression = `!${renderedArgument}`
      return expression
    }
    case 'binary': {
      const precedence = getPrecedence(node.operator)
      const leftRendered = renderNode(node.left, precedence)
      const rightRendered = renderNode(node.right, precedence)
      const left =
        needsParensForChild(node.left, precedence, false, node.operator) ? `(${leftRendered})` : leftRendered
      const right =
        needsParensForChild(node.right, precedence, true, node.operator) ? `(${rightRendered})` : rightRendered
      const expression = `${left} ${node.operator} ${right}`
      return expression
    }
    case 'quantifier': {
      const collection = renderNode(node.collection, Number.POSITIVE_INFINITY)
      const predicate = renderNode(node.predicate, 0)
      const aliasSegment = node.aliasProvided ? ` as ${node.alias}` : ''
      return `${node.operator}(${collection}${aliasSegment}, ${predicate})`
    }
    default:
      return 'true'
  }
}

function needsParensForUnary(node: ConditionExpressionNode, parentPrecedence: number): boolean {
  return nodePrecedence(node) < parentPrecedence
}

function needsParensForChild(
  node: ConditionExpressionNode,
  parentPrecedence: number,
  isRightChild: boolean,
  parentOperator: ConditionBinaryOperator,
): boolean {
  const childPrecedence = nodePrecedence(node)
  if (childPrecedence === Number.POSITIVE_INFINITY) {
    return false
  }
  if (childPrecedence < parentPrecedence) {
    return true
  }
  if (childPrecedence > parentPrecedence) {
    return false
  }

  if (node.type === 'binary') {
    if (isAssociative(parentOperator) && node.operator === parentOperator) {
      return false
    }
    return true
  }

  return false
}

function nodePrecedence(node: ConditionExpressionNode): number {
  if (node.type === 'binary' || node.type === 'unary') {
    return getPrecedence(node.type === 'binary' ? node.operator : node.operator)
  }
  return Number.POSITIVE_INFINITY
}

function formatLiteral(value: number | string | boolean | null): string {
  if (typeof value === 'string') {
    return `"${escapeString(value)}"`
  }
  if (value === null) {
    return 'null'
  }
  return String(value)
}

function escapeString(value: string): string {
  return value.replace(/["\\\b\f\n\r\t]/g, (char) => {
    switch (char) {
      case '"':
        return '\\"'
      case '\\':
        return '\\\\'
      case '\b':
        return '\\b'
      case '\f':
        return '\\f'
      case '\n':
        return '\\n'
      case '\r':
        return '\\r'
      case '\t':
        return '\\t'
      default:
        return char
    }
  })
}

function getPrecedence(operator: ConditionBinaryOperator | ConditionUnaryOperator): number {
  switch (operator) {
    case '!':
      return 4
    case '==':
    case '!=':
      return 3
    case '>':
    case '>=':
    case '<':
    case '<=':
      return 3
    case '&&':
      return 2
    case '||':
      return 1
    default:
      return 0
  }
}

function isAssociative(operator: ConditionBinaryOperator): boolean {
  return operator === '&&' || operator === '||'
}

function isComparisonOperator(operator: ConditionBinaryOperator): operator is ConditionComparisonOperator {
  return operator !== '&&' && operator !== '||'
}

function collectVariableDefinitions(
  ast: ConditionExpressionNode,
  catalog: ConditionVariableCatalog,
): ConditionVariableDefinition[] {
  const lookup = buildCatalogLookup(catalog)
  const seen = new Map<string, ConditionVariableDefinition>()
  walk(ast, (node) => {
    if (node.type === 'variable') {
      const definition = lookup.get(node.path)
      if (definition && !seen.has(node.path)) {
        seen.set(node.path, definition)
      }
    }
  })
  return Array.from(seen.values())
}

function collectVariablesForNode(
  node: ConditionExpressionNode,
): Extract<ConditionExpressionNode, { type: 'variable' }>[] {
  const results: Extract<ConditionExpressionNode, { type: 'variable' }>[] = []
  walk(node, (n) => {
    if (n.type === 'variable') {
      results.push(n)
    }
  })
  return results
}

type LiteralKind = 'string' | 'number' | 'boolean' | 'null'

function validateComparisonOperandTypes(
  node: Extract<ConditionExpressionNode, { type: 'binary' }>,
  lookup: Map<string, ConditionVariableDefinition>,
  index: LineIndex,
): ConditionDslError[] {
  const errors: ConditionDslError[] = []
  const leftDefinitions = collectDefinitionsForExpression(node.left, lookup)
  const rightDefinitions = collectDefinitionsForExpression(node.right, lookup)
  const leftLiteral = getLiteralInfo(node.left)
  const rightLiteral = getLiteralInfo(node.right)

  if (rightLiteral) {
    for (const definition of leftDefinitions) {
      if (!isLiteralTypeCompatible(definition.type, rightLiteral.kind)) {
        errors.push(
          createDiagnostic(
            {
              code: 'type_mismatch',
              message: `Type mismatch: variable \`${definition.path}\` (${definition.type}) cannot be compared to ${rightLiteral.kind} literal.`,
            },
            index,
            rightLiteral.startOffset ?? node.range?.start ?? 0,
            rightLiteral.endOffset ?? node.range?.end ?? 0,
          ),
        )
      }
    }
  }

  if (leftLiteral) {
    for (const definition of rightDefinitions) {
      if (!isLiteralTypeCompatible(definition.type, leftLiteral.kind)) {
        errors.push(
          createDiagnostic(
            {
              code: 'type_mismatch',
              message: `Type mismatch: variable \`${definition.path}\` (${definition.type}) cannot be compared to ${leftLiteral.kind} literal.`,
            },
            index,
            leftLiteral.startOffset ?? node.range?.start ?? 0,
            leftLiteral.endOffset ?? node.range?.end ?? 0,
          ),
        )
      }
    }
  }

  if (leftDefinitions.length > 0 && rightDefinitions.length > 0) {
    const seenPairs = new Set<string>()
    for (const leftDef of leftDefinitions) {
      for (const rightDef of rightDefinitions) {
        if (!areVariableTypesCompatible(leftDef.type, rightDef.type)) {
          const key = `${leftDef.path}|${rightDef.path}|${node.operator}`
          if (seenPairs.has(key)) continue
          seenPairs.add(key)
          errors.push(
            createDiagnostic(
              {
                code: 'type_mismatch',
                message: `Type mismatch: variables \`${leftDef.path}\` (${leftDef.type}) and \`${rightDef.path}\` (${rightDef.type}) are incompatible with \`${node.operator}\`.`,
              },
              index,
              node.operatorRange?.start ?? node.range?.start ?? 0,
              node.operatorRange?.end ?? node.range?.end ?? 0,
            ),
          )
        }
      }
    }
  }

  return errors
}

function collectDefinitionsForExpression(
  node: ConditionExpressionNode,
  lookup: Map<string, ConditionVariableDefinition>,
): ConditionVariableDefinition[] {
  const definitions: ConditionVariableDefinition[] = []
  const seen = new Set<string>()
  walk(node, (current) => {
    if (current.type === 'variable') {
      const definition = lookup.get(current.path)
      if (definition && !seen.has(definition.path)) {
        seen.add(definition.path)
        definitions.push(definition)
      }
    }
  })
  return definitions
}

function getLiteralInfo(
  node: ConditionExpressionNode,
): { kind: LiteralKind; startOffset: number | null; endOffset: number | null } | null {
  if (node.type !== 'literal') return null
  const kind = literalKindFromValue(node.value)
  return {
    kind,
    startOffset: node.range?.start ?? null,
    endOffset: node.range?.end ?? null,
  }
}

function literalKindFromValue(value: number | string | boolean | null): LiteralKind {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    default:
      return 'string'
  }
}

function isLiteralTypeCompatible(
  variableType: ConditionVariableType,
  literalKind: LiteralKind,
): boolean {
  if (literalKind === 'null') {
    return true
  }

  switch (variableType) {
    case 'number':
      return literalKind === 'number'
    case 'boolean':
      return literalKind === 'boolean'
    case 'string':
      return literalKind === 'string'
    case 'array':
      return false
    default:
      return false
  }
}

function areVariableTypesCompatible(
  leftType: ConditionVariableType,
  rightType: ConditionVariableType,
): boolean {
  return leftType === rightType
}

function walk(node: ConditionExpressionNode, visit: (node: ConditionExpressionNode) => void): void {
  visit(node)
  if (node.type === 'binary') {
    walk(node.left, visit)
    walk(node.right, visit)
  } else if (node.type === 'unary') {
    walk(node.argument, visit)
  } else if (node.type === 'quantifier') {
    walk(node.collection, visit)
    walk(node.predicate, visit)
  }
}

function buildCatalogLookup(
  catalog: ConditionVariableCatalog,
): Map<string, ConditionVariableDefinition> {
  const map = new Map<string, ConditionVariableDefinition>()
  for (const variable of catalog.variables) {
    map.set(variable.path, variable)
  }
  return map
}

interface EvaluationScope {
  value: unknown
  alias?: string
  parent?: EvaluationScope
}

function evaluate(
  expr: JsonLogicExpression,
  payload: unknown,
  resolved: Record<string, unknown>,
  scope?: EvaluationScope,
): unknown {
  if (Array.isArray(expr)) {
    return expr.map((item) => evaluate(item, payload, resolved, scope))
  }

  if (expr === null || typeof expr !== 'object') {
    return expr
  }

  const entries = Object.entries(expr)
  if (entries.length !== 1) {
    throw new Error('Invalid JSON-Logic expression.')
  }

  const [operator, operand] = entries[0]!

  switch (operator) {
    case 'and': {
      const list = Array.isArray(operand) ? operand : [operand]
      for (const item of list) {
        const value = evaluate(item, payload, resolved, scope)
        if (!truthy(value)) return false
      }
      return true
    }
    case 'or': {
      const list = Array.isArray(operand) ? operand : [operand]
      for (const item of list) {
        const value = evaluate(item, payload, resolved, scope)
        if (truthy(value)) return true
      }
      return false
    }
    case '!': {
      const value = evaluate(operand, payload, resolved, scope)
      return !truthy(value)
    }
    case 'var': {
      if (typeof operand === 'string') {
        const scoped = resolveScopedValue(operand, scope)
        if (scoped.found) {
          return scoped.value
        }
        const value = readPath(payload, operand)
        resolved[operand] = value
        return value
      }
      if (Array.isArray(operand) && operand.length > 0) {
        const path = operand[0]
        if (typeof path !== 'string') {
          throw new Error('Invalid `var` operand; expected string path.')
        }
        const scoped = resolveScopedValue(path, scope)
        if (scoped.found) {
          return scoped.value
        }
        const value = readPath(payload, path)
        resolved[path] = value
        return value
      }
      throw new Error('Invalid `var` operand.')
    }
    case '==':
    case '!=':
    case '>':
    case '>=':
    case '<':
    case '<=': {
      if (!Array.isArray(operand) || operand.length !== 2) {
        throw new Error(`Operator \`${operator}\` expects two operands.`)
      }
      const [leftOperand, rightOperand] = operand
      const left = evaluate(leftOperand, payload, resolved, scope)
      const right = evaluate(rightOperand, payload, resolved, scope)
      switch (operator) {
        case '==':
          return left === right
        case '!=':
          return left !== right
        case '>':
          return Number(left) > Number(right)
        case '>=':
          return Number(left) >= Number(right)
        case '<':
          return Number(left) < Number(right)
        case '<=':
          return Number(left) <= Number(right)
        default:
          return false
      }
    }
    case 'some':
    case 'all': {
      if (!Array.isArray(operand) || operand.length < 2 || operand.length > 3) {
        throw new Error(`Operator \`${operator}\` expects [source, predicate, alias?] operands.`)
      }
      const [sourceExpr, predicateExpr, aliasOperand] = operand
      if (predicateExpr === undefined) {
        throw new Error(`Operator \`${operator}\` requires a predicate expression.`)
      }
      const alias =
        typeof aliasOperand === 'string' && aliasOperand.trim().length > 0
          ? aliasOperand
          : 'item'
      const sourcePath = extractVarPath(sourceExpr)
      const sourceValue = evaluate(sourceExpr, payload, resolved, scope)
      const array = toArrayOperand(sourceValue, operator, sourcePath)
      if (array.length === 0) {
        return false
      }
      if (operator === 'some') {
        for (const item of array) {
          const predicate = evaluate(
            predicateExpr,
            payload,
            resolved,
            createScope(item, scope, alias),
          )
          if (truthy(predicate)) {
            return true
          }
        }
        return false
      }
      for (const item of array) {
        const predicate = evaluate(
          predicateExpr,
          payload,
          resolved,
          createScope(item, scope, alias),
        )
        if (!truthy(predicate)) {
          return false
        }
      }
      return true
    }
    default:
      throw new Error(`Unsupported operator \`${operator}\` in evaluator.`)
  }
}

function truthy(value: unknown): boolean {
  return Boolean(value)
}

function createScope(value: unknown, parent?: EvaluationScope, alias?: string): EvaluationScope {
  return { value, parent, alias }
}

function resolveScopedValue(path: string, scope?: EvaluationScope): { found: boolean; value: unknown } {
  if (!scope) {
    return { found: false, value: undefined }
  }
  let current: EvaluationScope | undefined = scope
  while (current) {
    if (current.alias) {
      if (path === current.alias) {
        return { found: true, value: current.value }
      }
      if (path.startsWith(`${current.alias}.`)) {
        const trimmed = path.slice(current.alias.length + 1)
        const scopedResult = readPathWithExistence(current.value, trimmed)
        if (scopedResult.exists) {
          return scopedResult
        }
      }
    }
    const result = readPathWithExistence(current.value, path)
    if (result.exists) {
      return { found: true, value: result.value }
    }
    current = current.parent
  }
  return { found: false, value: undefined }
}

function readPathWithExistence(source: unknown, path: string): { exists: boolean; value: unknown } {
  if (path === '') {
    return { exists: true, value: source }
  }
  if (source === null || typeof source !== 'object') {
    return { exists: false, value: undefined }
  }
  const segments = path.split('.')
  let current: any = source
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') {
      return { exists: false, value: undefined }
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      return { exists: false, value: undefined }
    }
    current = current[segment]
  }
  return { exists: true, value: current }
}

function readPath(payload: unknown, path: string): unknown {
  if (payload === null || typeof payload !== 'object') {
    return undefined
  }
  const segments = path.split('.')
  let current: any = payload
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') {
      return undefined
    }
    current = current[segment]
  }
  return current
}

function extractVarPath(expr: JsonLogicExpression): string | null {
  if (expr === null || typeof expr !== 'object' || Array.isArray(expr)) {
    return null
  }
  const entries = Object.entries(expr)
  if (entries.length !== 1) {
    return null
  }
  const [operator, operand] = entries[0]!
  if (operator !== 'var') {
    return null
  }
  if (typeof operand === 'string') {
    return operand
  }
  if (Array.isArray(operand) && operand.length > 0) {
    const path = operand[0]
    return typeof path === 'string' ? path : null
  }
  return null
}

function describeValue(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

function toArrayOperand(
  value: unknown,
  operator: 'some' | 'all',
  sourcePath: string | null,
): unknown[] {
  if (value === undefined || value === null) {
    return []
  }
  if (!Array.isArray(value)) {
    const reference = sourcePath ? `path "${sourcePath}"` : 'first operand'
    throw new Error(
      `Operator \`${operator}\` expected ${reference} to resolve to an array, received ${describeValue(value)}.`,
    )
  }
  return value
}

export function defaultAllowedOperatorsForType(
  type: ConditionVariableType,
): readonly ConditionComparisonOperator[] {
  switch (type) {
    case 'number':
      return ['==', '!=', '<', '<=', '>', '>='] as const
    case 'boolean':
      return ['==', '!='] as const
    case 'string':
      return ['==', '!='] as const
    case 'array':
      return ['==', '!='] as const
    default:
      return ['==', '!='] as const
  }
}
