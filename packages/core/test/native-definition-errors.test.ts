import { expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { Brick } from "../src/native";

test("Brick.action rejects :param path segments", () => {
  expect(() =>
    Brick.action("getThing", "/v2/things/:id/get", {
      input: Schema.Struct({ name: Schema.String }),
      output: Schema.String,
      errors: [],
    }),
  ).toThrow(/:id.*Brick\.endpoint.*params/);
});

test("non-string-encodable params fail naming action, route and part", () => {
  const Doctype = Schema.declare<string>(
    (value): value is string => value === "CRMLead" || value === "Address",
    { identifier: "RecordsDoctype" },
  );
  let message = "";
  try {
    Brick.endpoint("getList", "POST", "/v2/records/:doctype/getList", {
      errors: [],
      input: {
        params: Schema.Struct({ doctype: Doctype }),
        payload: Schema.Struct({}),
      },
      output: Schema.Struct({ ok: Schema.Boolean }),
    })(() => Effect.succeed({ ok: true }));
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message).toContain(
    'Brick.endpoint("getList", "POST", "/v2/records/:doctype/getList")',
  );
  expect(message).toContain('"params"');
  expect(message).toContain("payload");
});

test("structural params still define cleanly", () => {
  const Doctype = Schema.Literals(["CRMLead", "Address"] as const);
  const fixed = Brick.endpoint(
    "getList",
    "POST",
    "/v2/records/:doctype/getList",
    {
      errors: [],
      input: {
        params: Schema.Struct({ doctype: Doctype }),
        payload: Schema.Struct({}),
      },
      output: Schema.Struct({ ok: Schema.Boolean }),
    },
  )((input) => Effect.succeed({ ok: input.doctype === "CRMLead" }));
  expect(fixed.endpoint.identifier).toBe("getList");
});
