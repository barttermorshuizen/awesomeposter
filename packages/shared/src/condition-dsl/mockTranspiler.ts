export type MockConditionVariableType = 'string' | 'number' | 'boolean' | 'array' | 'object'

export interface MockConditionVariable {
  id: string
  path: string
  type: MockConditionVariableType
}

export interface MockConditionCatalog {
  variables: readonly MockConditionVariable[]
}

export type JsonLogicExpression =
  | null
  | boolean
  | number
  | string
  | JsonLogicExpression[]
  | { [key: string]: JsonLogicExpression }

interface ParseContext {
  tokens: Token[]
  index: number
  input: string
}

interface Token {
  kind: TokenKind
  value: string
  start: number
  end: number
}

type TokenKind = 'identifier' | 'number' | 'string' | 'boolean' | 'operator' | 'not' | 'paren'

type ExpressionNode =
  | { type: 'literal'; value: number | string | boolean | null }
  | { type: 'variable'; path: string }
  | { type: 'binary'; operator: BinaryOperator; left: ExpressionNode; right: ExpressionNode }
  | { type: 'unary'; operator: '!'; argument: ExpressionNode }

type BinaryOperator = '&&' | '||' | '==' | '!=' | '>=' | '<=' | '>' | '<'

export interface TranspileSuccess {
  ok: true
  jsonLogic: JsonLogicExpression
  ast: ExpressionNode
  warnings: string[]
  variables: string[]
}

export interface TranspileFailure {
  ok: false
  error: {
    message: string
    position?: number
  }
}

export type TranspileMockConditionResult = TranspileSuccess | TranspileFailure

export function transpileMockConditionDsl(
  expression: string,
  catalog: MockConditionCatalog,
): TranspileMockConditionResult {
  const trimmed = expression.trim()
  if (!trimmed) {
    return {
      ok: true,
      ast: { type: 'literal', value: true },
      jsonLogic: true,
      warnings: ['Expression is empty; defaulting to `true`.'],
      variables: [],
    }
  }

  let tokens: Token[]
  try {
    tokens = tokenize(expression)
  } catch (error) {
    return {
      ok: false,
      error: normaliseError(error),
    }
  }

  const ctx: ParseContext = {
    tokens,
    index: 0,
    input: expression,
  }

  let ast: ExpressionNode
  try {
    ast = parseExpression(ctx)
    ensureEnd(ctx)
  } catch (error) {
    return {
      ok: false,
      error: normaliseError(error),
    }
  }

  const jsonLogic = expressionToJsonLogic(ast)
  const variablePaths = collectVariables(ast)
  const allowed = new Set(
    catalog.variables.map((variable) => variable.path || variable.id),
  )
  const warnings: string[] = []
  const unknown = variablePaths.filter((path) => !allowed.has(path))
  if (unknown.length > 0) {
    warnings.push(
      `Unknown variables referenced: ${unknown
        .map((name) => `\`${name}\``)
        .join(', ')}.`,
    )
  }

  return {
    ok: true,
    ast,
    jsonLogic,
    warnings,
    variables: variablePaths,
  }
}

export interface EvaluateMockConditionSuccess {
  ok: true
  result: boolean
  resolvedVariables: Record<string, unknown>
}

export interface EvaluateMockConditionFailure {
  ok: false
  error: string
}

export type EvaluateMockConditionResult =
  | EvaluateMockConditionSuccess
  | EvaluateMockConditionFailure

export function evaluateMockCondition(
  jsonLogic: JsonLogicExpression,
  payload: unknown,
): EvaluateMockConditionResult {
  try {
    const resolved: Record<string, unknown> = {}
    const result = Boolean(evaluate(jsonLogic, payload, resolved))
    return { ok: true, result, resolvedVariables: resolved }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function evaluate(
  expr: JsonLogicExpression,
  payload: unknown,
  resolved: Record<string, unknown>,
): unknown {
  if (Array.isArray(expr)) {
    return expr.map((item) => evaluate(item, payload, resolved))
  }

  if (expr === null || typeof expr !== 'object') {
    return expr
  }

  const entries = Object.entries(expr)
  if (entries.length !== 1) {
    throw new Error('Invalid JSON-Logic expression.')
  }

  const [operator, operand] = entries[0]

  switch (operator) {
    case 'and': {
      const list = Array.isArray(operand) ? operand : [operand]
      for (const item of list) {
        const value = evaluate(item, payload, resolved)
        if (!truthy(value)) return false
      }
      return true
    }
    case 'or': {
      const list = Array.isArray(operand) ? operand : [operand]
      for (const item of list) {
        const value = evaluate(item, payload, resolved)
        if (truthy(value)) return true
      }
      return false
    }
    case '!': {
      const value = evaluate(operand, payload, resolved)
      return !truthy(value)
    }
    case 'var': {
      if (typeof operand === 'string') {
        const value = readPath(payload, operand)
        resolved[operand] = value
        return value
      }
      if (Array.isArray(operand) && operand.length > 0) {
        const path = operand[0]
        if (typeof path !== 'string') {
          throw new Error('Invalid `var` operand; expected string path.')
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
      const left = evaluate(leftOperand, payload, resolved)
      const right = evaluate(rightOperand, payload, resolved)
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
    default:
      throw new Error(`Unsupported operator \`${operator}\` in mock evaluator.`)
  }
}

