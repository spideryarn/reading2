/**
 * **Strict JSON on the Anthropic Messages wire, with the request-time failures
 * caught before the request.**
 *
 * Anthropic compiles `output_config.format` into a grammar. Its supported JSON
 * Schema subset is deliberately smaller than JSON Schema itself, so an ordinary
 * schema validator can call a schema valid while the API returns 400. Every
 * format this module builds passes through `validateAnthropicJsonSchema`; the
 * adapter then adds it without replacing an effort the caller already chose.
 *
 * This guarantees syntax and shape only. **It does not make a block id right.**
 * Every id still has to be resolved against the article, and a wrong-but-real id
 * remains possible. A field carrying a block id must never use `enum`: after a
 * mistyped prefix, constrained decoding could otherwise force the answer to some
 * other real id. Schema authors assert that semantic rule explicitly with
 * `assertNoBlockIdEnums`, because a generic schema cannot know which strings are
 * ids.
 *
 * The validator is pure and non-mutating. It returns the same schema object so a
 * caller can validate at its construction seam without copying a possibly large
 * schema or changing the bytes used for cache identity.
 */
import type { MessagesBody } from "./messages-stream.js";

export type AnthropicJsonSchema = Readonly<Record<string, unknown>>;

/** Anthropic's documented combined ceiling for optional schema properties. */
export const MAX_OPTIONAL_PARAMETERS = 24;
/** Anthropic's documented combined ceiling for properties with union types. */
export const MAX_UNION_PARAMETERS = 16;

/* Anthropic calls large `{n,m}` ranges unsupported without publishing a numeric
   boundary. Keep our accepted subset deliberately small and stated: block ids
   and every planned pipeline schema need single-digit bounds at most. */
const MAX_REGEX_QUANTIFIER = 100;

const BASIC_TYPES = new Set(["object", "array", "string", "integer", "number", "boolean", "null"]);
const STRING_FORMATS = new Set([
  "date-time",
  "time",
  "date",
  "duration",
  "email",
  "hostname",
  "uri",
  "ipv4",
  "ipv6",
  "uuid",
]);
const SUPPORTED_KEYWORDS = new Set([
  "$schema",
  "$ref",
  "$defs",
  "definitions",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minItems",
  "enum",
  "const",
  "anyOf",
  "allOf",
  "default",
  "description",
  "title",
  "format",
  "pattern",
]);

