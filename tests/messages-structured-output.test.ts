import { describe, expect, it } from "vitest";
import { messagesWireBody } from "../src/messages-stream.js";
import {
  assertNoBlockIdEnums,
  MAX_OPTIONAL_PARAMETERS,
  MAX_UNION_PARAMETERS,
  validateAnthropicJsonSchema,
  withChatJsonSchema,
  withMessagesJsonSchema,
} from "../src/messages-structured-output.js";

const stringSchema = { type: "string" } as const;
const objectSchema = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

describe("Anthropic structured-output schema validation", () => {
  it("allows acyclic local refs through both definitions spellings", () => {
    const schema = {
      ...objectSchema({ modern: { $ref: "#/$defs/name" }, old: { $ref: "#/definitions/name" } }),
      $defs: { name: stringSchema },
      definitions: { name: stringSchema },
    };
    expect(validateAnthropicJsonSchema(schema)).toBe(schema);
  });

  it.each([
    ["direct", { ...objectSchema({ child: { $ref: "#" } }) }],
    [
      "indirect",
      {
        ...objectSchema({ child: { $ref: "#/$defs/a" } }),
        $defs: {
          a: objectSchema({ child: { $ref: "#/$defs/b" } }),
          b: objectSchema({ child: { $ref: "#/$defs/a" } }),
        },
      },
    ],
  ])("refuses a %s ref cycle", (_name, schema) => {
    expect(() => validateAnthropicJsonSchema(schema)).toThrow(/cyclic.*\$ref/i);
  });

  it.each(["https://example.com/schema.json", "other.json#/thing", "#missing", "#/missing"])(
    "refuses an external or unresolved ref: %s",
    ($ref) => {
      expect(() => validateAnthropicJsonSchema({ $ref })).toThrow(/local|resolve/i);
    },
  );

  it("refuses allOf combined with a ref", () => {
    const schema = {
      allOf: [{ $ref: "#/$defs/value" }, stringSchema],
      $defs: { value: stringSchema },
    };
    expect(() => validateAnthropicJsonSchema(schema)).toThrow(/allOf.*\$ref/i);
  });

  const nestedObjects: [string, unknown][] = [
    ["properties", objectSchema({ value: { type: "object", properties: {} } })],
    ["items", { type: "array", items: { type: "object", properties: {} } }],
    ["$defs", { ...objectSchema({}), $defs: { value: { type: "object", properties: {} } } }],
    ["definitions", { ...objectSchema({}), definitions: { value: { type: "object", properties: {} } } }],
    ["anyOf", { anyOf: [stringSchema, { type: "object", properties: {} }] }],
    ["allOf", { allOf: [stringSchema, { type: "object", properties: {} }] }],
  ];
  it.each(nestedObjects)("requires additionalProperties: false beneath %s", (_name, schema) => {
    expect(() => validateAnthropicJsonSchema(schema as Readonly<Record<string, unknown>>)).toThrow(
      /additionalProperties.*false/,
    );
  });

  it.each([
    ["missing", objectSchema({ value: stringSchema }), undefined],
    ["true", objectSchema({ value: stringSchema }), true],
    ["schema", objectSchema({ value: stringSchema }), stringSchema],
  ])("refuses %s additionalProperties", (_name, base, additionalProperties) => {
    const schema = { ...base } as Record<string, unknown>;
    if (additionalProperties === undefined) delete schema.additionalProperties;
    else schema.additionalProperties = additionalProperties;
    expect(() => validateAnthropicJsonSchema(schema)).toThrow(/additionalProperties.*false/);
  });

  it.each([
    ["minLength", 1],
    ["maxLength", 10],
    ["minimum", 0],
    ["maximum", 10],
    ["multipleOf", 2],
    ["maxItems", 3],
    ["uniqueItems", true],
    ["contains", stringSchema],
    ["minContains", 1],
    ["maxContains", 2],
    ["prefixItems", [stringSchema]],
    ["unevaluatedItems", false],
  ])("refuses unsupported keyword %s", (keyword, value) => {
    expect(() => validateAnthropicJsonSchema({ type: "string", [keyword]: value })).toThrow(
      new RegExp(keyword),
    );
  });

  it("refuses schema keywords outside the supported subset", () => {
    expect(() => validateAnthropicJsonSchema({ type: "string", examples: ["one"] })).toThrow(
      /unsupported keyword examples/,
    );
  });

  it("allows minItems 0 or 1 and refuses any other value", () => {
    for (const minItems of [0, 1]) {
      expect(validateAnthropicJsonSchema({ type: "array", items: stringSchema, minItems })).toBeDefined();
    }
    expect(() =>
      validateAnthropicJsonSchema({ type: "array", items: stringSchema, minItems: 2 }),
    ).toThrow(/minItems.*0 or 1/);
  });

  it.each([
    String.raw`(a)\1`,
    "foo(?=bar)",
    "foo(?!bar)",
    "(?<=foo)bar",
    "(?<!foo)bar",
    String.raw`\bword\b`,
    "a{1,1000}",
  ])("refuses an unsupported regex: %s", (pattern) => {
    expect(() => validateAnthropicJsonSchema({ type: "string", pattern })).toThrow(/pattern/);
  });

  it.each(["^spya-[a-z0-9]+$", String.raw`[A-Z]?\d{1,6}`, "(one|two).*"])(
    "allows a supported regex: %s",
    (pattern) => {
      expect(validateAnthropicJsonSchema({ type: "string", pattern })).toBeDefined();
    },
  );

  it("enforces the optional-parameter ceiling", () => {
    const properties = Object.fromEntries(
      Array.from({ length: MAX_OPTIONAL_PARAMETERS + 1 }, (_, i) => [`p${i}`, stringSchema]),
    );
    expect(() => validateAnthropicJsonSchema(objectSchema(properties, []))).toThrow(
      new RegExp(`${MAX_OPTIONAL_PARAMETERS} optional`),
    );
  });

  it("enforces the union-parameter ceiling for anyOf and type arrays", () => {
    const properties = Object.fromEntries(
      Array.from({ length: MAX_UNION_PARAMETERS + 1 }, (_, i) => [
        `p${i}`,
        i % 2 === 0 ? { anyOf: [stringSchema, { type: "null" }] } : { type: ["string", "null"] },
      ]),
    );
    expect(() => validateAnthropicJsonSchema(objectSchema(properties))).toThrow(
      new RegExp(`${MAX_UNION_PARAMETERS} union`),
    );
  });

  it("counts each union parameter when several properties share one local ref", () => {
    const properties = Object.fromEntries(
      Array.from({ length: MAX_UNION_PARAMETERS + 1 }, (_, i) => [
        `p${i}`,
        { $ref: "#/$defs/nullable" },
      ]),
    );
    const schema = {
      ...objectSchema(properties),
      $defs: { nullable: { anyOf: [stringSchema, { type: "null" }] } },
    };
    expect(() => validateAnthropicJsonSchema(schema)).toThrow(
      new RegExp(`${MAX_UNION_PARAMETERS} union`),
    );
  });

  it("does not mutate even a deeply frozen schema", () => {
    const schema = Object.freeze({
      ...objectSchema({ value: Object.freeze({ ...stringSchema }) }),
      properties: Object.freeze({ value: Object.freeze({ ...stringSchema }) }),
      required: Object.freeze(["value"]),
    });
    const before = JSON.stringify(schema);
    expect(validateAnthropicJsonSchema(schema)).toBe(schema);
    expect(JSON.stringify(schema)).toBe(before);
  });
});