function truthy(value: unknown): boolean {
  return !!value
}

function readPath(target: unknown, path: string): unknown {
  if (!path) return undefined
  const segments = path.split('.')
  let current: unknown = target
  for (const segment of segments) {
    if (current == null) return undefined
    if (typeof current !== 'object') return undefined
    const candidate = current as Record<string, unknown>
    if (Object.prototype.hasOwnProperty.call(candidate, segment)) {
      current = candidate[segment]
    } else {
      return undefined
    }
  }
  return current
}

function collectVariables(node: ExpressionNode): string[] {
  const results: string[] = []
  walk(node, (n) => {
    if (n.type === 'variable' && !results.includes(n.path)) {
      results.push(n.path)
    }
  })
  return results
}

function walk(node: ExpressionNode, visit: (node: ExpressionNode) => void): void {
  visit(node)
  if (node.type === 'binary') {
    walk(node.left, visit)
    walk(node.right, visit)
  } else if (node.type === 'unary') {
    walk(node.argument, visit)
  }
}

function expressionToJsonLogic(node: ExpressionNode): JsonLogicExpression {
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
      const operator =
        node.operator === '==' || node.operator === '!='
          ? node.operator
          : jsonLogicOperator(node.operator)
      return { [operator]: [left, right] }
    }
    default:
      return null
  }
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
      flattened.push(
        ...(operand as Record<string, JsonLogicExpression[]>)[kind],
      )
    } else {
      flattened.push(operand)
    }
  }
  return flattened
}

function jsonLogicOperator(operator: BinaryOperator): string {
  switch (operator) {
    case '>=':
    case '<=':
    case '>':
    case '<':
      return operator
    default:
      return operator
  }
}

function parseExpression(ctx: ParseContext): ExpressionNode {
  return parseOr(ctx)
}

function parseOr(ctx: ParseContext): ExpressionNode {
  let node = parseAnd(ctx)
  while (matchOperator(ctx, '||')) {
    const right = parseAnd(ctx)
    node = { type: 'binary', operator: '||', left: node, right }
  }
  return node
}

function parseAnd(ctx: ParseContext): ExpressionNode {
  let node = parseEquality(ctx)
  while (matchOperator(ctx, '&&')) {
    const right = parseEquality(ctx)
    node = { type: 'binary', operator: '&&', left: node, right }
  }
  return node
}

function parseEquality(ctx: ParseContext): ExpressionNode {
  let node = parseComparison(ctx)
  while (true) {
    if (matchOperator(ctx, '==')) {
      const right = parseComparison(ctx)
      node = { type: 'binary', operator: '==', left: node, right }
      continue
    }
    if (matchOperator(ctx, '!=')) {
      const right = parseComparison(ctx)
      node = { type: 'binary', operator: '!=', left: node, right }
      continue
    }
    break
  }
  return node
}