function recordAt(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Structured-output schema at ${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function schemaList(value: unknown, keyword: string, path: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Structured-output schema ${path}.${keyword} must be a non-empty array.`);
  }
  return value;
}

function schemaMap(value: unknown, keyword: string, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Structured-output schema ${path}.${keyword} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function validatePattern(pattern: unknown, path: string): void {
  if (typeof pattern !== "string") {
    throw new Error(`Structured-output schema ${path}.pattern must be a string.`);
  }
  try {
    new RegExp(pattern);
  } catch {
    throw new Error(`Structured-output schema ${path}.pattern is not a valid regular expression.`);
  }
  if (/\(\?(?:[=!]|<[=!])/.test(pattern)) {
    throw new Error(`Structured-output schema ${path}.pattern uses unsupported lookaround.`);
  }
  if (/\\[1-9]/.test(pattern)) {
    throw new Error(`Structured-output schema ${path}.pattern uses an unsupported backreference.`);
  }
  if (/\\[bB]/.test(pattern)) {
    throw new Error(`Structured-output schema ${path}.pattern uses an unsupported word boundary.`);
  }
  for (const match of pattern.matchAll(/\{(\d+)(?:,(\d*))?\}/g)) {
    const low = Number(match[1]);
    const high = match[2] === undefined || match[2] === "" ? low : Number(match[2]);
    if (low > MAX_REGEX_QUANTIFIER || high > MAX_REGEX_QUANTIFIER || high - low > MAX_REGEX_QUANTIFIER) {
      throw new Error(
        `Structured-output schema ${path}.pattern uses a quantifier above the supported ceiling ` +
          `of ${MAX_REGEX_QUANTIFIER}.`,
      );
    }
  }
}

function resolveLocalRef(root: Record<string, unknown>, ref: string, path: string): Record<string, unknown> {
  if (ref === "#") return root;
  if (!ref.startsWith("#/")) {
    throw new Error(`Structured-output schema ${path} has an external $ref; only local refs are supported.`);
  }
  let value: unknown = root;
  for (const raw of ref.slice(2).split("/")) {
    const part = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (typeof value !== "object" || value === null || Array.isArray(value) || !(part in value)) {
      throw new Error(`Structured-output schema ${path} has a local $ref that does not resolve: ${ref}.`);
    }
    value = (value as Record<string, unknown>)[part];
  }
  return recordAt(value, `${path} -> ${ref}`);
}

function containsRef(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((entry) => containsRef(entry, seen));
  const record = value as Record<string, unknown>;
  if ("$ref" in record) return true;
  return Object.values(record).some((entry) => containsRef(entry, seen));
}

function validateTypeKeyword(
  node: Record<string, unknown>,
  path: string,
): { isObject: boolean } {
  const type = node.type;
  if (type !== undefined) {
    const types = Array.isArray(type) ? type : [type];
    if (types.length === 0 || types.some((entry) => typeof entry !== "string" || !BASIC_TYPES.has(entry))) {
      throw new Error(`Structured-output schema ${path}.type names an unsupported JSON type.`);
    }
    if (new Set(types).size !== types.length) {
      throw new Error(`Structured-output schema ${path}.type repeats a JSON type.`);
    }
  }

  return {
    isObject:
      type === "object" ||
      (Array.isArray(type) && type.includes("object")) ||
      node.properties !== undefined,
  };
}

function validateScalarKeywords(node: Record<string, unknown>, path: string): void {
  if (node.enum !== undefined) {
    if (!Array.isArray(node.enum) || node.enum.length === 0) {
      throw new Error(`Structured-output schema ${path}.enum must be a non-empty array.`);
    }
    if (node.enum.some((entry) => entry !== null && !["string", "number", "boolean"].includes(typeof entry))) {
      throw new Error(`Structured-output schema ${path}.enum may contain only scalar JSON values.`);
    }
  }
  if (node.const !== undefined && typeof node.const === "object" && node.const !== null) {
    throw new Error(`Structured-output schema ${path}.const may contain only a scalar JSON value.`);
  }
  if (node.pattern !== undefined) validatePattern(node.pattern, path);
  if (node.format !== undefined && (typeof node.format !== "string" || !STRING_FORMATS.has(node.format))) {
    throw new Error(`Structured-output schema ${path}.format is not supported.`);
  }
  if (node.minItems !== undefined && node.minItems !== 0 && node.minItems !== 1) {
    throw new Error(`Structured-output schema ${path}.minItems must be 0 or 1.`);
  }
}

function validateBasicKeywords(
  node: Record<string, unknown>,
  path: string,
): { isObject: boolean } {
  for (const keyword of Object.keys(node)) {
    if (!SUPPORTED_KEYWORDS.has(keyword)) {
      throw new Error(`Structured-output schema ${path} uses unsupported keyword ${keyword}.`);
    }
  }
  const type = validateTypeKeyword(node, path);
  validateScalarKeywords(node, path);
  return type;
}

function parameterUsesUnion(
  raw: unknown,
  root: Record<string, unknown>,
  seen = new WeakSet<object>(),
): boolean {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
  if (seen.has(raw)) return false;
  seen.add(raw);
  const node = raw as Record<string, unknown>;
  if (Array.isArray(node.type) || node.anyOf !== undefined) return true;
  return typeof node.$ref === "string"
    ? parameterUsesUnion(resolveLocalRef(root, node.$ref, "$"), root, seen)
    : false;
}

function objectProperties(
  node: Record<string, unknown>,
  path: string,
  isObject: boolean,
): { properties: Record<string, unknown>; required: Set<string> } | null {
  if (!isObject) {
    if (node.properties !== undefined || node.required !== undefined || node.additionalProperties !== undefined) {
      throw new Error(`Structured-output schema ${path} uses object keywords without type: object.`);
    }
    return null;
  }
  if (node.additionalProperties !== false) {
    throw new Error(`Every object in a structured-output schema needs additionalProperties: false (${path}).`);
  }
  const properties = node.properties === undefined ? {} : schemaMap(node.properties, "properties", path);
  const requiredRaw = node.required ?? [];
  if (!Array.isArray(requiredRaw) || requiredRaw.some((entry) => typeof entry !== "string")) {
    throw new Error(`Structured-output schema ${path}.required must be an array of property names.`);
  }
  const required = new Set(requiredRaw as string[]);
  for (const name of required) {
    if (!(name in properties)) {
      throw new Error(`Structured-output schema ${path}.required names missing property ${name}.`);
    }
  }
  return { properties, required };
}

/**
 * Refuse schemas the Messages API cannot compile, returning the original schema
 * unchanged when it belongs to Anthropic's supported subset.
 */
export function validateAnthropicJsonSchema<T extends AnthropicJsonSchema>(schema: T): T {
  const root = recordAt(schema, "$");
  const active = new WeakSet<object>();
  const validated = new WeakSet<object>();
  const counts = { optionalParameters: 0, unionParameters: 0 };

  let visit: (raw: unknown, path: string) => void;

  const visitObject = (
    node: Record<string, unknown>,
    path: string,
    isObject: boolean,
  ): void => {
    const object = objectProperties(node, path, isObject);
    if (object === null) return;
    const { properties, required } = object;
    counts.optionalParameters += Object.keys(properties).filter((name) => !required.has(name)).length;
    for (const [name, property] of Object.entries(properties)) {
      if (parameterUsesUnion(property, root)) counts.unionParameters += 1;
      visit(property, `${path}.properties.${name}`);
    }
  };

  const visitDefinitions = (node: Record<string, unknown>, path: string): void => {
    for (const keyword of ["$defs", "definitions"] as const) {
      if (node[keyword] === undefined) continue;
      for (const [name, child] of Object.entries(schemaMap(node[keyword], keyword, path))) {
        visit(child, `${path}.${keyword}.${name}`);
      }
    }
  };

  const visitCompositions = (
    node: Record<string, unknown>,
    path: string,
  ): void => {
    for (const keyword of ["anyOf", "allOf"] as const) {
      if (node[keyword] === undefined) continue;
      const members = schemaList(node[keyword], keyword, path);
      if (keyword === "allOf" && containsRef(members)) {
        throw new Error(`Structured-output schema ${path}.allOf cannot be combined with $ref.`);
      }
      for (const [i, member] of members.entries()) {
        visit(member, `${path}.${keyword}[${i}]`);
      }
    }
  };

  visit = (raw: unknown, path: string): void => {
    const node = recordAt(raw, path);
    if (active.has(node)) {
      throw new Error(`Structured-output schema has a cyclic $ref at ${path}; recursive schemas are unsupported.`);
    }
    if (validated.has(node)) return;
    active.add(node);
    const basic = validateBasicKeywords(node, path);

    if (node.$ref !== undefined) {
      if (typeof node.$ref !== "string") {
        throw new Error(`Structured-output schema ${path} has a non-string $ref.`);
      }
      visit(resolveLocalRef(root, node.$ref, path), `${path} -> ${node.$ref}`);
    }
    visitObject(node, path, basic.isObject);
    if (node.items !== undefined) visit(node.items, `${path}.items`);
    visitDefinitions(node, path);
    visitCompositions(node, path);

    active.delete(node);
    validated.add(node);
  };

  visit(root, "$");
  if (counts.optionalParameters > MAX_OPTIONAL_PARAMETERS) {
    throw new Error(
      `Structured-output schema has ${counts.optionalParameters} optional parameters; Anthropic supports at most ` +
        `${MAX_OPTIONAL_PARAMETERS} optional parameters.`,
    );
  }
  if (counts.unionParameters > MAX_UNION_PARAMETERS) {
    throw new Error(
      `Structured-output schema has ${counts.unionParameters} union parameters; Anthropic supports at most ` +
        `${MAX_UNION_PARAMETERS} union parameters.`,
    );
  }
  return schema;
}

function schemaContainsEnum(
  raw: unknown,
  root: Record<string, unknown>,
  seen: WeakSet<object>,
): boolean {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return false;
  if (seen.has(raw)) return false;
  seen.add(raw);
  const node = raw as Record<string, unknown>;
  if (node.enum !== undefined) return true;
  if (typeof node.$ref === "string" && schemaContainsEnum(resolveLocalRef(root, node.$ref, "$"), root, seen)) {
    return true;
  }
  return [node.anyOf, node.allOf].some(
    (members) => Array.isArray(members) && members.some((member) => schemaContainsEnum(member, root, seen)),
  );
}

/**
 * Assert the semantic rule the generic validator cannot infer: properties with
 * one of these names carry block ids and therefore may not constrain them with
 * `enum`, directly or through a ref/union.
 */
export function assertNoBlockIdEnums(
  schema: AnthropicJsonSchema,
  blockIdPropertyNames: readonly string[],
): void {
  const root = recordAt(schema, "$");
  const names = new Set(blockIdPropertyNames);
  const visited = new WeakSet<object>();
  const walk = (raw: unknown, path: string): void => {
    if (typeof raw !== "object" || raw === null) return;
    if (visited.has(raw)) return;
    visited.add(raw);
    if (Array.isArray(raw)) {
      for (const [i, entry] of raw.entries()) walk(entry, `${path}[${i}]`);
      return;
    }
    const node = raw as Record<string, unknown>;
    const properties = node.properties;
    if (typeof properties === "object" && properties !== null && !Array.isArray(properties)) {
      for (const [name, property] of Object.entries(properties)) {
        if (names.has(name) && schemaContainsEnum(property, root, new WeakSet())) {
          throw new Error(`Block id field ${path}.properties.${name} may not use enum.`);
        }
      }
    }
    for (const [name, child] of Object.entries(node)) walk(child, `${path}.${name}`);
  };
  walk(root, "$");
}

/** Add a validated JSON schema to a Messages body without replacing its effort. */
export function withMessagesJsonSchema(
  body: MessagesBody,
  schema: AnthropicJsonSchema,
): MessagesBody {
  validateAnthropicJsonSchema(schema);
  return {
    ...body,
    output_config: {
      ...body.output_config,
      format: { type: "json_schema", schema },
    },
  };
}