describe("the block-id enum contract", () => {
  it("refuses an enum on every property name declared to carry a block id", () => {
    const schema = objectSchema({
      start: { type: "string", enum: ["spya-aaaaaa"] },
      nested: objectSchema({ start: { type: "string", enum: ["spya-bbbbbb"] } }),
    });
    expect(() => assertNoBlockIdEnums(schema, ["start"])).toThrow(/block id.*enum/i);
  });

  it("does not confuse an ordinary enum with a block-id field", () => {
    const schema = objectSchema({ kind: { type: "string", enum: ["chapter", "section"] } });
    expect(() => assertNoBlockIdEnums(schema, ["start"])).not.toThrow();
  });
});

describe("the Messages-wire structured-output adapter", () => {
  const schema = objectSchema({ answer: stringSchema });
  const adaptive = {
    max_tokens: 16,
    thinking: { type: "adaptive" as const },
    messages: [{ role: "user" as const, content: "irrelevant" }],
  };

  it("keeps an explicit effort and a format unchanged", () => {
    const body = withMessagesJsonSchema(
      { ...adaptive, output_config: { effort: "medium" as const } },
      schema,
    );
    expect(body.output_config).toEqual({
      effort: "medium",
      format: { type: "json_schema", schema },
    });
  });

  it("lets high-power adaptive parity add high without losing the format", () => {
    const wire = messagesWireBody(
      "illustrated",
      withMessagesJsonSchema(adaptive, schema),
      "high",
    );
    expect(wire.output_config).toEqual({
      effort: "high",
      format: { type: "json_schema", schema },
    });
  });

  it("keeps the format at standard power without acquiring an effort", () => {
    const wire = messagesWireBody(
      "illustrated",
      withMessagesJsonSchema(adaptive, schema),
      "standard",
    );
    expect(wire.output_config).toEqual({ format: { type: "json_schema", schema } });
  });
});

describe("the chat-wire structured-output adapter", () => {
  const schema = objectSchema({ answer: stringSchema });

  it("builds the strict named response format without changing the request", () => {
    const body = withChatJsonSchema(
      {
        model: "anthropic/claude-sonnet-5",
        max_tokens: 16,
        messages: [{ role: "user", content: "irrelevant" }],
      },
      "short_answer",
      schema,
    );
    expect(body).toEqual({
      model: "anthropic/claude-sonnet-5",
      max_tokens: 16,
      messages: [{ role: "user", content: "irrelevant" }],
      response_format: {
        type: "json_schema",
        json_schema: { name: "short_answer", strict: true, schema },
      },
    });
  });

  it("runs the same validator before building the response format", () => {
    expect(() =>
      withChatJsonSchema(
        { model: "anthropic/claude-sonnet-5" },
        "open_object",
        { type: "object", properties: {} },
      ),
    ).toThrow(/additionalProperties.*false/);
  });

  it("refuses optional object properties that OpenAI strict schemas reject", () => {
    expect(() =>
      withChatJsonSchema(
        { model: "openai/gpt-5.6-luna" },
        "optional_answer",
        objectSchema({ answer: stringSchema, note: stringSchema }, ["answer"]),
      ),
    ).toThrow(/OpenAI.*all properties.*required/i);
  });
});