function parseComparison(ctx: ParseContext): ExpressionNode {
  let node = parseUnary(ctx)
  while (true) {
    if (matchOperator(ctx, '>=')) {
      const right = parseUnary(ctx)
      node = { type: 'binary', operator: '>=', left: node, right }
      continue
    }
    if (matchOperator(ctx, '<=')) {
      const right = parseUnary(ctx)
      node = { type: 'binary', operator: '<=', left: node, right }
      continue
    }
    if (matchOperator(ctx, '>')) {
      const right = parseUnary(ctx)
      node = { type: 'binary', operator: '>', left: node, right }
      continue
    }
    if (matchOperator(ctx, '<')) {
      const right = parseUnary(ctx)
      node = { type: 'binary', operator: '<', left: node, right }
      continue
    }
    break
  }
  return node
}

function parseUnary(ctx: ParseContext): ExpressionNode {
  if (matchKind(ctx, 'not')) {
    const argument = parseUnary(ctx)
    return { type: 'unary', operator: '!', argument }
  }
  return parsePrimary(ctx)
}

function parsePrimary(ctx: ParseContext): ExpressionNode {
  const token = peek(ctx)
  if (!token) {
    throw createParseError('Unexpected end of expression.', ctx)
  }

  switch (token.kind) {
    case 'number':
      consume(ctx)
      return {
        type: 'literal',
        value: Number(token.value),
      }
    case 'string':
      consume(ctx)
      return {
        type: 'literal',
        value: token.value,
      }
    case 'boolean':
      consume(ctx)
      return {
        type: 'literal',
        value: token.value === 'true',
      }
    case 'identifier':
      consume(ctx)
      if (token.value === 'null') {
        return {
          type: 'literal',
          value: null,
        }
      }
      return {
        type: 'variable',
        path: token.value,
      }
    case 'paren':
      if (token.value === '(') {
        consume(ctx)
        const expr = parseExpression(ctx)
        const closing = consume(ctx)
        if (!closing || closing.kind !== 'paren' || closing.value !== ')') {
          throw createParseError('Unclosed parenthesis.', ctx, token.start)
        }
        return expr
      }
      break
  }

  throw createParseError(`Unexpected token \`${token.value}\`.`, ctx, token.start)
}

function ensureEnd(ctx: ParseContext): void {
  if (ctx.index < ctx.tokens.length) {
    const token = ctx.tokens[ctx.index]
    throw createParseError(`Unexpected token \`${token.value}\`.`, ctx, token.start)
  }
}

function matchOperator(ctx: ParseContext, operator: BinaryOperator): boolean {
  const token = peek(ctx)
  if (token && token.kind === 'operator' && token.value === operator) {
    consume(ctx)
    return true
  }
  return false
}

function matchKind(ctx: ParseContext, kind: TokenKind): boolean {
  const token = peek(ctx)
  if (token && token.kind === kind) {
    consume(ctx)
    return true
  }
  return false
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

function createParseError(
  message: string,
  ctx: ParseContext,
  position?: number,
): Error {
  const err = new Error(message)
  ;(err as ParseError).position =
    position !== undefined
      ? position
      : ctx.tokens[ctx.index - 1]?.start ?? ctx.tokens[ctx.index]?.start
  return err
}

interface ParseError extends Error {
  position?: number
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  const length = input.length

  while (index < length) {
    const char = input[index]
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

    if (isDigit(char) || (char === '.' && isDigit(input[index + 1]))) {
      const start = index
      index += 1
      while (index < length && (isDigit(input[index]) || input[index] === '.')) {
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
      while (index < length && isIdentifierPart(input[index])) {
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
    const char = input[index]
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

function normaliseError(error: unknown): { message: string; position?: number } {
  if (error && typeof error === 'object' && 'message' in error) {
    const err = error as ParseError
    return { message: err.message, position: err.position }
  }
  return { message: String(error) }
}
